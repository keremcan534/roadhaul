import { clamp, degreesToRadians } from '../../core/math/scalar';
import { SeededRandom } from '../../core/random/SeededRandom';
import type { MapDefinition } from '../../data/definitions/MapDefinition';
import type { VehicleFootprint } from '../vehicles/VehicleFootprint';
import type { VehicleRuntimeState } from '../vehicles/VehicleRuntimeState';
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
const TREE_SPAWN_CLEARANCE = 20;
const TREE_BOUNDARY_MARGIN = 8;
/** Size of the lookup grid for trees, meters. */
const GRID_CELL_METERS = 20;
const GRID_OFFSET = 4096;

/**
 * Everything the truck can drive on or into, built from a MapDefinition:
 * road paths, surfaces, buildings, generated trees and the map boundary.
 * Rendering reads the same data, so what you see is what you collide with.
 */
export class DrivingWorld {
  readonly id: string;
  readonly halfSizeMeters: number;
  readonly roads: readonly RoadPath[];
  readonly buildings: readonly BuildingObstacle[];
  readonly trees: readonly TreeObstacle[];
  /** Rear axle position and heading (radians) where the truck starts. */
  readonly spawn: { readonly x: number; readonly z: number; readonly heading: number };
  private readonly treeGrid = new Map<number, number[]>();
  /** Hardest contact of the current resolveCollisions() call (scratch fields, so nothing allocates). */
  private worstImpact = 0;
  private worstAlignment = 0;

  constructor(map: MapDefinition) {
    this.id = map.id;
    this.halfSizeMeters = map.halfSizeMeters;
    this.roads = map.roads.map((road) => new RoadPath(road));
    this.buildings = map.buildings.map((building) => ({
      minX: building.x - building.widthMeters / 2,
      maxX: building.x + building.widthMeters / 2,
      minZ: building.z - building.depthMeters / 2,
      maxZ: building.z + building.depthMeters / 2,
      heightMeters: building.heightMeters,
    }));
    this.spawn = { x: map.spawn.x, z: map.spawn.z, heading: degreesToRadians(map.spawn.headingDegrees) };
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

  /** The ground under a point: asphalt on any road, grass everywhere else. */
  surfaceAt(x: number, z: number): Surface {
    for (let i = 0; i < this.roads.length; i++) {
      if (this.roads[i]!.contains(x, z)) {
        return ASPHALT;
      }
    }
    return GRASS;
  }

  /**
   * Pushes the truck out of trees, buildings and the map boundary, and removes
   * the part of its speed that drove into them (a head-on hit stops it, a
   * glancing one only slows it). Returns the hardest impact speed in m/s, or 0.
   * Allocation-free: it runs every fixed step.
   */
  resolveCollisions(state: VehicleRuntimeState, footprint: VehicleFootprint): number {
    this.worstImpact = 0;
    this.worstAlignment = 0;
    for (let i = 0; i < footprint.offsets.length; i++) {
      this.collideCircle(state, footprint.offsets[i]!, footprint.radius);
    }
    // One speed response per step, from the hardest contact. Several circles touching
    // the same wall must not brake the truck several times over.
    if (this.worstImpact > 0) {
      state.speed *= 1 - this.worstAlignment * this.worstAlignment;
    }
    return this.worstImpact;
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
          this.pushOut(state, dx / distance, dz / distance, minDistance - distance);
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
        this.pushOut(state, dx / distance, dz / distance, radius - distance);
      } else {
        // The circle's centre is inside the box: leave through the closest side.
        const toLeft = cx - box.minX;
        const toRight = box.maxX - cx;
        const toBottom = cz - box.minZ;
        const toTop = box.maxZ - cz;
        const closest = Math.min(toLeft, toRight, toBottom, toTop);
        const nx = closest === toLeft ? -1 : closest === toRight ? 1 : 0;
        const nz = nx !== 0 ? 0 : closest === toBottom ? -1 : 1;
        this.pushOut(state, nx, nz, closest + radius);
      }
      cx = state.x + Math.sin(state.heading) * offset;
      cz = state.z + Math.cos(state.heading) * offset;
    }

    const edge = this.halfSizeMeters - radius;
    if (cx < -edge) this.pushOut(state, 1, 0, -edge - cx);
    if (cx > edge) this.pushOut(state, -1, 0, cx - edge);
    if (cz < -edge) this.pushOut(state, 0, 1, -edge - cz);
    if (cz > edge) this.pushOut(state, 0, -1, cz - edge);
  }

  /**
   * Moves the truck out of an obstacle along the contact normal (nx, nz) and
   * remembers the contact if it is the hardest so far this step (the truck
   * moving into the obstacle, not away from it).
   */
  private pushOut(state: VehicleRuntimeState, nx: number, nz: number, depth: number): void {
    state.x += nx * depth;
    state.z += nz * depth;
    const alignment = Math.sin(state.heading) * nx + Math.cos(state.heading) * nz;
    const normalSpeed = state.speed * alignment;
    if (-normalSpeed > this.worstImpact) {
      this.worstImpact = -normalSpeed;
      this.worstAlignment = alignment;
    }
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
