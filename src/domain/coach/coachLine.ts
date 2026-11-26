import type { PlaceDefinition } from '../../data/definitions/MapDefinition';
import { createRoutePoint, laneOfRoute, raceRouteFrom } from '../race/streetRace';
import type { DrivingWorld } from '../world/DrivingWorld';
import { createRouteTrace } from '../world/RoadNetwork';

/** A stop of a coach line (planCoachLine). */
export interface CoachStop {
  /** Where the coach stops: on the right-hand lane beside the stop, facing along the way it came. */
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  /** Where the people wait: the town's bus shelter, or the station's lot. */
  readonly shelterX: number;
  readonly shelterZ: number;
  /** The town the stop is in (a CityDefinition id); null for the station. */
  readonly cityId: string | null;
  /** A place the stop serves (a stadium, PlaceDefinition id), named for it; null for a station or a town's shelter. */
  readonly placeId: string | null;
  /** The way here from the stop before, by road, meters (0 for the station). */
  readonly legMeters: number;
  /** When the timetable has the coach here, seconds after the start (0 for the station). */
  readonly dueSeconds: number;
}

/**
 * The lines a coach station runs: through the towns, the nearest first, to the
 * last (`intercity`, planCoachLine); round its own town's bus shelters and
 * back to the station (`city`, planCityLine); or, before a match, the fans
 * to the stadium (`charter`, planCharterLine).
 */
export const COACH_LINE_KINDS = ['intercity', 'city', 'charter'] as const;
export type CoachLineKind = (typeof COACH_LINE_KINDS)[number];

/** A coach line: from its station through the towns, nearest first; or round its town and back. */
export interface CoachLine {
  readonly kind: CoachLineKind;
  readonly stationId: string;
  /** The station's stop first, where the run starts. */
  readonly stops: readonly CoachStop[];
  /** By road from the station to the last stop (a city line's: back at the station), meters. */
  readonly lengthMeters: number;
}

export interface CoachLineOptions {
  /** Stops wanted: the station's and one in each of this many less one towns. */
  readonly stops: number;
  /** A town's bus shelter serves the line within this of the town's depot, meters. */
  readonly townReachMeters: number;
  /** No town is added that would make the line longer than this by road, meters. */
  readonly longestMeters: number;
  /** The timetable's pace on each road, m/s (an index into the world's roads). */
  readonly paces: ArrayLike<number>;
  /** The time the timetable allows at each stop, seconds. */
  readonly dwellSeconds: number;
}

/** A town stop's lane point counts only this close to its shelter, meters (a shelter far from any road is passed over). */
const STOP_SHELTER_METERS = 30;
/** A leg shorter than this is no leg (two towns sharing a stop), meters. */
const LEAST_LEG_METERS = 150;

/**
 * Plans the coach line from `station` (a coach station, MapDefinition.places
 * kind `busStation`): a stop in each town nearest it in turn (as many as
 * `stops` and `longestMeters` allow), at the bus
 * shelter nearest the town's depot, each reached by road from the one before
 * (RoadNetwork.trace), with the timetable's time for it. The run starts on
 * the road beside the station. Null when no town can be reached. The same
 * world and station give the same line.
 */
export function planCoachLine(world: DrivingWorld, station: PlaceDefinition, options: CoachLineOptions): CoachLine | null {
  const shelters = world.streetFurniture.filter((item) => item.kind === 'busStop');
  const towns: { cityId: string; x: number; z: number }[] = [];
  for (const depot of world.depots) {
    if (towns.some((town) => town.cityId === depot.cityId)) {
      continue;
    }
    let best: { x: number; z: number } | null = null;
    let bestDistance = options.townReachMeters;
    for (const shelter of shelters) {
      const distance = Math.hypot(shelter.x - depot.yard.x, shelter.z - depot.yard.z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = shelter;
      }
    }
    if (best !== null) {
      towns.push({ cityId: depot.cityId, x: best.x, z: best.z });
    }
  }

  const trace = createRouteTrace(world.network);
  const point = createRoutePoint();
  const stops: CoachStop[] = [];
  let fromX = station.lot.x;
  let fromZ = station.lot.z;
  let due = 0;
  let length = 0;
  while (stops.length < options.stops && towns.length > 0) {
    // The nearest town left, as the crow flies.
    let nearest = 0;
    for (let i = 1; i < towns.length; i++) {
      if (Math.hypot(towns[i]!.x - fromX, towns[i]!.z - fromZ) < Math.hypot(towns[nearest]!.x - fromX, towns[nearest]!.z - fromZ)) {
        nearest = i;
      }
    }
    const town = towns.splice(nearest, 1)[0]!;
    world.network.trace(fromX, fromZ, town.x, town.z, options.paces, trace);
    if (!trace.connected || trace.count < 2) {
      continue;
    }
    const route = raceRouteFrom(trace);
    if (stops.length === 0) {
      // The station's stop: the road beside its lot, facing the way to the first town.
      point.index = 0;
      laneOfRoute(route, world.roads, 0, 0, point);
      stops.push({
        x: point.x,
        z: point.z,
        heading: point.heading,
        shelterX: station.lot.x,
        shelterZ: station.lot.z,
        cityId: null,
        placeId: null,
        legMeters: 0,
        dueSeconds: 0,
      });
      due = options.dwellSeconds;
    }
    point.index = route.count;
    laneOfRoute(route, world.roads, route.length, 0, point);
    if (route.length < LEAST_LEG_METERS || Math.hypot(point.x - town.x, point.z - town.z) > STOP_SHELTER_METERS) {
      continue;
    }
    if (length + route.length > options.longestMeters) {
      break;
    }
    due += trace.seconds;
    length += route.length;
    stops.push({
      x: point.x,
      z: point.z,
      heading: point.heading,
      shelterX: town.x,
      shelterZ: town.z,
      cityId: town.cityId,
      placeId: null,
      legMeters: route.length,
      dueSeconds: due,
    });
    due += options.dwellSeconds;
    fromX = point.x;
    fromZ = point.z;
  }
  return stops.length < 2 ? null : { kind: 'intercity', stationId: station.id, stops, lengthMeters: length };
}

export interface CityLineOptions {
  /** Stops wanted: the station's, then the town's shelters, then the station's again (where everyone gets off). */
  readonly stops: number;
  /** The shelters within this of the station, as the crow flies, meters. */
  readonly reachMeters: number;
  /** No shelter is added that would make the line, back to the station, longer than about this by road, meters. */
  readonly longestMeters: number;
  /** The timetable's pace on each road, m/s (an index into the world's roads). */
  readonly paces: ArrayLike<number>;
  /** The time the timetable allows at each stop, seconds. */
  readonly dwellSeconds: number;
}

/** A city line's stops stand this far apart or more, as the crow flies, meters (and as far from the station). */
const CITY_STOP_APART_METERS = 160;
/** The way back to the station by road, reckoned before it is traced: this many times as the crow flies. */
const WAY_BACK_FACTOR = 1.4;

/**
 * Plans the city line from `station` (a coach station): round the town's
 * bus shelters within `reachMeters` of it, the nearest to where the coach
 * is each time (none too near one already called at), each reached by road
 * from the one before, then back to the station, where everyone gets off.
 * Each town stop is the town of the depot nearest it. Null when fewer than
 * two shelters can be reached. The same world and station give the same line.
 */
export function planCityLine(world: DrivingWorld, station: PlaceDefinition, options: CityLineOptions): CoachLine | null {
  const apart = CITY_STOP_APART_METERS * CITY_STOP_APART_METERS;
  const reach = options.reachMeters * options.reachMeters;
  const shelters = world.streetFurniture.filter((item) => {
    if (item.kind !== 'busStop') {
      return false;
    }
    const d = (item.x - station.lot.x) ** 2 + (item.z - station.lot.z) ** 2;
    return d <= reach && d >= apart;
  });

  const trace = createRouteTrace(world.network);
  const point = createRoutePoint();
  const stops: CoachStop[] = [];
  let fromX = station.lot.x;
  let fromZ = station.lot.z;
  let due = 0;
  let length = 0;
  while (stops.length < options.stops - 1 && shelters.length > 0) {
    let nearest = 0;
    for (let i = 1; i < shelters.length; i++) {
      if ((shelters[i]!.x - fromX) ** 2 + (shelters[i]!.z - fromZ) ** 2 < (shelters[nearest]!.x - fromX) ** 2 + (shelters[nearest]!.z - fromZ) ** 2) {
        nearest = i;
      }
    }
    const shelter = shelters.splice(nearest, 1)[0]!;
    if (stops.some((stop) => (stop.shelterX - shelter.x) ** 2 + (stop.shelterZ - shelter.z) ** 2 < apart)) {
      continue;
    }
    world.network.trace(fromX, fromZ, shelter.x, shelter.z, options.paces, trace);
    if (!trace.connected || trace.count < 2) {
      continue;
    }
    const route = raceRouteFrom(trace);
    if (stops.length === 0) {
      point.index = 0;
      laneOfRoute(route, world.roads, 0, 0, point);
      stops.push({ x: point.x, z: point.z, heading: point.heading, shelterX: station.lot.x, shelterZ: station.lot.z, cityId: null, placeId: null, legMeters: 0, dueSeconds: 0 });
      due = options.dwellSeconds;
    }
    point.index = route.count;
    laneOfRoute(route, world.roads, route.length, 0, point);
    if (route.length < LEAST_LEG_METERS || Math.hypot(point.x - shelter.x, point.z - shelter.z) > STOP_SHELTER_METERS) {
      continue;
    }
    const wayBack = Math.hypot(point.x - station.lot.x, point.z - station.lot.z) * WAY_BACK_FACTOR;
    if (length + route.length + wayBack > options.longestMeters) {
      break;
    }
    due += trace.seconds;
    length += route.length;
    stops.push({
      x: point.x,
      z: point.z,
      heading: point.heading,
      shelterX: shelter.x,
      shelterZ: shelter.z,
      cityId: nearestTown(world, shelter.x, shelter.z),
      placeId: null,
      legMeters: route.length,
      dueSeconds: due,
    });
    due += options.dwellSeconds;
    fromX = point.x;
    fromZ = point.z;
  }
  if (stops.length < 3) {
    return null;
  }
  // Back to the station: its stop on the road beside the lot, where the run ends.
  world.network.trace(fromX, fromZ, station.lot.x, station.lot.z, options.paces, trace);
  if (!trace.connected || trace.count < 2) {
    return null;
  }
  const back = raceRouteFrom(trace);
  point.index = back.count;
  laneOfRoute(back, world.roads, back.length, 0, point);
  due += trace.seconds;
  length += back.length;
  stops.push({
    x: point.x,
    z: point.z,
    heading: point.heading,
    shelterX: station.lot.x,
    shelterZ: station.lot.z,
    cityId: null,
    placeId: null,
    legMeters: back.length,
    dueSeconds: due,
  });
  return { kind: 'city', stationId: station.id, stops, lengthMeters: length };
}

/** The town (CityDefinition id) of the depot nearest (x, z). */
function nearestTown(world: DrivingWorld, x: number, z: number): string | null {
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const depot of world.depots) {
    const distance = (depot.yard.x - x) ** 2 + (depot.yard.z - z) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = depot.cityId;
    }
  }
  return best;
}

export interface CharterLineOptions {
  /** The timetable's pace on each road, m/s (an index into the world's roads). */
  readonly paces: ArrayLike<number>;
  /** The time the timetable allows at the station, seconds. */
  readonly dwellSeconds: number;
}

/**
 * Plans the match-day charter from `station` (a coach station) to
 * `stadium` (a place of kind `stadium`): the fans board at the station and
 * all get off on the road beside the stadium's lot, by road. Null when the
 * stadium cannot be reached.
 */
export function planCharterLine(world: DrivingWorld, station: PlaceDefinition, stadium: PlaceDefinition, options: CharterLineOptions): CoachLine | null {
  const trace = createRouteTrace(world.network);
  world.network.trace(station.lot.x, station.lot.z, stadium.lot.x, stadium.lot.z, options.paces, trace);
  if (!trace.connected || trace.count < 2) {
    return null;
  }
  const route = raceRouteFrom(trace);
  if (route.length < LEAST_LEG_METERS) {
    return null;
  }
  const point = createRoutePoint();
  point.index = 0;
  laneOfRoute(route, world.roads, 0, 0, point);
  const first: CoachStop = {
    x: point.x,
    z: point.z,
    heading: point.heading,
    shelterX: station.lot.x,
    shelterZ: station.lot.z,
    cityId: null,
    placeId: null,
    legMeters: 0,
    dueSeconds: 0,
  };
  point.index = route.count;
  laneOfRoute(route, world.roads, route.length, 0, point);
  const last: CoachStop = {
    x: point.x,
    z: point.z,
    heading: point.heading,
    shelterX: stadium.lot.x,
    shelterZ: stadium.lot.z,
    cityId: nearestTown(world, stadium.lot.x, stadium.lot.z),
    placeId: stadium.id,
    legMeters: route.length,
    dueSeconds: options.dwellSeconds + trace.seconds,
  };
  return { kind: 'charter', stationId: station.id, stops: [first, last], lengthMeters: route.length };
}
