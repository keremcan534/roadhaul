import {
  shorelineXAt,
  type FieldCrop,
  type HillDefinition,
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
/** A river is drawn this much wider each side than its water, meters, and from every this many of its samples. */
const RIVER_MAP_WIDENING_METERS = 3;
const RIVER_MAP_SAMPLE_STEP = 3;
/** The other regions' roads, drawn from their maps' data alone, keep their points within this of the road, meters. */
const REGION_SIMPLIFY_METERS = 4;
/**
 * Past its square a region's land runs on through the mountains round it
 * (the 3D backdrop's ranges stand there) to a coast about this far out,
 * meters, wandering this much either way in bays and headlands, and never
 * nearer the square than LAND_CLEARANCE_METERS. The sea is all the rest.
 */
const LAND_REACH_METERS = 2600;
const LAND_WANDER_METERS = 1100;
const LAND_CLEARANCE_METERS = 450;
/** Points round a region's coast; the square's corners rounded as a superellipse of this power. */
const COAST_POINTS = 420;
const LAND_ROUNDNESS = 4;
/** The coast's bays and headlands: waves round it, each so many to the turn and this strong (summing to 1). */
const COAST_WAVES: readonly (readonly [number, number])[] = [
  [3, 0.4],
  [5, 0.25],
  [8, 0.15],
  [13, 0.09],
  [21, 0.06],
  [34, 0.03],
  [55, 0.02],
];
/** Where a shore meets the square's edge, the coast runs on to the land's rim, wandering this much, meters. */
const SHORE_LINK_WANDER_METERS = 140;
/** The sea round the lands, as far as the maps move, meters. */
const SEA_MARGIN_METERS = 1500;
/**
 * Water this wide each side or wider is a strait: where it meets the
 * square's edge it runs on through the mountains to the sea. A river's
 * source there runs on into them, this share of the way to the coast.
 */
const STRAIT_HALF_WIDTH_METERS = 100;
const RIVER_INTO_MOUNTAINS = 0.55;
/** A ferry's way runs on out to sea in steps this long, meters, until it is off the land. */
const SEAWARD_STEP_METERS = 250;

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
  /** Its land (landArea): its square and the mountains round it out to a natural coast; the sea is all the rest. */
  readonly land: MapPavedArea;
  /** What its relief is drawn from. */
  readonly relief: MapRelief;
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

/**
 * What a region's relief is drawn from (mapRelief.ts): its square, in this
 * region's meters, its hills there, and a seed for its rolling ground and
 * the mountains round it.
 */
export interface MapRelief {
  readonly x: number;
  readonly z: number;
  readonly halfSizeMeters: number;
  readonly hills: readonly HillDefinition[];
  readonly seed: number;
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
  /**
   * This region's land (landArea): its square, and past it the mountains out
   * to a natural coast; a sea of its own west of its shore. The sea is all
   * the rest.
   */
  readonly land: MapPavedArea;
  /** What its relief is drawn from. */
  readonly relief: MapRelief;
  /** The other regions, where they lie in the one world. */
  readonly regions: readonly MapRegionSketch[];
  /**
   * The ferry crossings: from each terminal here along its way out, over the
   * water to the other side's way in and its terminal (x and z interleaved).
   */
  readonly crossings: readonly Float64Array[];
  /** This region's and the others' lands and the sea round them: as far as the map may be moved. */
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
  const land = landArea(world.halfSizeMeters, 0, 0, seedOf(world.id), world.sea?.shoreline ?? null);
  const lands = [land, ...regions.map((region) => region.land)];
  const crossings = world.gates.flatMap((gate) => {
    const region = regions.find((candidate) => candidate.mapId === gate.toMapId);
    const other = maps.find((map) => map.id === gate.toMapId)?.gates?.find((candidate) => candidate.id === gate.toGateId);
    if (region === undefined || gate.route === undefined || other?.route === undefined) {
      return [];
    }
    const there = other.route.map(([x, z]): Point2 => [x + region.x, z + region.z]);
    // Each way runs on out to sea, past the mountains round its land, and the crossing is over the open water.
    const way = [...gate.route, ...seaward(gate.route, lands), ...seaward(there, lands).reverse(), ...[...there].reverse()];
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
  // The lands and a strip of sea round them: past that the map does not go, so no empty water or ground fills it.
  const worldBounds = { ...bounds };
  for (const area of lands) {
    worldBounds.minX = Math.min(worldBounds.minX, area.minX - SEA_MARGIN_METERS);
    worldBounds.maxX = Math.max(worldBounds.maxX, area.maxX + SEA_MARGIN_METERS);
    worldBounds.minZ = Math.min(worldBounds.minZ, area.minZ - SEA_MARGIN_METERS);
    worldBounds.maxZ = Math.max(worldBounds.maxZ, area.maxZ + SEA_MARGIN_METERS);
  }
  return {
    bounds,
    worldBounds,
    land,
    relief: { x: 0, z: 0, halfSizeMeters: world.halfSizeMeters, hills: here?.terrain?.hills ?? [], seed: seedOf(world.id) },
    regions,
    crossings,
    runs,
    pavedAreas,
    rivers: world.rivers.map((river) => riverArea(river, world.halfSizeMeters)),
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
function riverArea(river: RiverPath, half: number): MapPavedArea {
  const widen = river.halfWidthMeters + RIVER_MAP_WIDENING_METERS;
  const last = Math.min(river.mouthIndex, river.pointCount - 1);
  const samples: number[] = [];
  for (let i = 0; i < last; i += RIVER_MAP_SAMPLE_STEP) {
    samples.push(i);
  }
  samples.push(last);
  // Its course: where it is and which way it flows at each sample.
  const course = samples.map((i): readonly [number, number, number, number] => [river.x(i), river.z(i), river.directionX(i), river.directionZ(i)]);
  // Where it meets the square's edge it runs on: a strait out to the sea, a river's source into the mountains.
  const reach = river.halfWidthMeters >= STRAIT_HALF_WIDTH_METERS ? LAND_REACH_METERS + LAND_WANDER_METERS + 600 : LAND_REACH_METERS * RIVER_INTO_MOUNTAINS;
  const atEdge = ([x, z]: readonly [number, number, number, number]): boolean => Math.max(Math.abs(x), Math.abs(z)) > half - 80;
  const onward = ([x, z, dx, dz]: readonly [number, number, number, number], way: 1 | -1): (readonly [number, number, number, number])[] =>
    [0.5, 1].map((share) => [x + dx * way * reach * share, z + dz * way * reach * share, dx, dz] as const);
  const first = course[0]!;
  const end = course[course.length - 1]!;
  const ways = [
    ...(atEdge(first) ? onward(first, -1).reverse() : []),
    ...course,
    ...(atEdge(end) && river.halfWidthMeters >= STRAIT_HALF_WIDTH_METERS ? onward(end, 1) : []),
  ];
  const bank = (side: 1 | -1) => ways.map(([x, z, dx, dz]): readonly [number, number] => [x + dz * widen * side, z - dx * widen * side]);
  return polygon([...bank(1), ...bank(-1).reverse()]);
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
    land: landArea(half, dx, dz, seedOf(map.id), map.sea?.shoreline ?? null),
    relief: {
      x: dx,
      z: dz,
      halfSizeMeters: half,
      hills: (map.terrain?.hills ?? []).map((hill) => ({ ...hill, x: hill.x + dx, z: hill.z + dz })),
      seed: seedOf(map.id),
    },
    runs,
    rivers: (map.rivers ?? []).map((river) => movedArea(riverArea(new RiverPath(river, map.sea?.shoreline ?? null), half), dx, dz)),
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
 * A region's land as the maps draw it, its middle at (dx, dz): its square,
 * and past it the mountains round it out to a coast LAND_REACH_METERS off
 * on average, in bays and headlands (COAST_WAVES, from `seed`), the square's
 * corners rounded away. With a `shoreline` (north to south: the sea west of
 * it), the land's west is that shore, which runs on from the square's edges
 * to the rim. The same every time.
 */
export function landArea(half: number, dx: number, dz: number, seed: number, shoreline: readonly Point2[] | null): MapPavedArea {
  const reach = half + LAND_REACH_METERS;
  // A point of the rim at `turn` radians from north (−z), clockwise (east is a quarter turn).
  const rim = (turn: number): Point2 => {
    const sin = Math.sin(turn);
    const cos = Math.cos(turn);
    const rounded = reach / (Math.abs(sin) ** LAND_ROUNDNESS + Math.abs(cos) ** LAND_ROUNDNESS) ** (1 / LAND_ROUNDNESS);
    const square = half / Math.max(Math.abs(sin), Math.abs(cos));
    const radius = Math.max(square + LAND_CLEARANCE_METERS, rounded + LAND_WANDER_METERS * coastWaves(turn, seed));
    return [sin * radius, -cos * radius];
  };
  const step = (Math.PI * 2) / COAST_POINTS;
  const outline: Point2[] = [];
  if (shoreline === null || shoreline.length < 2) {
    for (let i = 0; i < COAST_POINTS; i++) {
      outline.push(rim(i * step));
    }
  } else {
    const north = shoreline[0]!;
    const south = shoreline[shoreline.length - 1]!;
    // Where the shore's ends meet the rim: due north and due south of them.
    const fromTurn = Math.atan2(north[0], reach);
    const toTurn = Math.PI - Math.atan2(south[0], reach);
    outline.push(north, ...shoreLink(north, rim(fromTurn), seed));
    for (let turn = fromTurn; turn < toTurn; turn += step) {
      outline.push(rim(turn));
    }
    outline.push(rim(toTurn), ...shoreLink(rim(toTurn), south, seed + 1), ...[...shoreline].reverse().slice(0, -1));
  }
  return polygon(outline.map(([x, z]): Point2 => [x + dx, z + dz]));
}

/** The coast's swing out (+) or in (−) at `turn` (radians round the land), in about −1..1: its bays and headlands. */
function coastWaves(turn: number, seed: number): number {
  let sum = 0;
  for (const [count, strength] of COAST_WAVES) {
    sum += strength * Math.sin(count * turn + phaseOf(seed, count));
  }
  return sum;
}

/** The points from `from` to `to` (both left out), a coast wandering a little either side of the line between. */
function shoreLink(from: Point2, to: Point2, seed: number): Point2[] {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const steps = Math.max(2, Math.round(length / 300));
  const acrossX = -(to[1] - from[1]) / (length || 1);
  const acrossZ = (to[0] - from[0]) / (length || 1);
  const points: Point2[] = [];
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const wander = SHORE_LINK_WANDER_METERS * Math.sin(Math.PI * t) * Math.sin(i * 1.7 + phaseOf(seed, 7));
    points.push([from[0] + (to[0] - from[0]) * t + acrossX * wander, from[1] + (to[1] - from[1]) * t + acrossZ * wander]);
  }
  return points;
}

/** A phase (radians) from a seed and a wave's count: the same each time. */
function phaseOf(seed: number, count: number): number {
  const value = Math.sin(seed * 12.9898 + count * 78.233) * 43758.5453;
  return (value - Math.floor(value)) * Math.PI * 2;
}

/** A map's id as a number, for its coast's seed. */
function seedOf(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) % 9973;
  }
  return hash;
}

/** Whether (x, z) lies inside `area`'s polygon. */
export function insideArea(area: MapPavedArea, x: number, z: number): boolean {
  if (x < area.minX || x > area.maxX || z < area.minZ || z > area.maxZ) {
    return false;
  }
  const corners = area.corners;
  let inside = false;
  for (let i = 0, j = corners.length - 2; i < corners.length; j = i, i += 2) {
    const xi = corners[i]!;
    const zi = corners[i + 1]!;
    const xj = corners[j]!;
    const zj = corners[j + 1]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * A ferry's way out (`route`, from its terminal) run on, the way its last
 * leg points, until it is off every land in `lands`: the points added.
 */
function seaward(route: readonly Point2[], lands: readonly MapPavedArea[]): Point2[] {
  const onLand = (x: number, z: number): boolean => lands.some((land) => insideArea(land, x, z));
  if (route.length < 2 || !onLand(...route[route.length - 1]!)) {
    return [];
  }
  const [x, z] = route[route.length - 1]!;
  const [px, pz] = route[route.length - 2]!;
  const length = Math.hypot(x - px, z - pz) || 1;
  const points: Point2[] = [];
  for (let i = 1; i <= 60; i++) {
    const at: Point2 = [x + ((x - px) / length) * SEAWARD_STEP_METERS * i, z + ((z - pz) / length) * SEAWARD_STEP_METERS * i];
    points.push(at);
    if (!onLand(at[0], at[1])) {
      break;
    }
  }
  return points;
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
