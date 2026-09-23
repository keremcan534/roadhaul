import { clamp, clamp01, degreesToRadians } from '../../core/math/scalar';
import { SeededRandom } from '../../core/random/SeededRandom';
import {
  rectangleContains,
  type DepotDefinition,
  type MapDefinition,
  type RestAreaDefinition,
} from '../../data/definitions/MapDefinition';
import type { VehicleFootprint } from '../vehicles/VehicleFootprint';
import type { VehicleRuntimeState } from '../vehicles/VehicleRuntimeState';
import { RoadNetwork } from './RoadNetwork';
import { RoadPath } from './RoadPath';
import { ASPHALT, GRASS, type Surface } from './Surface';

export interface TreeObstacle {
  readonly x: number;
  readonly z: number;
  /** Trunk radius used for collisions, meters. */
  readonly radius: number;
  /** Visual size variation (about 0.8–1.3). */
  readonly scale: number;
}

/**
 * Where a truck can refuel at pump prices and be repaired: a depot's yard or
 * a rest area's lot (spec §25).
 */
export type ServicePoint =
  | { readonly kind: 'depot'; readonly depot: DepotDefinition }
  | { readonly kind: 'restArea'; readonly restArea: RestAreaDefinition };

/**
 * A paved circle at a dead end, where trucks and traffic turn round (spec
 * §19: traffic turns; §20: the world). Every open road end that joins no
 * other road gets one.
 */
export interface TurningCircle {
  readonly x: number;
  readonly z: number;
  readonly radiusMeters: number;
  /** The road that ends here, and the sample it ends at (its first or last). */
  readonly roadIndex: number;
  readonly sampleIndex: number;
}

/**
 * Things that move and can be hit: the traffic (roadmap step 22). Like the
 * truck's footprint they are circles; each moves with its vehicle's velocity.
 * Arrays are read up to circleCount.
 */
export interface MovingObstacles {
  readonly circleCount: number;
  readonly circleX: Float64Array;
  readonly circleZ: Float64Array;
  readonly circleRadius: Float64Array;
  /** Velocity of the circle's vehicle, m/s. */
  readonly circleVelocityX: Float64Array;
  readonly circleVelocityZ: Float64Array;
  /**
   * The truck touched circle `index` this step. `impactSpeed` is how hard
   * the truck drove into it (m/s), 0 when it was not driving into it.
   */
  hit(index: number, impactSpeed: number): void;
}

export interface BuildingObstacle {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly heightMeters: number;
}

const TREE_TRUNK_RADIUS = 0.45;
/** Trees keep at least this much space from the road edge… */
const TREE_ROAD_CLEARANCE = 4;
/** …and are scattered up to this far beyond it. */
const TREE_SCATTER_METERS = 45;
const TREE_BUILDING_CLEARANCE = 4;
/** Trees keep this far from depot yards and rest area lots, so trucks can manoeuvre. */
const TREE_YARD_CLEARANCE = 6;
const TREE_SPAWN_CLEARANCE = 20;
const TREE_BOUNDARY_MARGIN = 8;
/** Size of the lookup grid for trees, meters. */
const GRID_CELL_METERS = 20;
const GRID_OFFSET = 4096;
/**
 * Contact angles (between the direction of travel and the obstacle's surface)
 * up to this one turn the truck fully along the obstacle: it glances off and
 * carries on…
 */
const FULL_DEFLECTION_ANGLE = degreesToRadians(20);
/** …from this one on it is stopped like in a head-on crash. In between, the two blend. */
const NO_DEFLECTION_ANGLE = degreesToRadians(45);
/** Turning circles are this big, their centre this far past the road's end. */
export const TURNING_CIRCLE_RADIUS_METERS = 11;
export const TURNING_CIRCLE_OFFSET_METERS = 2;
/**
 * A truck moving into a moving obstacle slower than this is not to blame for
 * the contact: the obstacle drove into it, and it takes no damage.
 */
const AT_FAULT_SPEED = 0.5;

/**
 * Everything the truck can drive on or into, built from a MapDefinition:
 * road paths, surfaces, buildings, generated trees and the map boundary.
 * Rendering reads the same data, so what you see is what you collide with.
 */
export class DrivingWorld {
  readonly id: string;
  readonly halfSizeMeters: number;
  readonly roads: readonly RoadPath[];
  /** The roads joined at their junctions, for routes by road. */
  readonly network: RoadNetwork;
  readonly buildings: readonly BuildingObstacle[];
  readonly trees: readonly TreeObstacle[];
  /** City depots: paved yards (driven like asphalt) with a loading bay each. */
  readonly depots: readonly DepotDefinition[];
  /** Paved lots beside the road where the truck can refuel and be repaired. */
  readonly restAreas: readonly RestAreaDefinition[];
  /** Rear axle position and heading (radians) where the truck starts. */
  readonly spawn: { readonly x: number; readonly z: number; readonly heading: number };
  /** Every depot yard and rest area lot, where trucks are serviced. */
  readonly servicePoints: readonly ServicePoint[];
  /** One at each dead end. */
  readonly turningCircles: readonly TurningCircle[];
  private readonly treeGrid = new Map<number, number[]>();
  /**
   * Hardest contact of the current resolveCollisions() call: impact speed,
   * contact normal and which footprint circle touched (scratch fields, so
   * nothing allocates).
   */
  private worstImpact = 0;
  private worstNormalX = 0;
  private worstNormalZ = 0;
  private worstOffset = 0;
  /** Speed along the truck's heading that the hardest contact carries the truck at (a vehicle it follows into). */
  private worstCarriedSpeed = 0;

  constructor(map: MapDefinition) {
    this.id = map.id;
    this.halfSizeMeters = map.halfSizeMeters;
    this.roads = map.roads.map((road) => new RoadPath(road));
    this.network = new RoadNetwork(this.roads);
    this.buildings = map.buildings.map((building) => ({
      minX: building.x - building.widthMeters / 2,
      maxX: building.x + building.widthMeters / 2,
      minZ: building.z - building.depthMeters / 2,
      maxZ: building.z + building.depthMeters / 2,
      heightMeters: building.heightMeters,
    }));
    this.depots = map.depots;
    this.restAreas = map.restAreas;
    this.servicePoints = [
      ...map.depots.map((depot): ServicePoint => ({ kind: 'depot', depot })),
      ...map.restAreas.map((restArea): ServicePoint => ({ kind: 'restArea', restArea })),
    ];
    this.spawn = { x: map.spawn.x, z: map.spawn.z, heading: degreesToRadians(map.spawn.headingDegrees) };
    this.turningCircles = this.network.deadEnds.map(({ roadIndex, sampleIndex }) => {
      const road = this.roads[roadIndex]!;
      const inward = sampleIndex === 0 ? 1 : sampleIndex - 1;
      const dx = road.x(sampleIndex) - road.x(inward);
      const dz = road.z(sampleIndex) - road.z(inward);
      const length = Math.hypot(dx, dz) || 1;
      return {
        x: road.x(sampleIndex) + (dx / length) * TURNING_CIRCLE_OFFSET_METERS,
        z: road.z(sampleIndex) + (dz / length) * TURNING_CIRCLE_OFFSET_METERS,
        radiusMeters: TURNING_CIRCLE_RADIUS_METERS,
        roadIndex,
        sampleIndex,
      };
    });
    this.trees = this.placeTrees(map.scenery.seed, map.scenery.treesPerKilometer);
    this.trees.forEach((tree, index) => {
      const key = cellKey(cellOf(tree.x), cellOf(tree.z));
      const bucket = this.treeGrid.get(key);
      if (bucket === undefined) {
        this.treeGrid.set(key, [index]);
      } else {
        bucket.push(index);
      }
    });
  }

  /** The ground under a point: asphalt on any road, turning circle, depot yard or rest area lot, grass everywhere else. */
  surfaceAt(x: number, z: number): Surface {
    for (let i = 0; i < this.roads.length; i++) {
      if (this.roads[i]!.contains(x, z)) {
        return ASPHALT;
      }
    }
    for (let i = 0; i < this.turningCircles.length; i++) {
      const circle = this.turningCircles[i]!;
      if (Math.hypot(x - circle.x, z - circle.z) <= circle.radiusMeters) {
        return ASPHALT;
      }
    }
    for (let i = 0; i < this.depots.length; i++) {
      if (rectangleContains(this.depots[i]!.yard, x, z)) {
        return ASPHALT;
      }
    }
    for (let i = 0; i < this.restAreas.length; i++) {
      if (rectangleContains(this.restAreas[i]!.lot, x, z)) {
        return ASPHALT;
      }
    }
    return GRASS;
  }

  /** The depot yard or rest area lot that (x, z) lies in, or null. Allocation-free. */
  servicePointAt(x: number, z: number): ServicePoint | null {
    for (let i = 0; i < this.servicePoints.length; i++) {
      const point = this.servicePoints[i]!;
      const area = point.kind === 'depot' ? point.depot.yard : point.restArea.lot;
      if (rectangleContains(area, x, z)) {
        return point;
      }
    }
    return null;
  }

  /** The depot of `cityId` on this map, if it has one. */
  depotOf(cityId: string): DepotDefinition | undefined {
    return this.depots.find((depot) => depot.cityId === cityId);
  }

  /**
   * Pushes the truck out of trees, buildings, the map boundary and moving
   * `obstacles` (traffic), then responds to the hardest contact: a head-on
   * hit stops the truck, a glancing one turns it along the obstacle and it
   * carries on with the speed it had along the surface. Driving into a
   * vehicle that is moving away, the truck keeps that vehicle's speed.
   * Returns the hardest impact speed (m/s into the obstacle), or 0.
   * Allocation-free: it runs every fixed step.
   */
  resolveCollisions(
    state: VehicleRuntimeState,
    footprint: VehicleFootprint,
    obstacles: MovingObstacles | null = null,
  ): number {
    this.worstImpact = 0;
    this.worstCarriedSpeed = 0;
    for (let i = 0; i < footprint.offsets.length; i++) {
      this.collideCircle(state, footprint.offsets[i]!, footprint.radius);
      if (obstacles !== null) {
        this.collideMoving(state, footprint.offsets[i]!, footprint.radius, obstacles);
      }
    }
    // One response per step, from the hardest contact. Several circles touching
    // the same wall must not brake the truck several times over.
    if (this.worstImpact > 0) {
      this.deflect(state, this.worstNormalX, this.worstNormalZ, this.worstOffset, this.worstCarriedSpeed);
    }
    return this.worstImpact;
  }

  /**
   * Pushes one footprint circle out of the moving obstacles. The truck only
   * takes an impact when it drives into the obstacle; one driving into a
   * standing truck just shoves it. Every touched obstacle is told.
   */
  private collideMoving(state: VehicleRuntimeState, offset: number, radius: number, obstacles: MovingObstacles): void {
    let cx = state.x + Math.sin(state.heading) * offset;
    let cz = state.z + Math.cos(state.heading) * offset;
    for (let k = 0; k < obstacles.circleCount; k++) {
      const dx = cx - obstacles.circleX[k]!;
      const dz = cz - obstacles.circleZ[k]!;
      const minDistance = radius + obstacles.circleRadius[k]!;
      const distanceSquared = dx * dx + dz * dz;
      if (distanceSquared >= minDistance * minDistance || distanceSquared < 1e-12) {
        continue;
      }
      const distance = Math.sqrt(distanceSquared);
      const nx = dx / distance;
      const nz = dz / distance;
      state.x += nx * (minDistance - distance);
      state.z += nz * (minDistance - distance);
      cx = state.x + Math.sin(state.heading) * offset;
      cz = state.z + Math.cos(state.heading) * offset;
      // The normal points from the obstacle to the truck: negative truck speed along it is driving in.
      const truckInto = -state.speed * (Math.sin(state.heading) * nx + Math.cos(state.heading) * nz);
      const obstacleInto = obstacles.circleVelocityX[k]! * nx + obstacles.circleVelocityZ[k]! * nz;
      const impact = truckInto > AT_FAULT_SPEED ? Math.max(0, truckInto + obstacleInto) : 0;
      obstacles.hit(k, impact);
      if (impact > 0 && impact >= this.worstImpact) {
        this.worstImpact = impact;
        this.worstNormalX = nx;
        this.worstNormalZ = nz;
        this.worstOffset = offset;
        // A vehicle moving away carries the truck along; one coming at it stops dead in the crash.
        this.worstCarriedSpeed =
          obstacleInto < 0
            ? obstacles.circleVelocityX[k]! * Math.sin(state.heading) + obstacles.circleVelocityZ[k]! * Math.cos(state.heading)
            : 0;
      }
    }
  }

  private collideCircle(state: VehicleRuntimeState, offset: number, radius: number): void {
    const reach = radius + TREE_TRUNK_RADIUS;
    let cx = state.x + Math.sin(state.heading) * offset;
    let cz = state.z + Math.cos(state.heading) * offset;
    const minCellX = cellOf(cx - reach);
    const maxCellX = cellOf(cx + reach);
    const minCellZ = cellOf(cz - reach);
    const maxCellZ = cellOf(cz + reach);
    for (let gx = minCellX; gx <= maxCellX; gx++) {
      for (let gz = minCellZ; gz <= maxCellZ; gz++) {
        const bucket = this.treeGrid.get(cellKey(gx, gz));
        if (bucket === undefined) {
          continue;
        }
        for (let k = 0; k < bucket.length; k++) {
          const tree = this.trees[bucket[k]!]!;
          const dx = cx - tree.x;
          const dz = cz - tree.z;
          const minDistance = radius + tree.radius;
          const distanceSquared = dx * dx + dz * dz;
          if (distanceSquared >= minDistance * minDistance || distanceSquared < 1e-12) {
            continue;
          }
          const distance = Math.sqrt(distanceSquared);
          this.pushOut(state, offset, dx / distance, dz / distance, minDistance - distance);
          cx = state.x + Math.sin(state.heading) * offset;
          cz = state.z + Math.cos(state.heading) * offset;
        }
      }
    }

    for (let i = 0; i < this.buildings.length; i++) {
      const box = this.buildings[i]!;
      const nearestX = clamp(cx, box.minX, box.maxX);
      const nearestZ = clamp(cz, box.minZ, box.maxZ);
      const dx = cx - nearestX;
      const dz = cz - nearestZ;
      const distanceSquared = dx * dx + dz * dz;
      if (distanceSquared >= radius * radius) {
        continue;
      }
      if (distanceSquared > 1e-12) {
        const distance = Math.sqrt(distanceSquared);
        this.pushOut(state, offset, dx / distance, dz / distance, radius - distance);
      } else {
        // The circle's centre is inside the box: leave through the closest side.
        const toLeft = cx - box.minX;
        const toRight = box.maxX - cx;
        const toBottom = cz - box.minZ;
        const toTop = box.maxZ - cz;
        const closest = Math.min(toLeft, toRight, toBottom, toTop);
        const nx = closest === toLeft ? -1 : closest === toRight ? 1 : 0;
        const nz = nx !== 0 ? 0 : closest === toBottom ? -1 : 1;
        this.pushOut(state, offset, nx, nz, closest + radius);
      }
      cx = state.x + Math.sin(state.heading) * offset;
      cz = state.z + Math.cos(state.heading) * offset;
    }

    const edge = this.halfSizeMeters - radius;
    if (cx < -edge) this.pushOut(state, offset, 1, 0, -edge - cx);
    if (cx > edge) this.pushOut(state, offset, -1, 0, cx - edge);
    if (cz < -edge) this.pushOut(state, offset, 0, 1, -edge - cz);
    if (cz > edge) this.pushOut(state, offset, 0, -1, cz - edge);
  }

  /**
   * Moves the truck out of an obstacle along the contact normal (nx, nz) and
   * remembers the contact if it is the hardest so far this step (the truck
   * moving into the obstacle, not away from it). `offset` says which
   * footprint circle touched.
   */
  private pushOut(state: VehicleRuntimeState, offset: number, nx: number, nz: number, depth: number): void {
    state.x += nx * depth;
    state.z += nz * depth;
    const normalSpeed = state.speed * (Math.sin(state.heading) * nx + Math.cos(state.heading) * nz);
    // Ties are circles on the same surface. A later push-out there means that circle was still inside
    // after the earlier ones were resolved, so it was the deepest: it is the one left touching.
    if (-normalSpeed >= this.worstImpact) {
      this.worstImpact = -normalSpeed;
      this.worstNormalX = nx;
      this.worstNormalZ = nz;
      this.worstOffset = offset;
      this.worstCarriedSpeed = 0;
    }
  }

  /**
   * The truck can only move where it points (no sideways sliding), so it keeps
   * the part of its velocity along the obstacle's surface only if it also
   * turns that way. Without the turn, the next step would drive it into the
   * obstacle again and a light scrape would pin it to the wall. It turns
   * about the touching circle (`pivotOffset` ahead of the rear axle), so it
   * stays against the obstacle and slides along it. Steep hits turn less and
   * lose the rest of their speed. Against a vehicle moving away, all of this
   * applies to the speed relative to `carriedSpeed`, the vehicle's speed
   * along the truck's heading.
   */
  private deflect(state: VehicleRuntimeState, nx: number, nz: number, pivotOffset: number, carriedSpeed: number): void {
    const sin = Math.sin(state.heading);
    const cos = Math.cos(state.heading);
    // Heading · normal: the sine of the angle between the truck and the surface
    // (negative when driving forwards into it, positive when reversing into it).
    const alignment = sin * nx + cos * nz;
    const angle = Math.asin(Math.min(1, Math.abs(alignment)));
    const turn = clamp01((NO_DEFLECTION_ANGLE - angle) / (NO_DEFLECTION_ANGLE - FULL_DEFLECTION_ANGLE));
    // Speed along the surface, projected onto the new heading (a head-on hit keeps nothing).
    state.speed = carriedSpeed + (state.speed - carriedSpeed) * Math.cos(angle) * Math.cos(angle * (1 - turn));
    if (turn === 0) {
      return;
    }
    // Turning the heading by +1 rad moves it along (cos, -sin); pick the direction that brings alignment to 0.
    const sideways = cos * nx - sin * nz;
    state.heading += Math.sign(-alignment * sideways) * angle * turn;
    // Keep the touching circle where it is: the rear of the truck swings in instead of the nose bouncing off.
    state.x += pivotOffset * (sin - Math.sin(state.heading));
    state.z += pivotOffset * (cos - Math.cos(state.heading));
  }

  /** Scatters trees beside the roads. The same seed always gives the same forest. */
  private placeTrees(seed: number, treesPerKilometer: number): TreeObstacle[] {
    const random = new SeededRandom(seed);
    const trees: TreeObstacle[] = [];
    for (const road of this.roads) {
      const count = Math.round((road.lengthMeters / 1000) * treesPerKilometer);
      for (let i = 0; i < count; i++) {
        // Consume the same random numbers for every candidate, so rejected trees do not shift the others.
        const index = random.int(0, road.pointCount - 2);
        const side = random.sign();
        const distanceFromEdge = TREE_ROAD_CLEARANCE + random.next() * TREE_SCATTER_METERS;
        const along = random.range(-2, 2);
        const scale = random.range(0.8, 1.3);

        const tangentX = road.x(index + 1) - road.x(index);
        const tangentZ = road.z(index + 1) - road.z(index);
        const tangentLength = Math.hypot(tangentX, tangentZ) || 1;
        const ux = tangentX / tangentLength;
        const uz = tangentZ / tangentLength;
        const offset = side * (road.widthMeters / 2 + distanceFromEdge);
        const x = road.x(index) - uz * offset + ux * along;
        const z = road.z(index) + ux * offset + uz * along;
        if (this.isClearForTree(x, z)) {
          trees.push({ x, z, radius: TREE_TRUNK_RADIUS, scale });
        }
      }
    }
    return trees;
  }

  private isClearForTree(x: number, z: number): boolean {
    const limit = this.halfSizeMeters - TREE_BOUNDARY_MARGIN;
    if (Math.abs(x) > limit || Math.abs(z) > limit) {
      return false;
    }
    if (Math.hypot(x - this.spawn.x, z - this.spawn.z) < TREE_SPAWN_CLEARANCE) {
      return false;
    }
    for (const road of this.roads) {
      if (road.distanceTo(x, z) < road.widthMeters / 2 + TREE_ROAD_CLEARANCE - 0.5) {
        return false; // Another stretch of road passes close by.
      }
    }
    if (this.depots.some((depot) => rectangleContains(depot.yard, x, z, TREE_YARD_CLEARANCE))) {
      return false;
    }
    if (this.restAreas.some((restArea) => rectangleContains(restArea.lot, x, z, TREE_YARD_CLEARANCE))) {
      return false;
    }
    if (
      this.turningCircles.some(
        (circle) => Math.hypot(x - circle.x, z - circle.z) < circle.radiusMeters + TREE_ROAD_CLEARANCE,
      )
    ) {
      return false;
    }
    return this.buildings.every(
      (box) =>
        Math.hypot(x - clamp(x, box.minX, box.maxX), z - clamp(z, box.minZ, box.maxZ)) >= TREE_BUILDING_CLEARANCE,
    );
  }
}

function cellOf(coordinate: number): number {
  return Math.floor(coordinate / GRID_CELL_METERS);
}

function cellKey(cellX: number, cellZ: number): number {
  return (cellX + GRID_OFFSET) * GRID_OFFSET * 2 + (cellZ + GRID_OFFSET);
}
