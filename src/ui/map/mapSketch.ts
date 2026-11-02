import {
  shorelineXAt,
  type FieldCrop,
  type MapDefinition,
  type Point2,
  type RectangleDefinition,
  type RoadKind,
} from '../../data/definitions/MapDefinition';
import type { DrivingWorld, Sea } from '../../domain/world/DrivingWorld';
import { RiverPath } from '../../domain/world/RiverPath';
import { RoadPath } from '../../domain/world/RoadPath';

/** Road runs keep at most this many points, so each run's bounds stay tight for culling. */
export const MAX_RUN_POINTS = 32;
/** Centreline samples closer than this to the line between the points kept are dropped, meters. */
export const SIMPLIFY_TOLERANCE_METERS = 1.5;
/** Blank ground round the drawn map, meters. */
const MARGIN_METERS = 150;
/** The sea's polygon reaches this far west of the map, past anything a map zooms out to. */
const SEA_REACH_METERS = 60_000;
/** Past the map's edges the coast runs on this far, a point every COAST_STEP_METERS, wandering this much either way, meters. */
const COAST_ON_METERS = 30_000;
const COAST_STEP_METERS = 450;
const COAST_WANDER_METERS = 220;
/** A river is drawn this much wider each side than its water, meters, and from every this many of its samples. */
const RIVER_MAP_WIDENING_METERS = 3;
const RIVER_MAP_SAMPLE_STEP = 3;
/** The other regions' roads, drawn from their maps' data alone, keep their points within this of the road, meters. */
const REGION_SIMPLIFY_METERS = 4;
/** A region without a sea is drawn as an island across the water from the others: its corners rounded this much, meters. */
const ISLAND_CORNER_METERS = 900;
/** The island's coast is drawn through a point every this far, wandering in up to ISLAND_WOBBLE_METERS from its square. */
const ISLAND_STEP_METERS = 250;
const ISLAND_WOBBLE_METERS = 110;

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

/** A farm field, as a polygon like a paved area, coloured by its crop. */
export interface MapField extends MapPavedArea {
  readonly crop: FieldCrop;
}

/** A paved circle where a road ends, for turning round. */
export interface MapCircle {
  readonly x: number;
  readonly z: number;
  readonly radiusMeters: number;
}

/** A ferry terminal (MapDefinition.gates): where it is, the region (map id) it crosses to, and the company level it opens at. */
export interface MapFerry {
  readonly x: number;
  readonly z: number;
  readonly toMapId: string;
  readonly requiredLevel: number;
}

/**
 * Another region, as the 2D maps draw it where it lies in the one world
 * (MapDefinition.world), across the water: from its map's data alone, so
 * nothing of it is built. Its roads, rivers, forests, parks, its towns'
 * districts as built-up blocks, its depots, cities and ferry terminals; no
 * houses, fields or lanes the country grows there. In this region's meters.
 */
export interface MapRegionSketch extends MapBox {
  readonly mapId: string;
  /** Its middle, where its name goes. */
  readonly x: number;
  readonly z: number;
  /** Its land, for a region without a sea of its own: an island. */
  readonly land: MapPavedArea | null;
  readonly sea: MapPavedArea | null;
  readonly runs: readonly MapRoadRun[];
  readonly rivers: readonly MapPavedArea[];
  readonly forests: readonly MapPavedArea[];
  readonly parks: readonly MapPavedArea[];
  readonly blocks: readonly MapPavedArea[];
  readonly depots: readonly MapDepot[];
  readonly cities: readonly MapCityLabel[];
  readonly villages: readonly MapVillageLabel[];
  readonly ferries: readonly MapFerry[];
}

/** Where a village's name goes: the middle of its street. */
export interface MapVillageLabel {
  readonly villageId: string;
  readonly x: number;
  readonly z: number;
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
  /** Depot yards, rest area lots and quays. */
  readonly pavedAreas: readonly MapPavedArea[];
  /** The sea west of the shore, reaching far past the drawn area; null when the world has none. */
  readonly sea: MapPavedArea | null;
  /** Each river's water as a polygon, from its source to its mouth. */
  readonly rivers: readonly MapPavedArea[];
  /** Each forest's outline. */
  readonly forests: readonly MapPavedArea[];
  /** Each park's rectangle. */
  readonly parks: readonly MapPavedArea[];
  readonly fields: readonly MapField[];
  /** Where the wind turbines stand. */
  readonly windTurbines: readonly { readonly x: number; readonly z: number }[];
  readonly turningCircles: readonly MapCircle[];
  readonly buildings: readonly MapBox[];
  readonly depots: readonly MapDepot[];
  readonly restAreas: readonly MapRestArea[];
  readonly ferries: readonly MapFerry[];
  /** This region's land when it has no sea and other regions lie across the water: an island. */
  readonly land: MapPavedArea | null;
  /** The other regions, where they lie in the one world. */
  readonly regions: readonly MapRegionSketch[];
  /**
   * The ferry crossings: from each terminal here along its way out, over the
   * water to the other side's way in and its terminal (x and z interleaved).
   */
  readonly crossings: readonly Float64Array[];
  /** This region and the others: as far as the map may be moved. */
  readonly worldBounds: MapBox;
  readonly cities: readonly MapCityLabel[];
  readonly villages: readonly MapVillageLabel[];
}

/**
 * `world` as the 2D maps draw it; with the game's `maps`, the other regions
 * too, where they lie round it (sketchRegion), and the ferry crossings.
 */
export function sketchWorld(world: DrivingWorld, maps: readonly MapDefinition[] = []): MapSketch {
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
  const ferries = world.gates.map(
    (gate): MapFerry => ({ x: gate.area.x, z: gate.area.z, toMapId: gate.toMapId, requiredLevel: gate.requiredCompanyLevel ?? 1 }),
  );
  // The other regions, each where it lies in the one world relative to this one.
  const here = maps.find((map) => map.id === world.id);
  const regions =
    here === undefined
      ? []
      : maps
          .filter((map) => map.id !== world.id)
          .map((map) => sketchRegion(map, (map.world?.x ?? 0) - (here.world?.x ?? 0), (map.world?.z ?? 0) - (here.world?.z ?? 0)));
  const crossings = world.gates.flatMap((gate) => {
    const region = regions.find((candidate) => candidate.mapId === gate.toMapId);
    const other = maps.find((map) => map.id === gate.toMapId)?.gates?.find((candidate) => candidate.id === gate.toGateId);
    if (region === undefined || gate.route === undefined || other?.route === undefined) {
      return [];
    }
    const way = [...gate.route, ...[...other.route].reverse().map(([x, z]): Point2 => [x + region.x, z + region.z])];
    return [new Float64Array(way.flat())];
  });
  const buildings = world.buildings.map(({ minX, maxX, minZ, maxZ }) => ({ minX, maxX, minZ, maxZ }));
  const pavedAreas = [
    ...[...world.depots.map((depot) => depot.yard), ...world.restAreas.map((restArea) => restArea.lot)].map(
      rectangleCorners,
    ),
    ...(world.sea === null ? [] : quayAreas(world.sea)),
  ];
  const turningCircles = world.turningCircles.map(({ x, z, radiusMeters }) => ({ x, z, radiusMeters }));
  const fields = world.fields.map((field): MapField => ({ ...rectangleCorners(field.area), crop: field.crop }));
  const windTurbines = world.windTurbines.map(({ x, z }) => ({ x, z }));

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
  for (const place of [...depots, ...restAreas, ...ferries]) {
    include({ minX: place.x, maxX: place.x, minZ: place.z, maxZ: place.z });
  }
  if (minX > maxX) {
    // Nothing to draw: the world's square.
    minX = minZ = -world.halfSizeMeters;
    maxX = maxZ = world.halfSizeMeters;
  }
  const bounds = { minX: minX - MARGIN_METERS, maxX: maxX + MARGIN_METERS, minZ: minZ - MARGIN_METERS, maxZ: maxZ + MARGIN_METERS };
  const worldBounds = { ...bounds };
  for (const region of regions) {
    worldBounds.minX = Math.min(worldBounds.minX, region.minX - MARGIN_METERS);
    worldBounds.maxX = Math.max(worldBounds.maxX, region.maxX + MARGIN_METERS);
    worldBounds.minZ = Math.min(worldBounds.minZ, region.minZ - MARGIN_METERS);
    worldBounds.maxZ = Math.max(worldBounds.maxZ, region.maxZ + MARGIN_METERS);
  }
  return {
    bounds,
    worldBounds,
    land: world.sea === null && regions.length > 0 ? islandArea(world.halfSizeMeters, 0, 0) : null,
    regions,
    crossings,
    runs,
    pavedAreas,
    sea: world.sea === null ? null : seaArea(world.sea, world.halfSizeMeters),
    rivers: world.rivers.map(riverArea),
    forests: world.forests.map((forest) => polygon(forest.outline)),
    parks: world.parks.map((park) => rectangleCorners(park.area)),
    fields,
    windTurbines,
    turningCircles,
    buildings,
    depots,
    restAreas,
    ferries,
    // The towns' own buildings place their names: not the farms and villages round them.
    cities: cityLabels(
      depots,
      world.buildings.filter((building) => building.country !== true),
    ),
    villages: world.villages.map(({ id, x, z }) => ({ villageId: id, x, z })),
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

/**
 * A river's water as a polygon, a little wider than it is so it shows on the
 * minimap: down one bank from the source to the mouth, and back up the other.
 */
function riverArea(river: RiverPath): MapPavedArea {
  const half = river.halfWidthMeters + RIVER_MAP_WIDENING_METERS;
  const last = Math.min(river.mouthIndex, river.pointCount - 1);
  const samples: number[] = [];
  for (let i = 0; i < last; i += RIVER_MAP_SAMPLE_STEP) {
    samples.push(i);
  }
  samples.push(last);
  const bank = (side: 1 | -1) =>
    samples.map((i): readonly [number, number] => [
      river.x(i) + river.directionZ(i) * half * side,
      river.z(i) - river.directionX(i) * half * side,
    ]);
  return polygon([...bank(1), ...bank(-1).reverse()]);
}

/** The sea as a polygon: along the shore from north to south, then round by the far west. */
function seaArea(sea: Sea, halfSize: number): MapPavedArea {
  return seaPolygon(sea.shoreline, halfSize, 0, 0);
}

/**
 * The sea west of `shoreline` (north to south) as a polygon, moved by
 * (dx, dz). Past the map's north and south edges the coast runs on,
 * wandering a little, before it straightens far out of sight: zoomed out
 * to the other regions, no ruler-straight shore shows.
 */
function seaPolygon(shoreline: readonly Point2[], halfSize: number, dx: number, dz: number): MapPavedArea {
  const first = shoreline[0]!;
  const last = shoreline[shoreline.length - 1]!;
  const west = -halfSize - SEA_REACH_METERS;
  const north = first[1] - SEA_REACH_METERS;
  const south = last[1] + SEA_REACH_METERS;
  // The coast on past the map, a point every COAST_STEP_METERS for COAST_ON_METERS each way.
  const onward = (from: Point2, way: 1 | -1): Point2[] =>
    Array.from({ length: Math.round(COAST_ON_METERS / COAST_STEP_METERS) }, (_, index): Point2 => {
      const step = index + 1;
      const wander = COAST_WANDER_METERS * (Math.sin(step * 0.7 + from[1] * 0.001) + 0.5 * Math.sin(step * 0.23));
      return [from[0] + wander, from[1] + way * step * COAST_STEP_METERS];
    });
  const northward = onward(first, -1).reverse();
  const southward = onward(last, 1);
  return polygon(
    [
      [northward[0]![0], north] as Point2,
      ...northward,
      ...shoreline,
      ...southward,
      [southward[southward.length - 1]![0], south] as Point2,
      [west, south] as Point2,
      [west, north] as Point2,
    ].map(([x, z]): Point2 => [x + dx, z + dz]),
  );
}

/**
 * A region's map (MapDefinition) as the 2D maps draw it from across the
 * water (MapRegionSketch), its middle at (dx, dz) in this region's meters.
 * Only its data is read: roads and rivers sampled as the world would, the
 * rest from its definitions. Built once, when the maps are.
 */
export function sketchRegion(map: MapDefinition, dx: number, dz: number): MapRegionSketch {
  const moved = (points: readonly Point2[]): Point2[] => points.map(([x, z]): Point2 => [x + dx, z + dz]);
  const runs = map.roads.flatMap((definition) => {
    const points = new RoadPath(definition).points.slice();
    for (let i = 0; i < points.length; i += 2) {
      points[i] = points[i]! + dx;
      points[i + 1] = points[i + 1]! + dz;
    }
    return splitRuns(definition.kind, definition.widthMeters, simplifyPolyline(points, REGION_SIMPLIFY_METERS), MAX_RUN_POINTS);
  });
  const blocks = (map.districts ?? []).map((district) => movedArea(rectangleCorners(district.area), dx, dz));
  const depots = map.depots.map((depot): MapDepot => ({ id: depot.id, cityId: depot.cityId, x: depot.yard.x + dx, z: depot.yard.z + dz }));
  const half = map.halfSizeMeters;
  return {
    mapId: map.id,
    x: dx,
    z: dz,
    minX: dx - half,
    maxX: dx + half,
    minZ: dz - half,
    maxZ: dz + half,
    land: map.sea === undefined ? islandArea(half, dx, dz) : null,
    sea: map.sea === undefined ? null : seaPolygon(map.sea.shoreline, half, dx, dz),
    runs,
    rivers: (map.rivers ?? []).map((river) => movedArea(riverArea(new RiverPath(river, map.sea?.shoreline ?? null)), dx, dz)),
    forests: (map.forests ?? []).map((forest) => polygon(moved(forest.outline))),
    parks: (map.parks ?? []).map((park) => movedArea(rectangleCorners(park.area), dx, dz)),
    blocks,
    depots,
    cities: cityLabels(depots, blocks),
    villages: (map.villages ?? []).map((village) => ({ villageId: village.id, x: village.x + dx, z: village.z + dz })),
    ferries: (map.gates ?? []).map(
      (gate): MapFerry => ({ x: gate.area.x + dx, z: gate.area.z + dz, toMapId: gate.toMapId, requiredLevel: gate.requiredCompanyLevel ?? 1 }),
    ),
  };
}

/** `area` moved by (dx, dz). */
function movedArea(area: MapPavedArea, dx: number, dz: number): MapPavedArea {
  const corners = area.corners.slice();
  for (let i = 0; i < corners.length; i += 2) {
    corners[i] = corners[i]! + dx;
    corners[i + 1] = corners[i + 1]! + dz;
  }
  return { corners, minX: area.minX + dx, maxX: area.maxX + dx, minZ: area.minZ + dz, maxZ: area.maxZ + dz };
}

/**
 * A region without a sea seen from across the water: its square as an
 * island, the corners rounded and the coast wandering in a little, so it
 * does not read as a tile. Its middle at (dx, dz).
 */
function islandArea(half: number, dx: number, dz: number): MapPavedArea {
  const r = Math.min(ISLAND_CORNER_METERS, half / 2);
  const inner = half - r;
  // Round the rounded square, a point every ISLAND_STEP_METERS or so: the corners' arcs and the sides between.
  const outline: Point2[] = [];
  const corners: readonly (readonly [number, number, number])[] = [
    [inner, inner, 0],
    [-inner, inner, Math.PI / 2],
    [-inner, -inner, Math.PI],
    [inner, -inner, (3 * Math.PI) / 2],
  ];
  corners.forEach(([cx, cz, from], index) => {
    for (let a = 0; a <= 6; a++) {
      const angle = from + (a / 6) * (Math.PI / 2);
      outline.push([cx + Math.cos(angle) * r, cz + Math.sin(angle) * r]);
    }
    const [nx, nz] = corners[(index + 1) % corners.length]!;
    const endAngle = from + Math.PI / 2;
    const sx = cx + Math.cos(endAngle) * r;
    const sz = cz + Math.sin(endAngle) * r;
    const ex = nx + Math.cos(endAngle) * r;
    const ez = nz + Math.sin(endAngle) * r;
    const steps = Math.max(1, Math.round(Math.hypot(ex - sx, ez - sz) / ISLAND_STEP_METERS));
    for (let step = 1; step < steps; step++) {
      outline.push([sx + ((ex - sx) * step) / steps, sz + ((ez - sz) * step) / steps]);
    }
  });
  // The coast wanders in toward the middle by up to ISLAND_WOBBLE_METERS, the same each time.
  return polygon(
    outline.map(([x, z], i): Point2 => {
      const wobble = Math.max(0, ISLAND_WOBBLE_METERS * (0.45 + 0.35 * Math.sin(i * 0.9) + 0.2 * Math.sin(i * 0.37 + 1)));
      const length = Math.hypot(x, z) || 1;
      return [x - (x / length) * wobble + dx, z - (z / length) * wobble + dz];
    }),
  );
}

/** Each quay as a polygon: along the water's edge, then back along its landward side. */
function quayAreas(sea: Sea): MapPavedArea[] {
  return sea.quays.map((quay) => {
    const zs = [quay.fromZ, ...sea.shoreline.map(([, z]) => z).filter((z) => z > quay.fromZ && z < quay.toZ), quay.toZ];
    const edge = zs.map((z): readonly [number, number] => [shorelineXAt(sea.shoreline, z), z]);
    return polygon([...edge, ...edge.map(([x, z]): readonly [number, number] => [x + quay.widthMeters, z]).reverse()]);
  });
}

/** A polygon from its corners, with its bounds. */
function polygon(points: readonly (readonly [number, number])[]): MapPavedArea {
  const corners = new Float64Array(points.flat());
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  return { corners, minX, maxX, minZ, maxZ };
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
