import { clamp, clamp01, degreesToRadians } from '../../core/math/scalar';
import { SeededRandom } from '../../core/random/SeededRandom';
import {
  isInSea,
  rectangleContains,
  shorelineXAt,
  type BoatKind,
  type CitySignDefinition,
  type DepotDefinition,
  type FieldCrop,
  type FieldDefinition,
  type MapDefinition,
  type Point2,
  type QuayDefinition,
  type RectangleDefinition,
  type RestAreaDefinition,
  type SeaDefinition,
} from '../../data/definitions/MapDefinition';
import type { VehicleFootprint } from '../vehicles/VehicleFootprint';
import type { VehicleRuntimeState } from '../vehicles/VehicleRuntimeState';
import {
  Occupancy,
  placeFieldEdges,
  placeGrazers,
  placePowerLines,
  placeRocks,
  plantTrees,
  SCENERY_ROAD_REACH_METERS,
  type FieldEdge,
  type Grazer,
  type PowerLine,
  type Rock,
  type SceneryGround,
  type TreeSpecies,
} from './countryside';
import { cellKey, cellOf } from './gridCells';
import { placeGuardRails, type GuardRail } from './guardRails';
import { RoadGrid } from './RoadGrid';
import { RoadNetwork } from './RoadNetwork';
import { createRoadPoint, RoadPath } from './RoadPath';
import { ASPHALT, GRASS, type Surface } from './Surface';
import {
  billboardLegs,
  PavementGrid,
  placeBillboards,
  placeSidewalks,
  placeSpeedSigns,
  placeStreetFurniture,
  type Billboard,
  type Sidewalk,
  type SpeedSign,
  type StreetFurniture,
  type TownGround,
} from './townscape';

export interface TreeObstacle {
  readonly x: number;
  readonly z: number;
  /** A planted tree's species (poplar, cypress, olive); the wild ones, without, are the views' pines and broadleaves. */
  readonly species?: TreeSpecies;
  /** Trunk radius used for collisions, meters. */
  readonly radius: number;
  /** Visual size variation (about 0.8–1.3). */
  readonly scale: number;
}

/**
 * A city's name board beside a road into it (MapDefinition.citySigns), on
 * two posts either side of its middle, across the road's direction. The
 * posts are solid.
 */
export interface CitySign {
  readonly cityId: string;
  /** The middle of the board, on the ground. */
  readonly x: number;
  readonly z: number;
  /** Which way the board faces: toward the traffic it greets, radians (0 faces +Z, π/2 faces +X). */
  readonly heading: number;
}

/** A farm field where it lies: its rows run along the area's heading. */
export interface Field {
  readonly area: RectangleDefinition;
  readonly crop: FieldCrop;
}

/** A round hay bale lying on a harvested field. It is solid. */
export interface HayBale {
  readonly x: number;
  readonly z: number;
  /** Which way its axis lies, radians (0 along +Z). */
  readonly heading: number;
  /** Radius used for collisions, meters. */
  readonly radius: number;
}

/** A wind turbine's tower (MapDefinition.windTurbines). It is solid. */
export interface WindTurbine {
  readonly x: number;
  readonly z: number;
  /** The tower's radius at its foot, used for collisions, meters. */
  readonly radius: number;
}

/** A street lamp beside a city road. Its post is solid, like a tree's trunk. */
export interface StreetLamp {
  readonly x: number;
  readonly z: number;
  /** Which way its arm reaches out over the road, radians (0 faces +Z, π/2 faces +X, like headings). */
  readonly heading: number;
  /** Post radius used for collisions, meters. */
  readonly radius: number;
}

/** A boat moored in the harbour (scenery, out of reach in the water). */
export interface Boat {
  readonly kind: BoatKind;
  readonly x: number;
  readonly z: number;
  /** Which way the bow points, radians (0 faces +Z, π/2 faces +X). */
  readonly heading: number;
}

/**
 * A harbour crane on a quay: a portal on four solid legs, its jib reaching
 * out `heading` (radians, 0 faces +Z) over the water.
 */
export interface Crane {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
}

/** A boulder where the land meets the water, along the natural shore (scenery). */
export interface ShoreRock {
  readonly x: number;
  readonly z: number;
  /** About how wide it is, meters. */
  readonly size: number;
  /** How it is turned, radians. */
  readonly turn: number;
}

/**
 * The sea along the map's west edge (MapDefinition.sea): water west of the
 * shoreline, paved quays along the shore, boats, cranes, and boulders along
 * the natural shore. The shore is a wall the truck stops at.
 */
export interface Sea {
  readonly shoreline: readonly Point2[];
  readonly quays: readonly QuayDefinition[];
  readonly boats: readonly Boat[];
  readonly cranes: readonly Crane[];
  readonly rocks: readonly ShoreRock[];
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
/**
 * A pavement's middle keeps this far from any road's edge (its own is
 * farther: half the pavement's width), and its whole width this far from
 * yards, lots, turning circles and quays.
 */
const WALK_ROAD_CLEARANCE = 0.9;
const WALK_YARD_CLEARANCE = 2;
/** Trees keep at least this much space from the road edge… */
const TREE_ROAD_CLEARANCE = 4;
/** …and are scattered up to this far beyond it. */
const TREE_SCATTER_METERS = 45;
const TREE_BUILDING_CLEARANCE = 4;
/** Trees keep this far from depot yards and rest area lots, so trucks can manoeuvre. */
const TREE_YARD_CLEARANCE = 6;
const TREE_SPAWN_CLEARANCE = 20;
const TREE_BOUNDARY_MARGIN = 8;
const LAMP_POST_RADIUS = 0.18;
/** Street lamps stand this far beyond the edge of their road (just past its gravel shoulder)… */
export const STREET_LAMP_SETBACK_METERS = 1.8;
/** …closer than this to no other road's edge… */
const LAMP_ROAD_CLEARANCE = 1.2;
/** …this far from junctions, where trucks cut the corners… */
const LAMP_JUNCTION_CLEARANCE = 16;
/** …and from depot yards, rest area lots and turning circles, where they swing round… */
const LAMP_YARD_CLEARANCE = 8;
/** …and this far from buildings and the map's edge. */
const LAMP_BUILDING_CLEARANCE = 1.5;
const LAMP_BOUNDARY_MARGIN = 2;
/**
 * A guard rail is a wall this thick either side of its line (the beam and
 * the posts behind it). Its posts keep this far from junctions…
 */
const RAIL_HALF_WIDTH_METERS = 0.2;
const RAIL_JUNCTION_CLEARANCE = 18;
/** …from depot yards, rest area lots, turning circles and the spawn, where trucks swing round… */
const RAIL_YARD_CLEARANCE = 8;
const RAIL_SPAWN_CLEARANCE = 20;
/** …and closer than this to no other road's edge, and this far from buildings, the water and the map's edge. */
const RAIL_ROAD_CLEARANCE = 1;
const RAIL_BUILDING_CLEARANCE = 1.5;
const RAIL_SHORE_CLEARANCE = 1;
const RAIL_BOUNDARY_MARGIN = 2;
/** City name boards: how far their middle stands from the road's edge, and how far apart their posts are. */
const CITY_SIGN_SETBACK_METERS = 4.6;
export const CITY_SIGN_POST_SPACING_METERS = 4.8;
const SIGN_POST_RADIUS = 0.12;
/** Trees and lamps keep this far from a board's middle, so nothing hides it. */
const SIGN_CLEARANCE_METERS = 9;
/** Hay bales lie in rows this far apart across a stubble field, about this far apart along a row… */
const BALE_ROW_SPACING_METERS = 22;
const BALE_SPACING_METERS = 15;
/** …some left out, and none closer than this to the field's edge. */
const BALE_SKIP_CHANCE = 0.35;
const BALE_EDGE_MARGIN_METERS = 6;
const BALE_RADIUS = 0.8;
const TURBINE_TOWER_RADIUS = 2.4;
/** Trees keep out of fields (by this much) and this far from a turbine's tower. */
const TREE_FIELD_CLEARANCE = 3;
const TREE_TURBINE_CLEARANCE = 12;
/** Trees keep this far back from the shore (a beach runs along it) and from quays; lamps from the water. */
const TREE_SHORE_CLEARANCE = 14;
const LAMP_SHORE_CLEARANCE = 3;
/** The truck stops this far short of the water: the quay's kerb, the rocks. */
const SHORE_WALL_MARGIN = 0.4;
/** A crane's portal: its legs stand this far either side of its middle across the quay and along it. */
export const CRANE_HALF_GAUGE_METERS = 4;
export const CRANE_HALF_BASE_METERS = 3.2;
const CRANE_LEG_RADIUS = 0.5;
/** Boulders line the natural shore about this far apart, and this far either side of the waterline. */
const SHORE_ROCK_SPACING_METERS = 6;
const SHORE_ROCK_SCATTER_METERS = 1.4;
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
 * road paths, surfaces, buildings, the scenery (generated trees, street
 * lamps, the cities' name boards, farm fields with hay bales, wind
 * turbines, guard rails on the sharper bends), the sea with its quays and
 * cranes, and the map boundary. Rendering reads the same data, so what
 * you see is what you collide with.
 */
export class DrivingWorld {
  readonly id: string;
  readonly halfSizeMeters: number;
  readonly roads: readonly RoadPath[];
  /** The roads joined at their junctions, for routes by road. */
  readonly network: RoadNetwork;
  readonly buildings: readonly BuildingObstacle[];
  readonly trees: readonly TreeObstacle[];
  /** Lamps along the city roads, when the map lights them. */
  readonly streetLamps: readonly StreetLamp[];
  /** Guard rails on the outside of the sharper bends out of town (placeGuardRails). They are walls. */
  readonly guardRails: readonly GuardRail[];
  /** The cities' name boards beside the roads into them. */
  readonly citySigns: readonly CitySign[];
  /** Farm fields (they drive like grass), and the hay bales on the harvested ones. */
  readonly fields: readonly Field[];
  readonly hayBales: readonly HayBale[];
  readonly windTurbines: readonly WindTurbine[];
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
  /** The sea along the west edge, with its quays, boats and cranes; null when the map is all land. */
  readonly sea: Sea | null;
  /** The countryside (countryside.ts): power lines along the country roads, the fields' fences and walls, boulders and grazing animals. */
  readonly powerLines: readonly PowerLine[];
  readonly fieldEdges: readonly FieldEdge[];
  readonly rocks: readonly Rock[];
  readonly grazers: readonly Grazer[];
  /** The towns (townscape.ts): pavements along the streets, what stands on them, billboards and speed limits. */
  readonly sidewalks: readonly Sidewalk[];
  readonly streetFurniture: readonly StreetFurniture[];
  readonly billboards: readonly Billboard[];
  readonly speedSigns: readonly SpeedSign[];
  /**
   * The solid circles (tree trunks, lamp and sign posts, bales, turbine
   * towers), filed by grid cell as indices into the arrays below.
   */
  private readonly circleGrid = new Map<number, number[]>();
  private readonly circleX: Float64Array;
  private readonly circleZ: Float64Array;
  private readonly circleRadius: Float64Array;
  /** The largest circle's radius: how far round a footprint circle to look for them. */
  private readonly maxCircleRadius: number;
  /**
   * The guard rails' pieces, post to post (from a to b), with the way
   * toward their road, filed by grid cell as indices into the arrays below.
   */
  private readonly railGrid = new Map<number, number[]>();
  private readonly railAX: Float64Array;
  private readonly railAZ: Float64Array;
  private readonly railBX: Float64Array;
  private readonly railBZ: Float64Array;
  private readonly railRoadwardX: Float64Array;
  private readonly railRoadwardZ: Float64Array;
  /** The road pieces by where they are: which ground a point is on, without visiting every road. */
  private readonly roadGrid: RoadGrid;
  /** The pavements' pieces by where they are: paved ground beside the town streets. */
  private readonly pavements: PavementGrid;
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
    this.roadGrid = new RoadGrid(this.roads, TREE_ROAD_CLEARANCE);
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
    this.citySigns = map.citySigns.map((sign) => this.placeCitySign(sign));
    this.fields = map.fields.map((field) => this.placeField(field));
    this.windTurbines = map.windTurbines.map(({ x, z }) => ({ x, z, radius: TURBINE_TOWER_RADIUS }));
    this.sea = map.sea === undefined ? null : createSea(map.sea, map.halfSizeMeters, map.scenery.seed);
    this.hayBales = placeHayBales(this.fields, map.scenery.seed);
    this.guardRails = placeGuardRails(this.roads, (x, z) => this.isClearForRail(x, z));
    const pieces = this.guardRails.flatMap((rail) =>
      rail.points.slice(1).map((b, index) => {
        const a = rail.points[index]!;
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        // Left of the rail's run is (dz, -dx).
        const toRoad = rail.roadSide === 'left' ? 1 : -1;
        return { a, b, nx: ((b[1] - a[1]) / length) * toRoad, nz: (-(b[0] - a[0]) / length) * toRoad };
      }),
    );
    this.railAX = Float64Array.from(pieces, (piece) => piece.a[0]);
    this.railAZ = Float64Array.from(pieces, (piece) => piece.a[1]);
    this.railBX = Float64Array.from(pieces, (piece) => piece.b[0]);
    this.railBZ = Float64Array.from(pieces, (piece) => piece.b[1]);
    this.railRoadwardX = Float64Array.from(pieces, (piece) => piece.nx);
    this.railRoadwardZ = Float64Array.from(pieces, (piece) => piece.nz);
    pieces.forEach(({ a, b }, index) => {
      for (let gx = cellOf(Math.min(a[0], b[0])); gx <= cellOf(Math.max(a[0], b[0])); gx++) {
        for (let gz = cellOf(Math.min(a[1], b[1])); gz <= cellOf(Math.max(a[1], b[1])); gz++) {
          const key = cellKey(gx, gz);
          const bucket = this.railGrid.get(key);
          if (bucket === undefined) {
            this.railGrid.set(key, [index]);
          } else {
            bucket.push(index);
          }
        }
      }
    });
    const wildTrees = this.placeTrees(map.scenery.seed, map.scenery.treesPerKilometer);
    this.streetLamps = this.placeStreetLamps(map.scenery.streetLampSpacingMeters);
    // The rest of the scenery keeps clear of everything solid placed so far, and of itself.
    const occupancy = new Occupancy();
    for (const circle of [
      ...wildTrees,
      ...this.streetLamps,
      ...this.citySigns.flatMap(signPosts),
      ...this.hayBales,
      ...this.windTurbines,
      ...(this.sea?.cranes.flatMap(craneLegs) ?? []),
    ]) {
      occupancy.add(circle.x, circle.z, circle.radius);
    }
    const { seed, streetscape = false, countryside = false } = map.scenery;
    // The country's scenery asks how near the roads it is from further out than the trees do.
    const sceneryRoads = countryside ? new RoadGrid(this.roads, SCENERY_ROAD_REACH_METERS) : this.roadGrid;
    const ground: SceneryGround & TownGround = {
      roads: this.roads,
      fields: this.fields,
      isClear: (x, z) => this.isClearForTree(x, z),
      isClearForWalk: (x, z) => this.isClearForWalk(x, z),
      nearRoad: (x, z, clearanceMeters) => sceneryRoads.nearRoad(x, z, clearanceMeters),
    };
    // The towns first (their pavements run where the streets do), then the country.
    this.sidewalks = streetscape ? placeSidewalks(ground) : [];
    this.pavements = new PavementGrid(this.roads, this.sidewalks);
    this.streetFurniture = streetscape ? placeStreetFurniture(ground, this.sidewalks, occupancy) : [];
    this.speedSigns = streetscape
      ? placeSpeedSigns(
          ground,
          map.citySigns.map((sign) => ({
            roadIndex: this.roads.findIndex((road) => road.id === sign.roadId),
            distanceMeters: sign.distanceMeters,
            direction: sign.direction,
          })),
          occupancy,
        )
      : [];
    this.billboards = streetscape ? placeBillboards(ground, occupancy) : [];
    this.powerLines = countryside ? placePowerLines(ground, occupancy) : [];
    this.fieldEdges = countryside ? placeFieldEdges(ground) : [];
    const plantedTrees = countryside ? plantTrees(ground, occupancy, seed) : [];
    this.rocks = countryside ? placeRocks(ground, occupancy, map.halfSizeMeters, seed) : [];
    this.grazers = countryside ? placeGrazers(ground, occupancy, seed) : [];
    this.trees = [...wildTrees, ...plantedTrees];
    const circles = [
      ...this.trees,
      ...this.streetLamps,
      ...this.citySigns.flatMap(signPosts),
      ...this.hayBales,
      ...this.windTurbines,
      ...(this.sea?.cranes.flatMap(craneLegs) ?? []),
      ...this.powerLines.flatMap((line) => line.poles),
      ...this.rocks,
      ...this.grazers,
      ...this.streetFurniture,
      ...this.billboards.flatMap(billboardLegs),
      ...this.speedSigns,
    ];
    this.circleX = Float64Array.from(circles, (circle) => circle.x);
    this.circleZ = Float64Array.from(circles, (circle) => circle.z);
    this.circleRadius = Float64Array.from(circles, (circle) => circle.radius);
    this.maxCircleRadius = Math.max(0, ...this.circleRadius);
    circles.forEach((circle, index) => {
      const key = cellKey(cellOf(circle.x), cellOf(circle.z));
      const bucket = this.circleGrid.get(key);
      if (bucket === undefined) {
        this.circleGrid.set(key, [index]);
      } else {
        bucket.push(index);
      }
    });
  }

  /**
   * The ground under a point: asphalt on any road, pavement, turning circle,
   * depot yard or rest area lot, grass everywhere else. Allocation-free: the
   * truck asks every fixed step.
   */
  surfaceAt(x: number, z: number): Surface {
    if (this.roadGrid.onRoad(x, z) || this.pavements.contains(x, z)) {
      return ASPHALT;
    }
    if (this.isOnQuay(x, z)) {
      return ASPHALT;
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

  /** Whether (x, z) is in the sea, or within `margin` meters of it. Always false on a map without one. */
  isWater(x: number, z: number, margin = 0): boolean {
    return this.sea !== null && isInSea(this.sea.shoreline, x, z, margin);
  }

  /** Whether (x, z) is on a quay (paved, like a yard), or within `margin` meters of one. */
  isOnQuay(x: number, z: number, margin = 0): boolean {
    const sea = this.sea;
    if (sea === null) {
      return false;
    }
    for (let i = 0; i < sea.quays.length; i++) {
      const quay = sea.quays[i]!;
      if (z < quay.fromZ - margin || z > quay.toZ + margin) {
        continue;
      }
      const shore = shorelineXAt(sea.shoreline, z);
      if (x >= shore - margin && x <= shore + quay.widthMeters + margin) {
        return true;
      }
    }
    return false;
  }

  /** The depot of `cityId` on this map, if it has one. */
  depotOf(cityId: string): DepotDefinition | undefined {
    return this.depots.find((depot) => depot.cityId === cityId);
  }

  /**
   * Pushes the truck out of trees and posts, guard rails, buildings, the map boundary and moving
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
    const reach = radius + this.maxCircleRadius;
    let cx = state.x + Math.sin(state.heading) * offset;
    let cz = state.z + Math.cos(state.heading) * offset;
    const minCellX = cellOf(cx - reach);
    const maxCellX = cellOf(cx + reach);
    const minCellZ = cellOf(cz - reach);
    const maxCellZ = cellOf(cz + reach);
    for (let gx = minCellX; gx <= maxCellX; gx++) {
      for (let gz = minCellZ; gz <= maxCellZ; gz++) {
        const bucket = this.circleGrid.get(cellKey(gx, gz));
        if (bucket === undefined) {
          continue;
        }
        for (let k = 0; k < bucket.length; k++) {
          const index = bucket[k]!;
          const dx = cx - this.circleX[index]!;
          const dz = cz - this.circleZ[index]!;
          const minDistance = radius + this.circleRadius[index]!;
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

    const railReach = radius + RAIL_HALF_WIDTH_METERS;
    for (let gx = cellOf(cx - railReach); gx <= cellOf(cx + railReach); gx++) {
      for (let gz = cellOf(cz - railReach); gz <= cellOf(cz + railReach); gz++) {
        const bucket = this.railGrid.get(cellKey(gx, gz));
        if (bucket === undefined) {
          continue;
        }
        for (let k = 0; k < bucket.length; k++) {
          const index = bucket[k]!;
          const ax = this.railAX[index]!;
          const az = this.railAZ[index]!;
          const dx = this.railBX[index]! - ax;
          const dz = this.railBZ[index]! - az;
          // The nearest point of the piece, a flat wall with rounded ends.
          const t = clamp01(((cx - ax) * dx + (cz - az) * dz) / (dx * dx + dz * dz || 1));
          const offX = cx - (ax + dx * t);
          const offZ = cz - (az + dz * t);
          const distanceSquared = offX * offX + offZ * offZ;
          if (distanceSquared >= railReach * railReach) {
            continue;
          }
          if (distanceSquared > 1e-12) {
            const distance = Math.sqrt(distanceSquared);
            this.pushOut(state, offset, offX / distance, offZ / distance, railReach - distance);
          } else {
            this.pushOut(state, offset, this.railRoadwardX[index]!, this.railRoadwardZ[index]!, railReach);
          }
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

    if (this.sea !== null) {
      this.collideShore(state, offset, radius, this.sea.shoreline);
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
   * The shore is a wall: keeps one footprint circle on the land side of every
   * stretch of shoreline within its reach, SHORE_WALL_MARGIN short of the
   * water. Allocation-free.
   */
  private collideShore(state: VehicleRuntimeState, offset: number, radius: number, shoreline: readonly Point2[]): void {
    const reach = radius + SHORE_WALL_MARGIN;
    for (let i = 0; i < shoreline.length - 1; i++) {
      const cx = state.x + Math.sin(state.heading) * offset;
      const cz = state.z + Math.cos(state.heading) * offset;
      const [x0, z0] = shoreline[i]!;
      const [x1, z1] = shoreline[i + 1]!;
      if (z1 < cz - reach || z0 > cz + reach || cx - reach > Math.max(x0, x1)) {
        continue;
      }
      const dx = x1 - x0;
      const dz = z1 - z0;
      const lengthSquared = dx * dx + dz * dz;
      const length = Math.sqrt(lengthSquared);
      // The shore runs toward +z with the land on its left: east of it.
      const nx = dz / length;
      const nz = -dx / length;
      const t = clamp01(((cx - x0) * dx + (cz - z0) * dz) / lengthSquared);
      const landward = (cx - (x0 + dx * t)) * nx + (cz - (z0 + dz * t)) * nz;
      if (landward < reach) {
        this.pushOut(state, offset, nx, nz, reach - landward);
      }
    }
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

  /**
   * Lines the city roads (streets and ring roads) with lamps every
   * `spacingMeters`, on alternate sides, their arms reaching over the road.
   * Where a lamp would stand in the way (see isClearForLamp) it is left out.
   */
  private placeStreetLamps(spacingMeters: number | undefined): StreetLamp[] {
    const lamps: StreetLamp[] = [];
    if (spacingMeters === undefined) {
      return lamps;
    }
    const point = createRoadPoint();
    for (const road of this.roads) {
      if (road.kind !== 'street' && road.kind !== 'ringRoad') {
        continue;
      }
      const count = Math.floor(road.lengthMeters / spacingMeters);
      for (let i = 0; i < count; i++) {
        const { x: roadX, z: roadZ, directionX: ux, directionZ: uz } = road.pointAt((i + 0.5) * spacingMeters, point);
        // Right of the direction of travel is (-uz, ux); every other lamp stands on the left.
        const side = i % 2 === 0 ? 1 : -1;
        const offset = side * (road.widthMeters / 2 + STREET_LAMP_SETBACK_METERS);
        const x = roadX - uz * offset;
        const z = roadZ + ux * offset;
        if (this.isClearForLamp(x, z)) {
          // The arm reaches back toward the centreline.
          lamps.push({ x, z, heading: Math.atan2(uz * side, -ux * side), radius: LAMP_POST_RADIUS });
        }
      }
    }
    return lamps;
  }

  /** The road with `id`: map content names roads that exist (validated), so a missing one is a bug. */
  private roadById(id: string): RoadPath {
    const road = this.roads.find((candidate) => candidate.id === id);
    if (road === undefined) {
      throw new Error(`Unknown road "${id}": the content should have been validated.`);
    }
    return road;
  }

  /** Where a name board stands: beside its road, on the right of the traffic it greets, facing it. */
  private placeCitySign(sign: CitySignDefinition): CitySign {
    const road = this.roadById(sign.roadId);
    const { x, z, directionX, directionZ } = road.pointAt(sign.distanceMeters, createRoadPoint());
    const along = sign.direction === 'forward' ? 1 : -1;
    // The traffic drives along (dx, dz); its right is (-dz, dx), and the board faces back at it.
    const dx = directionX * along;
    const dz = directionZ * along;
    const offset = road.widthMeters / 2 + CITY_SIGN_SETBACK_METERS;
    return { cityId: sign.cityId, x: x - dz * offset, z: z + dx * offset, heading: Math.atan2(-dx, -dz) };
  }

  /**
   * A field's rectangle: along the chord of its stretch of road, set back
   * from the road's edge where the road bulges furthest toward it, so a
   * bend never runs into the field.
   */
  private placeField(field: FieldDefinition): Field {
    const road = this.roadById(field.roadId);
    const start = road.pointAt(field.fromMeters, createRoadPoint());
    const end = road.pointAt(field.fromMeters + field.lengthMeters, createRoadPoint());
    const chordX = end.x - start.x;
    const chordZ = end.z - start.z;
    const chord = Math.hypot(chordX, chordZ) || 1;
    const ux = chordX / chord;
    const uz = chordZ / chord;
    // Toward the field: right of the road's direction is (-uz, ux).
    const side = field.side === 'right' ? 1 : -1;
    const nx = -uz * side;
    const nz = ux * side;
    const middleX = (start.x + end.x) / 2;
    const middleZ = (start.z + end.z) / 2;
    // The centreline is straight between samples, so it bulges furthest at one of them (or at an end).
    let bulge = Math.max(
      0,
      (start.x - middleX) * nx + (start.z - middleZ) * nz,
      (end.x - middleX) * nx + (end.z - middleZ) * nz,
    );
    for (let i = 0; i < road.pointCount; i++) {
      const along = road.distances[i]! - field.fromMeters;
      const within = road.closed ? ((along % road.lengthMeters) + road.lengthMeters) % road.lengthMeters : along;
      if (within >= 0 && within <= field.lengthMeters) {
        bulge = Math.max(bulge, (road.x(i) - middleX) * nx + (road.z(i) - middleZ) * nz);
      }
    }
    const offset = bulge + road.widthMeters / 2 + field.setbackMeters + field.depthMeters / 2;
    return {
      crop: field.crop,
      area: {
        x: middleX + nx * offset,
        z: middleZ + nz * offset,
        headingDegrees: (Math.atan2(ux, uz) * 180) / Math.PI,
        lengthMeters: chord,
        widthMeters: field.depthMeters,
      },
    };
  }

  private isClearForLamp(x: number, z: number): boolean {
    const limit = this.halfSizeMeters - LAMP_BOUNDARY_MARGIN;
    if (Math.abs(x) > limit || Math.abs(z) > limit) {
      return false;
    }
    if (this.isWater(x, z, LAMP_SHORE_CLEARANCE) || this.isOnQuay(x, z, LAMP_BUILDING_CLEARANCE)) {
      return false;
    }
    if (this.hidesCitySign(x, z)) {
      return false;
    }
    if (this.roadGrid.nearRoad(x, z, LAMP_ROAD_CLEARANCE)) {
      return false; // On or beside another road.
    }
    if (this.network.junctions.some((junction) => Math.hypot(x - junction.x, z - junction.z) < LAMP_JUNCTION_CLEARANCE)) {
      return false;
    }
    if (this.depots.some((depot) => rectangleContains(depot.yard, x, z, LAMP_YARD_CLEARANCE))) {
      return false;
    }
    if (this.restAreas.some((restArea) => rectangleContains(restArea.lot, x, z, LAMP_YARD_CLEARANCE))) {
      return false;
    }
    if (
      this.turningCircles.some(
        (circle) => Math.hypot(x - circle.x, z - circle.z) < circle.radiusMeters + LAMP_YARD_CLEARANCE,
      )
    ) {
      return false;
    }
    return this.buildings.every(
      (box) =>
        Math.hypot(x - clamp(x, box.minX, box.maxX), z - clamp(z, box.minZ, box.maxZ)) >= LAMP_BUILDING_CLEARANCE,
    );
  }

  /**
   * Whether a guard rail's post may stand at (x, z): not by the water or on
   * a quay, not beside another road, clear of junctions, yards, lots,
   * turning circles, the spawn and buildings, inside the map.
   */
  private isClearForRail(x: number, z: number): boolean {
    const limit = this.halfSizeMeters - RAIL_BOUNDARY_MARGIN;
    if (Math.abs(x) > limit || Math.abs(z) > limit) {
      return false;
    }
    if (this.isWater(x, z, RAIL_SHORE_CLEARANCE) || this.isOnQuay(x, z, RAIL_YARD_CLEARANCE)) {
      return false;
    }
    if (this.roadGrid.nearRoad(x, z, RAIL_ROAD_CLEARANCE)) {
      return false;
    }
    if (this.network.junctions.some((junction) => Math.hypot(x - junction.x, z - junction.z) < RAIL_JUNCTION_CLEARANCE)) {
      return false;
    }
    if (Math.hypot(x - this.spawn.x, z - this.spawn.z) < RAIL_SPAWN_CLEARANCE) {
      return false;
    }
    if (this.depots.some((depot) => rectangleContains(depot.yard, x, z, RAIL_YARD_CLEARANCE))) {
      return false;
    }
    if (this.restAreas.some((restArea) => rectangleContains(restArea.lot, x, z, RAIL_YARD_CLEARANCE))) {
      return false;
    }
    if (
      this.turningCircles.some(
        (circle) => Math.hypot(x - circle.x, z - circle.z) < circle.radiusMeters + RAIL_YARD_CLEARANCE,
      )
    ) {
      return false;
    }
    return this.buildings.every(
      (box) =>
        Math.hypot(x - clamp(x, box.minX, box.maxX), z - clamp(z, box.minZ, box.maxZ)) >= RAIL_BUILDING_CLEARANCE,
    );
  }

  /** Whether something standing at (x, z) would be in the way of a name board. */
  private hidesCitySign(x: number, z: number): boolean {
    return this.citySigns.some((sign) => Math.hypot(x - sign.x, z - sign.z) < SIGN_CLEARANCE_METERS);
  }

  /**
   * Whether a pavement may run through (x, z): off every road's surface (with
   * a little margin: its own lies beside it), out of the depot yards, rest
   * area lots, turning circles and quays, where trucks drive in.
   */
  private isClearForWalk(x: number, z: number): boolean {
    if (this.roadGrid.nearRoad(x, z, WALK_ROAD_CLEARANCE)) {
      return false;
    }
    if (this.isWater(x, z, 1) || this.isOnQuay(x, z, WALK_YARD_CLEARANCE)) {
      return false;
    }
    if (this.depots.some((depot) => rectangleContains(depot.yard, x, z, WALK_YARD_CLEARANCE))) {
      return false;
    }
    if (this.restAreas.some((restArea) => rectangleContains(restArea.lot, x, z, WALK_YARD_CLEARANCE))) {
      return false;
    }
    return this.turningCircles.every((circle) => Math.hypot(x - circle.x, z - circle.z) > circle.radiusMeters + WALK_YARD_CLEARANCE);
  }

  private isClearForTree(x: number, z: number): boolean {
    const limit = this.halfSizeMeters - TREE_BOUNDARY_MARGIN;
    if (Math.abs(x) > limit || Math.abs(z) > limit) {
      return false;
    }
    if (this.isWater(x, z, TREE_SHORE_CLEARANCE) || this.isOnQuay(x, z, TREE_YARD_CLEARANCE)) {
      return false;
    }
    if (this.hidesCitySign(x, z)) {
      return false;
    }
    if (this.fields.some((field) => rectangleContains(field.area, x, z, TREE_FIELD_CLEARANCE))) {
      return false;
    }
    if (this.windTurbines.some((turbine) => Math.hypot(x - turbine.x, z - turbine.z) < TREE_TURBINE_CLEARANCE)) {
      return false;
    }
    if (Math.hypot(x - this.spawn.x, z - this.spawn.z) < TREE_SPAWN_CLEARANCE) {
      return false;
    }
    if (this.roadGrid.nearRoad(x, z, TREE_ROAD_CLEARANCE - 0.5)) {
      return false; // Another stretch of road passes close by.
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

/**
 * The sea from its definition: boats and cranes with their headings in
 * radians, and boulders along the natural shore, every
 * SHORE_ROCK_SPACING_METERS or so from the map's north edge to its south
 * edge, straddling the waterline, none along the quays. The same seed
 * always lays the same boulders.
 */
function createSea(sea: SeaDefinition, halfSize: number, seed: number): Sea {
  const random = new SeededRandom(seed ^ 0x27d4eb2f);
  const rocks: ShoreRock[] = [];
  for (let z = -halfSize; z <= halfSize; z += SHORE_ROCK_SPACING_METERS) {
    // Draw every number for every spot, so a skipped boulder does not shift the others.
    const along = z + random.range(-2, 2);
    const across = random.range(-SHORE_ROCK_SCATTER_METERS, SHORE_ROCK_SCATTER_METERS);
    const size = random.range(1, 2.6);
    const turn = random.range(0, Math.PI * 2);
    const onQuay = sea.quays.some((quay) => along > quay.fromZ - 3 && along < quay.toZ + 3);
    if (!onQuay) {
      rocks.push({ x: shorelineXAt(sea.shoreline, along) + across, z: along, size, turn });
    }
  }
  return {
    shoreline: sea.shoreline,
    quays: sea.quays,
    boats: sea.boats.map(({ kind, x, z, headingDegrees }) => ({ kind, x, z, heading: degreesToRadians(headingDegrees) })),
    cranes: sea.cranes.map(({ x, z, headingDegrees }) => ({ x, z, heading: degreesToRadians(headingDegrees) })),
    rocks,
  };
}

/** A crane's four legs: the portal's corners, across the quay (along the jib) and along it. */
function craneLegs(crane: Crane): { x: number; z: number; radius: number }[] {
  const jibX = Math.sin(crane.heading);
  const jibZ = Math.cos(crane.heading);
  const legs: { x: number; z: number; radius: number }[] = [];
  for (const across of [-CRANE_HALF_GAUGE_METERS, CRANE_HALF_GAUGE_METERS]) {
    for (const along of [-CRANE_HALF_BASE_METERS, CRANE_HALF_BASE_METERS]) {
      legs.push({
        x: crane.x + jibX * across + jibZ * along,
        z: crane.z + jibZ * across - jibX * along,
        radius: CRANE_LEG_RADIUS,
      });
    }
  }
  return legs;
}

/** A name board's two posts, either side of its middle across the way it faces. */
function signPosts(sign: CitySign): { x: number; z: number; radius: number }[] {
  const acrossX = Math.cos(sign.heading) * (CITY_SIGN_POST_SPACING_METERS / 2);
  const acrossZ = -Math.sin(sign.heading) * (CITY_SIGN_POST_SPACING_METERS / 2);
  return [
    { x: sign.x + acrossX, z: sign.z + acrossZ, radius: SIGN_POST_RADIUS },
    { x: sign.x - acrossX, z: sign.z - acrossZ, radius: SIGN_POST_RADIUS },
  ];
}

/**
 * Round bales left in rows on the harvested (stubble) fields, where the
 * baler dropped them: a row every BALE_ROW_SPACING_METERS across the field,
 * a bale about every BALE_SPACING_METERS along it, some missing. The same
 * seed always lays the same bales.
 */
function placeHayBales(fields: readonly Field[], seed: number): HayBale[] {
  const random = new SeededRandom(seed ^ 0x5bd1e995);
  const bales: HayBale[] = [];
  for (const { area, crop } of fields) {
    if (crop !== 'stubble') {
      continue;
    }
    const heading = (area.headingDegrees * Math.PI) / 180;
    const alongX = Math.sin(heading);
    const alongZ = Math.cos(heading);
    const halfWidth = area.widthMeters / 2 - BALE_EDGE_MARGIN_METERS;
    const halfLength = area.lengthMeters / 2 - BALE_EDGE_MARGIN_METERS;
    for (let across = -halfWidth; across <= halfWidth; across += BALE_ROW_SPACING_METERS) {
      for (let along = -halfLength; along <= halfLength; along += BALE_SPACING_METERS) {
        // Draw every number for every spot, so a skipped bale does not shift the others.
        const skip = random.next() < BALE_SKIP_CHANCE;
        const jitter = random.range(-3, 3);
        const turn = random.range(-0.3, 0.3);
        const at = Math.max(-halfLength, Math.min(halfLength, along + jitter));
        if (!skip) {
          bales.push({
            x: area.x + alongX * at + alongZ * across,
            z: area.z + alongZ * at - alongX * across,
            heading: heading + turn,
            radius: BALE_RADIUS,
          });
        }
      }
    }
  }
  return bales;
}
