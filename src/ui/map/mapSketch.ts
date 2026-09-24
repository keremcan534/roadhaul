import type { RectangleDefinition, RoadKind } from '../../data/definitions/MapDefinition';
import type { DrivingWorld } from '../../domain/world/DrivingWorld';

/** Road runs keep at most this many points, so each run's bounds stay tight for culling. */
export const MAX_RUN_POINTS = 32;
/** Centreline samples closer than this to the line between the points kept are dropped, meters. */
export const SIMPLIFY_TOLERANCE_METERS = 1.5;
/** Blank ground round the drawn map, meters. */
const MARGIN_METERS = 150;

/** An axis-aligned box on the ground, meters. */
export interface MapBox {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** A stretch of one road, simplified for drawing: x and z interleaved, with its bounds. */
export interface MapRoadRun extends MapBox {
  readonly kind: RoadKind;
  readonly widthMeters: number;
  readonly points: Float64Array;
}

export interface MapDepot {
  readonly id: string;
  readonly cityId: string;
  /** The middle of its yard. */
  readonly x: number;
  readonly z: number;
}

export interface MapRestArea {
  readonly id: string;
  readonly x: number;
  readonly z: number;
}

/** Paved ground off the roads, as a polygon (x and z interleaved): a depot yard or a rest area lot. */
export interface MapPavedArea extends MapBox {
  readonly corners: Float64Array;
}

/** A paved circle where a road ends, for turning round. */
export interface MapCircle {
  readonly x: number;
  readonly z: number;
  readonly radiusMeters: number;
}

/** Where a city's name goes: the middle of its depot and the buildings nearer it than any other depot. */
export interface MapCityLabel {
  readonly cityId: string;
  readonly x: number;
  readonly z: number;
}

/**
 * A world as the 2D maps draw it (the full map and the HUD's minimap):
 * roads simplified into short runs with bounds, building footprints,
 * depots, rest areas and where each city's name goes. Built once per world;
 * no DOM, so it is unit-tested.
 */
export interface MapSketch {
  /** The drawn area: every road, building, yard and lot, with a margin. */
  readonly bounds: MapBox;
  readonly runs: readonly MapRoadRun[];
  /** Depot yards and rest area lots. */
  readonly pavedAreas: readonly MapPavedArea[];
  readonly turningCircles: readonly MapCircle[];
  readonly buildings: readonly MapBox[];
  readonly depots: readonly MapDepot[];
  readonly restAreas: readonly MapRestArea[];
  readonly cities: readonly MapCityLabel[];
}

export function sketchWorld(world: DrivingWorld): MapSketch {
  const runs: MapRoadRun[] = [];
  for (const road of world.roads) {
    let points = road.points;
    if (road.closed && road.pointCount > 1) {
      // Back to the start, so the loop closes.
      points = new Float64Array(road.points.length + 2);
      points.set(road.points);
      points[road.points.length] = road.x(0);
      points[road.points.length + 1] = road.z(0);
    }
    runs.push(...splitRuns(road.kind, road.widthMeters, simplifyPolyline(points, SIMPLIFY_TOLERANCE_METERS), MAX_RUN_POINTS));
  }
  const depots = world.depots.map((depot) => ({ id: depot.id, cityId: depot.cityId, x: depot.yard.x, z: depot.yard.z }));
  const restAreas = world.restAreas.map((restArea) => ({ id: restArea.id, x: restArea.lot.x, z: restArea.lot.z }));
  const buildings = world.buildings.map(({ minX, maxX, minZ, maxZ }) => ({ minX, maxX, minZ, maxZ }));
  const pavedAreas = [...world.depots.map((depot) => depot.yard), ...world.restAreas.map((restArea) => restArea.lot)].map(
    rectangleCorners,
  );
  const turningCircles = world.turningCircles.map(({ x, z, radiusMeters }) => ({ x, z, radiusMeters }));

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const include = (box: MapBox): void => {
    minX = Math.min(minX, box.minX);
    maxX = Math.max(maxX, box.maxX);
    minZ = Math.min(minZ, box.minZ);
    maxZ = Math.max(maxZ, box.maxZ);
  };
  runs.forEach(include);
  pavedAreas.forEach(include);
  buildings.forEach(include);
  for (const place of [...depots, ...restAreas]) {
    include({ minX: place.x, maxX: place.x, minZ: place.z, maxZ: place.z });
  }
  if (minX > maxX) {
    // Nothing to draw: the world's square.
    minX = minZ = -world.halfSizeMeters;
    maxX = maxZ = world.halfSizeMeters;
  }
  return {
    bounds: { minX: minX - MARGIN_METERS, maxX: maxX + MARGIN_METERS, minZ: minZ - MARGIN_METERS, maxZ: maxZ + MARGIN_METERS },
    runs,
    pavedAreas,
    turningCircles,
    buildings,
    depots,
    restAreas,
    cities: cityLabels(depots, buildings),
  };
}

/**
 * Drops the points of a polyline (x and z interleaved) that lie within
 * `tolerance` of the line through the points kept (Ramer–Douglas–Peucker).
 * The first and last points always stay.
 */
export function simplifyPolyline(points: Float64Array, tolerance: number): Float64Array {
  const count = points.length / 2;
  if (count <= 2) {
    return points.slice();
  }
  const keep = new Uint8Array(count);
  keep[0] = 1;
  keep[count - 1] = 1;
  const stack = [0, count - 1];
  while (stack.length > 0) {
    const last = stack.pop()!;
    const first = stack.pop()!;
    let farthest = -1;
    let farthestDistance = tolerance;
    for (let i = first + 1; i < last; i++) {
      const distance = distanceToSegment(
        points[i * 2]!,
        points[i * 2 + 1]!,
        points[first * 2]!,
        points[first * 2 + 1]!,
        points[last * 2]!,
        points[last * 2 + 1]!,
      );
      if (distance > farthestDistance) {
        farthest = i;
        farthestDistance = distance;
      }
    }
    if (farthest >= 0) {
      keep[farthest] = 1;
      stack.push(first, farthest, farthest, last);
    }
  }
  let kept = 0;
  for (let i = 0; i < count; i++) {
    kept += keep[i]!;
  }
  const simplified = new Float64Array(kept * 2);
  let next = 0;
  for (let i = 0; i < count; i++) {
    if (keep[i] === 1) {
      simplified[next++] = points[i * 2]!;
      simplified[next++] = points[i * 2 + 1]!;
    }
  }
  return simplified;
}

/**
 * Cuts a polyline into runs of at most `maxPoints` points. Each run starts
 * where the one before ended, so together they draw the whole line.
 */
export function splitRuns(kind: RoadKind, widthMeters: number, points: Float64Array, maxPoints: number): MapRoadRun[] {
  const count = points.length / 2;
  const runs: MapRoadRun[] = [];
  for (let start = 0; start < count - 1; start += maxPoints - 1) {
    const end = Math.min(count, start + maxPoints);
    const run = points.slice(start * 2, end * 2);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < run.length; i += 2) {
      minX = Math.min(minX, run[i]!);
      maxX = Math.max(maxX, run[i]!);
      minZ = Math.min(minZ, run[i + 1]!);
      maxZ = Math.max(maxZ, run[i + 1]!);
    }
    runs.push({ kind, widthMeters, points: run, minX, maxX, minZ, maxZ });
  }
  return runs;
}

/** A rectangle's four corners, turned by its heading (0° = its length along +z, 90° = along +x). */
export function rectangleCorners(rectangle: RectangleDefinition): MapPavedArea {
  const heading = (rectangle.headingDegrees * Math.PI) / 180;
  // Along its length, and across it.
  const alongX = Math.sin(heading) * (rectangle.lengthMeters / 2);
  const alongZ = Math.cos(heading) * (rectangle.lengthMeters / 2);
  const acrossX = Math.cos(heading) * (rectangle.widthMeters / 2);
  const acrossZ = -Math.sin(heading) * (rectangle.widthMeters / 2);
  const corners = new Float64Array([
    rectangle.x + alongX + acrossX,
    rectangle.z + alongZ + acrossZ,
    rectangle.x + alongX - acrossX,
    rectangle.z + alongZ - acrossZ,
    rectangle.x - alongX - acrossX,
    rectangle.z - alongZ - acrossZ,
    rectangle.x - alongX + acrossX,
    rectangle.z - alongZ + acrossZ,
  ]);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < corners.length; i += 2) {
    minX = Math.min(minX, corners[i]!);
    maxX = Math.max(maxX, corners[i]!);
    minZ = Math.min(minZ, corners[i + 1]!);
    maxZ = Math.max(maxZ, corners[i + 1]!);
  }
  return { corners, minX, maxX, minZ, maxZ };
}

/** Each city's name goes in the middle of its depot and the buildings nearer that depot than any other. */
function cityLabels(depots: readonly MapDepot[], buildings: readonly MapBox[]): MapCityLabel[] {
  const sumX = depots.map((depot) => depot.x);
  const sumZ = depots.map((depot) => depot.z);
  const counts = depots.map(() => 1);
  for (const building of buildings) {
    const x = (building.minX + building.maxX) / 2;
    const z = (building.minZ + building.maxZ) / 2;
    let nearest = -1;
    let nearestDistance = Infinity;
    depots.forEach((depot, index) => {
      const distance = Math.hypot(depot.x - x, depot.z - z);
      if (distance < nearestDistance) {
        nearest = index;
        nearestDistance = distance;
      }
    });
    if (nearest >= 0) {
      sumX[nearest] = sumX[nearest]! + x;
      sumZ[nearest] = sumZ[nearest]! + z;
      counts[nearest] = counts[nearest]! + 1;
    }
  }
  return depots.map((depot, index) => ({
    cityId: depot.cityId,
    x: sumX[index]! / counts[index]!,
    z: sumZ[index]! / counts[index]!,
  }));
}

function distanceToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSquared)) : 0;
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}
