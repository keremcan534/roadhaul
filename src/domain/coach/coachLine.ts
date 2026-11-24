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
  /** The way here from the stop before, by road, meters (0 for the station). */
  readonly legMeters: number;
  /** When the timetable has the coach here, seconds after the start (0 for the station). */
  readonly dueSeconds: number;
}

/** A coach line: from its station through the towns, nearest first. */
export interface CoachLine {
  readonly stationId: string;
  /** The station's stop first, where the run starts. */
  readonly stops: readonly CoachStop[];
  /** By road from the station to the last stop, meters. */
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
      legMeters: route.length,
      dueSeconds: due,
    });
    due += options.dwellSeconds;
    fromX = point.x;
    fromZ = point.z;
  }
  return stops.length < 2 ? null : { stationId: station.id, stops, lengthMeters: length };
}
