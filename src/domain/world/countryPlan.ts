import {
  rectangleContains,
  rectangleCorners,
  type BuildingDefinition,
  type FieldDefinition,
  type ParkDefinition,
  type Point2,
  type RectangleDefinition,
} from '../../data/definitions/MapDefinition';
import { Buckets } from './buckets';
import { cellKey, cellOf } from './gridCells';
import { LandRouter } from './landRoutes';
import { RoadGrid } from './RoadGrid';
import { TURNING_CIRCLE_OFFSET_METERS, TURNING_CIRCLE_RADIUS_METERS } from './RoadNetwork';
import type { RoadPath } from './RoadPath';

/** What the land holds before anything grows on it, as the new roads, buildings and fields ask it (OpenLand answers). */
export interface CountryLand {
  readonly halfSizeMeters: number;
  /** Whether a new road's centreline may pass (x, z): on open land, clear of whatever the map holds but its roads. */
  isOpenForRoad(x: number, z: number): boolean;
  /** Whether roads may meet at (x, z): clear of the bridges, name boards, yards and lots. */
  canJoinAt(x: number, z: number): boolean;
  /** Whether a building (or a park) may stand on `area`: likewise. */
  isOpenForBuilding(area: RectangleDefinition): boolean;
  /** Whether a field may lie on `area`: likewise. */
  isOpenForField(area: RectangleDefinition): boolean;
}

/**
 * A new road's centreline keeps this far from any other road's edge,
 * meters, but within this far of where it meets a road.
 */
export const ROAD_CLEARANCE_METERS = 38;
export const JUNCTION_REACH_METERS = 60;
/** Roads meet no nearer than this to any other road, meters, so junctions keep apart. */
const JUNCTION_SPACING_METERS = 140;
/** New roads keep this far from the buildings, fields and parks grown before them, meters. */
const ROAD_BUILDING_CLEARANCE_METERS = 18;
const ROAD_FIELD_CLEARANCE_METERS = 12;
const ROAD_PARK_CLEARANCE_METERS = 30;
/** Buildings keep this far from any road's edge and from a turning circle's rim, and this far apart, meters. */
const BUILDING_ROAD_CLEARANCE_METERS = 6.5;
const BUILDING_CIRCLE_CLEARANCE_METERS = 5;
const BUILDING_GAP_METERS = 4;
/** Fields keep this far from any road's edge and turning circle, this far from the buildings, and this far apart, meters. */
const FIELD_ROAD_CLEARANCE_METERS = 9.5;
const FIELD_BUILDING_CLEARANCE_METERS = 6;
const FIELD_GAP_METERS = 4;
/** Parks keep this far from any road's edge and the buildings, meters. */
const PARK_ROAD_CLEARANCE_METERS = 6;
const PARK_BUILDING_CLEARANCE_METERS = 4;
/** Rectangles' rims are looked along every this many meters. */
const RIM_SPACING_METERS = 2;
/** What grows is filed in cells this big, grown by the furthest any question looks from each kind. */
const BUCKET_METERS = 100;
const BUILDING_REACH_METERS = Math.max(ROAD_BUILDING_CLEARANCE_METERS, BUILDING_GAP_METERS, FIELD_BUILDING_CLEARANCE_METERS);
const FIELD_REACH_METERS = Math.max(ROAD_FIELD_CLEARANCE_METERS, FIELD_GAP_METERS, FIELD_BUILDING_CLEARANCE_METERS);
const PARK_REACH_METERS = Math.max(ROAD_PARK_CLEARANCE_METERS, PARK_BUILDING_CLEARANCE_METERS, FIELD_GAP_METERS);
/** Samples a few centimetres from a road's straight pieces between them: a little margin covers it. */
const SAMPLE_MARGIN_METERS = 0.5;

/**
 * What has grown on a map's land so far, beyond what its author laid out
 * (villages.ts, sideRoads.ts): new roads, buildings, fields and parks, and
 * where each new thing may go, clear of the land's own things and of each
 * other, at the distances the map's own keep.
 */
export class CountryPlan {
  /** The map's roads, then the new ones: a road's index is its index here. */
  readonly roads: RoadPath[];
  readonly mapRoadCount: number;
  readonly buildings: BuildingDefinition[] = [];
  readonly fields: FieldDefinition[] = [];
  readonly parks: ParkDefinition[] = [];
  /** The middles of the turning circles at the new roads' dead ends. */
  readonly circles: Point2[] = [];
  /** Finds ways across the land for new roads. */
  readonly router: LandRouter;
  private readonly fieldAreas: RectangleDefinition[] = [];
  /** Each field's bounds, not grown: minX, maxX, minZ, maxZ. */
  private readonly fieldBounds: number[] = [];
  private readonly buildingBuckets = new Buckets(BUCKET_METERS);
  private readonly fieldBuckets = new Buckets(BUCKET_METERS);
  private readonly parkBuckets = new Buckets(BUCKET_METERS);
  /** The map's roads' pieces, to keep new things clear of them. */
  private readonly mapRoadGrid: RoadGrid;
  /** Each of the map's roads' bounds, grown by half its width: minX, maxX, minZ, maxZ. */
  private readonly mapRoadBounds: Float64Array;
  /** The new roads' samples, filed by grid cell: x, z and the road's index, for each. */
  private readonly samples = new Map<number, number[]>();
  /** Half the widest new road's width, meters. */
  private widestHalf = 0;

  constructor(
    readonly land: CountryLand,
    mapRoads: readonly RoadPath[],
  ) {
    this.roads = [...mapRoads];
    this.mapRoadCount = mapRoads.length;
    this.mapRoadGrid = new RoadGrid(mapRoads, ROAD_CLEARANCE_METERS);
    this.mapRoadBounds = new Float64Array(mapRoads.length * 4);
    mapRoads.forEach((road, index) => {
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let i = 0; i < road.pointCount; i++) {
        minX = Math.min(minX, road.x(i));
        maxX = Math.max(maxX, road.x(i));
        minZ = Math.min(minZ, road.z(i));
        maxZ = Math.max(maxZ, road.z(i));
      }
      const half = road.widthMeters / 2;
      this.mapRoadBounds.set([minX - half, maxX + half, minZ - half, maxZ + half], index * 4);
    });
    this.router = new LandRouter({ halfSizeMeters: land.halfSizeMeters, isLandOpen: (x, z) => land.isOpenForRoad(x, z) });
  }

  /** The new roads, in the order they were added. */
  get newRoads(): readonly RoadPath[] {
    return this.roads.slice(this.mapRoadCount);
  }

  /**
   * Whether a new road may pass (x, z): open land, clear of what has grown
   * and of the other roads, but within JUNCTION_REACH_METERS of where it
   * meets them, (x0, z0) and (x1, z1) (NaN: nowhere).
   */
  isClearForRoad(x: number, z: number, x0 = Number.NaN, z0 = Number.NaN, x1 = Number.NaN, z1 = Number.NaN): boolean {
    return this.land.isOpenForRoad(x, z) && this.isClearSinceLand(x, z, x0, z0, x1, z1);
  }

  /**
   * isClearForRoad but for the land's own things: clear of what has grown,
   * and of the other roads but near (x0, z0) and (x1, z1). The router asks
   * this of the cells it knows are open land.
   */
  isClearSinceLand(x: number, z: number, x0 = Number.NaN, z0 = Number.NaN, x1 = Number.NaN, z1 = Number.NaN): boolean {
    if (!this.isClearOfGrowth(x, z)) {
      return false;
    }
    // (NaN never compares less: no junction there.)
    const reach = JUNCTION_REACH_METERS * JUNCTION_REACH_METERS;
    if ((x - x0) * (x - x0) + (z - z0) * (z - z0) < reach || (x - x1) * (x - x1) + (z - z1) * (z - z1) < reach) {
      return true;
    }
    return !this.mapRoadGrid.nearRoad(x, z, ROAD_CLEARANCE_METERS) && !this.nearNewRoad(x, z, ROAD_CLEARANCE_METERS);
  }

  /** Whether the straight run from a to b is clear for a new road meeting others at (x0, z0) and (x1, z1). */
  isClearRun(ax: number, az: number, bx: number, bz: number, x0 = Number.NaN, z0 = Number.NaN, x1 = Number.NaN, z1 = Number.NaN): boolean {
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 5));
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      if (!this.isClearForRoad(ax + (bx - ax) * t, az + (bz - az) * t, x0, z0, x1, z1)) {
        return false;
      }
    }
    return true;
  }

  /** The first sample of `path` past its first that a road may not pass (meeting others at the given points), or -1. */
  firstBlockedSample(path: RoadPath, x0 = Number.NaN, z0 = Number.NaN, x1 = Number.NaN, z1 = Number.NaN): number {
    for (let i = 1; i < path.pointCount; i++) {
      if (!this.isClearForRoad(path.x(i), path.z(i), x0, z0, x1, z1)) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Whether a new road may meet road `roadIndex` at (x, z): where roads may
   * meet, on open land, with no other road near.
   */
  canJunction(x: number, z: number, roadIndex: number): boolean {
    if (!this.land.canJoinAt(x, z) || !this.land.isOpenForRoad(x, z) || !this.isClearOfGrowth(x, z)) {
      return false;
    }
    if (this.nearNewRoad(x, z, JUNCTION_SPACING_METERS, roadIndex)) {
      return false;
    }
    const bounds = this.mapRoadBounds;
    const reach = JUNCTION_SPACING_METERS;
    for (let r = 0; r < this.mapRoadCount; r++) {
      if (
        r === roadIndex ||
        x < bounds[r * 4]! - reach ||
        x > bounds[r * 4 + 1]! + reach ||
        z < bounds[r * 4 + 2]! - reach ||
        z > bounds[r * 4 + 3]! + reach
      ) {
        continue;
      }
      const road = this.roads[r]!;
      if (road.distanceTo(x, z) - road.widthMeters / 2 < reach) {
        return false;
      }
    }
    return true;
  }

  /** Adds a new road. Returns its index. */
  addRoad(path: RoadPath): number {
    const index = this.roads.length;
    this.roads.push(path);
    this.widestHalf = Math.max(this.widestHalf, path.widthMeters / 2);
    for (let i = 0; i < path.pointCount; i++) {
      const key = cellKey(cellOf(path.x(i)), cellOf(path.z(i)));
      const bucket = this.samples.get(key);
      if (bucket === undefined) {
        this.samples.set(key, [path.x(i), path.z(i), index]);
      } else {
        bucket.push(path.x(i), path.z(i), index);
      }
    }
    return index;
  }

  /** Notes the turning circle where `path` ends joining nothing: at its last sample, or its first where `atStart`. */
  addTurningCircle(path: RoadPath, atStart: boolean): void {
    const end = atStart ? 0 : path.pointCount - 1;
    const inward = atStart ? 1 : end - 1;
    const dx = path.x(end) - path.x(inward);
    const dz = path.z(end) - path.z(inward);
    const length = Math.hypot(dx, dz) || 1;
    this.circles.push([
      path.x(end) + (dx / length) * TURNING_CIRCLE_OFFSET_METERS,
      path.z(end) + (dz / length) * TURNING_CIRCLE_OFFSET_METERS,
    ]);
  }

  /**
   * Stands a building `sizeX` by `sizeZ` (and `height` tall) with its
   * middle at (x, z) where it has room: clear of the roads, turning
   * circles, buildings, fields and parks, and of whatever the land holds.
   * Returns whether it stands.
   */
  tryBuilding(x: number, z: number, sizeX: number, sizeZ: number, height: number): boolean {
    const minX = x - sizeX / 2;
    const maxX = x + sizeX / 2;
    const minZ = z - sizeZ / 2;
    const maxZ = z + sizeZ / 2;
    const boxDistance = (px: number, pz: number): number =>
      Math.hypot(px - Math.max(minX, Math.min(px, maxX)), pz - Math.max(minZ, Math.min(pz, maxZ)));
    if (this.circles.some(([cx, cz]) => boxDistance(cx, cz) < TURNING_CIRCLE_RADIUS_METERS + BUILDING_CIRCLE_CLEARANCE_METERS)) {
      return false;
    }
    if (
      this.buildings.some(
        (other) =>
          minX < other.x + other.widthMeters / 2 + BUILDING_GAP_METERS &&
          maxX > other.x - other.widthMeters / 2 - BUILDING_GAP_METERS &&
          minZ < other.z + other.depthMeters / 2 + BUILDING_GAP_METERS &&
          maxZ > other.z - other.depthMeters / 2 - BUILDING_GAP_METERS,
      )
    ) {
      return false;
    }
    const area: RectangleDefinition = { x, z, headingDegrees: 0, lengthMeters: sizeZ, widthMeters: sizeX };
    if (this.parks.some((park) => overlaps(park.area, area, PARK_BUILDING_CLEARANCE_METERS))) {
      return false;
    }
    const clear = (px: number, pz: number): boolean =>
      !this.mapRoadGrid.nearRoad(px, pz, BUILDING_ROAD_CLEARANCE_METERS) &&
      !this.nearNewRoad(px, pz, BUILDING_ROAD_CLEARANCE_METERS + SAMPLE_MARGIN_METERS) &&
      this.fieldBuckets.at(px, pz).every((id) => !rectangleContains(this.fieldAreas[id]!, px, pz, FIELD_BUILDING_CLEARANCE_METERS));
    if (!clear(x, z) || !alongRim(area, clear) || !this.land.isOpenForBuilding(area)) {
      return false;
    }
    const reach = BUILDING_REACH_METERS;
    this.buildingBuckets.add(this.buildings.length, minX - reach, maxX + reach, minZ - reach, maxZ + reach);
    this.buildings.push({ x, z, widthMeters: sizeX, depthMeters: sizeZ, heightMeters: height });
    return true;
  }

  /** Lays `field` (on `area`) where it has room: clear of the roads, circles, buildings, parks, other fields and whatever the land holds. */
  tryField(field: FieldDefinition, area: RectangleDefinition): boolean {
    const inside = (x: number, z: number, margin: number): boolean => rectangleContains(area, x, z, margin);
    if (
      this.circles.some(([x, z]) => inside(x, z, TURNING_CIRCLE_RADIUS_METERS + FIELD_ROAD_CLEARANCE_METERS)) ||
      this.buildings.some((box) => inside(box.x, box.z, FIELD_BUILDING_CLEARANCE_METERS + Math.max(box.widthMeters, box.depthMeters) / 2)) ||
      this.overlapsField(area, FIELD_GAP_METERS) ||
      this.parks.some((park) => overlaps(park.area, area, FIELD_GAP_METERS))
    ) {
      return false;
    }
    const clear = (x: number, z: number): boolean =>
      !this.mapRoadGrid.nearRoad(x, z, FIELD_ROAD_CLEARANCE_METERS) &&
      !this.nearNewRoad(x, z, FIELD_ROAD_CLEARANCE_METERS + SAMPLE_MARGIN_METERS) &&
      this.buildingBuckets.at(x, z).every((id) => boxDistance(this.buildings[id]!, x, z) >= FIELD_BUILDING_CLEARANCE_METERS);
    if (!clear(area.x, area.z) || !alongRim(area, clear) || !this.land.isOpenForField(area)) {
      return false;
    }
    const [minX, maxX, minZ, maxZ] = bounds(area, 0);
    const reach = FIELD_REACH_METERS;
    this.fieldBuckets.add(this.fieldAreas.length, minX - reach, maxX + reach, minZ - reach, maxZ + reach);
    this.fieldBounds.push(minX, maxX, minZ, maxZ);
    this.fields.push(field);
    this.fieldAreas.push(area);
    return true;
  }

  /** Lays out `park` where it has room: clear of the roads, circles, buildings, fields, other parks and whatever the land holds. */
  tryPark(park: ParkDefinition): boolean {
    const area = park.area;
    if (
      this.circles.some(([x, z]) => rectangleContains(area, x, z, TURNING_CIRCLE_RADIUS_METERS + PARK_ROAD_CLEARANCE_METERS)) ||
      this.buildings.some((box) =>
        overlaps({ x: box.x, z: box.z, headingDegrees: 0, lengthMeters: box.depthMeters, widthMeters: box.widthMeters }, area, PARK_BUILDING_CLEARANCE_METERS),
      ) ||
      this.overlapsField(area, FIELD_GAP_METERS) ||
      this.parks.some((other) => overlaps(other.area, area, FIELD_GAP_METERS))
    ) {
      return false;
    }
    const clear = (x: number, z: number): boolean =>
      !this.mapRoadGrid.nearRoad(x, z, PARK_ROAD_CLEARANCE_METERS) && !this.nearNewRoad(x, z, PARK_ROAD_CLEARANCE_METERS + SAMPLE_MARGIN_METERS);
    if (!clear(area.x, area.z) || !alongRim(area, clear) || !this.land.isOpenForBuilding(area)) {
      return false;
    }
    const [minX, maxX, minZ, maxZ] = bounds(area, PARK_REACH_METERS);
    this.parkBuckets.add(this.parks.length, minX, maxX, minZ, maxZ);
    this.parks.push(park);
    return true;
  }

  /** Whether a field grown so far comes within `gap` of `area`. */
  private overlapsField(area: RectangleDefinition, gap: number): boolean {
    const [minX, maxX, minZ, maxZ] = bounds(area, gap);
    const bounded = this.fieldBounds;
    for (let id = 0; id < this.fieldAreas.length; id++) {
      if (
        bounded[id * 4 + 1]! >= minX &&
        bounded[id * 4]! <= maxX &&
        bounded[id * 4 + 3]! >= minZ &&
        bounded[id * 4 + 2]! <= maxZ &&
        overlaps(this.fieldAreas[id]!, area, gap)
      ) {
        return true;
      }
    }
    return false;
  }

  /** Whether none of the buildings, fields and parks grown so far is in a new road's way at (x, z). */
  private isClearOfGrowth(x: number, z: number): boolean {
    for (const id of this.buildingBuckets.at(x, z)) {
      if (boxDistance(this.buildings[id]!, x, z) < ROAD_BUILDING_CLEARANCE_METERS) {
        return false;
      }
    }
    for (const id of this.fieldBuckets.at(x, z)) {
      if (rectangleContains(this.fieldAreas[id]!, x, z, ROAD_FIELD_CLEARANCE_METERS)) {
        return false;
      }
    }
    for (const id of this.parkBuckets.at(x, z)) {
      if (rectangleContains(this.parks[id]!.area, x, z, ROAD_PARK_CLEARANCE_METERS)) {
        return false;
      }
    }
    return true;
  }

  /** Whether (x, z) lies closer than `clearance` to the edge of a new road other than `except`. */
  private nearNewRoad(x: number, z: number, clearance: number, except = -1): boolean {
    const reach = clearance + this.widestHalf;
    for (let cellX = cellOf(x - reach); cellX <= cellOf(x + reach); cellX++) {
      for (let cellZ = cellOf(z - reach); cellZ <= cellOf(z + reach); cellZ++) {
        const bucket = this.samples.get(cellKey(cellX, cellZ));
        if (bucket === undefined) {
          continue;
        }
        for (let k = 0; k < bucket.length; k += 3) {
          const road = bucket[k + 2]!;
          if (road === except) {
            continue;
          }
          const within = clearance + this.roads[road]!.widthMeters / 2;
          const dx = bucket[k]! - x;
          const dz = bucket[k + 1]! - z;
          if (dx * dx + dz * dz < within * within) {
            return true;
          }
        }
      }
    }
    return false;
  }
}

/** Whether `test` holds all along `area`'s rim, looked at every RIM_SPACING_METERS. */
export function alongRim(area: RectangleDefinition, test: (x: number, z: number) => boolean): boolean {
  const corners = rectangleCorners(area);
  return corners.every(([ax, az], index) => {
    const [bx, bz] = corners[(index + 1) % corners.length]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / RIM_SPACING_METERS));
    for (let step = 0; step < steps; step++) {
      if (!test(ax + ((bx - ax) * step) / steps, az + ((bz - az) * step) / steps)) {
        return false;
      }
    }
    return true;
  });
}

/** How far (x, z) lies from a building's walls, meters (0 inside). */
function boxDistance(box: BuildingDefinition, x: number, z: number): number {
  return Math.hypot(
    x - Math.max(box.x - box.widthMeters / 2, Math.min(x, box.x + box.widthMeters / 2)),
    z - Math.max(box.z - box.depthMeters / 2, Math.min(z, box.z + box.depthMeters / 2)),
  );
}

/** A rectangle's bounds grown by `margin`: minX, maxX, minZ, maxZ. */
function bounds(area: RectangleDefinition, margin: number): [number, number, number, number] {
  const corners = rectangleCorners(area);
  const xs = corners.map(([x]) => x);
  const zs = corners.map(([, z]) => z);
  return [Math.min(...xs) - margin, Math.max(...xs) + margin, Math.min(...zs) - margin, Math.max(...zs) + margin];
}

/** Whether two rectangles come within `gap` of each other: a corner of either inside the other grown by it, or their rims crossing. */
function overlaps(a: RectangleDefinition, b: RectangleDefinition, gap: number): boolean {
  const [aMinX, aMaxX, aMinZ, aMaxZ] = bounds(a, gap);
  const [bMinX, bMaxX, bMinZ, bMaxZ] = bounds(b, 0);
  if (aMaxX < bMinX || bMaxX < aMinX || aMaxZ < bMinZ || bMaxZ < aMinZ) {
    return false;
  }
  return (
    rectangleCorners(a).some(([x, z]) => rectangleContains(b, x, z, gap)) ||
    rectangleCorners(b).some(([x, z]) => rectangleContains(a, x, z, gap)) ||
    !alongRim(a, (x, z) => !rectangleContains(b, x, z, gap))
  );
}
