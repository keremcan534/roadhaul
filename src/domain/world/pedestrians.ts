import { SeededRandom } from '../../core/random/SeededRandom';
import type { RoadPath, RoadPoint } from './RoadPath';
import { SIDEWALK_WIDTH_METERS, type Sidewalk, type StreetFurniture } from './townscape';

/**
 * People on the towns' pavements, placed once from a seed so a town always
 * has the same ones: walkers, WALKERS_PER_100_METERS of pavement, each up
 * and down its stretch at their own pace, keeping to their right; and a few
 * waiting at every bus stop. Where each is comes from the time alone
 * (walkerAt), so nothing is stepped or stored. Presentation draws them
 * (PedestrianView); nothing collides with them.
 */
export const WALKERS_PER_100_METERS = 3.5;
/** Walking paces, m/s, and a walker's stride (two steps), meters. */
const WALK_SPEED = [0.95, 1.55] as const;
const STRIDE_METERS = 1.45;
/** Walkers keep this far to their right of the pavement's middle, meters, give or take WANDER_METERS. */
const KEEP_RIGHT_METERS = 0.45;
const WANDER_METERS = 0.25;
/** At a bus stop, up to this many wait, this far along the pavement either side of the shelter's middle. */
const MOST_WAITING = 3;
const WAITING_SPREAD_METERS = 1.8;

/** Someone walking up and down a pavement. */
export interface Walker {
  /** Which pavement (DrivingWorld.sidewalks). */
  readonly sidewalk: number;
  /** How far round its walk (there and back, twice the pavement's length) it is at time 0, meters. */
  readonly startMeters: number;
  /** m/s */
  readonly speed: number;
  /** Meters to its right of the pavement's middle, walking. */
  readonly keepRight: number;
  /** 0..1: out even in a thin crowd (low) or only in a full one (high) (crowdShows). */
  readonly presence: number;
  /** 0..1: how it looks (presentation picks its clothes, skin and umbrella from it). */
  readonly look: number;
}

/** Someone waiting at a bus stop, facing the road. */
export interface Waiting {
  readonly x: number;
  readonly z: number;
  /** The way it faces (radians, 0 along +z). */
  readonly heading: number;
  readonly presence: number;
  readonly look: number;
}

export interface Pedestrians {
  readonly walkers: readonly Walker[];
  readonly waiting: readonly Waiting[];
}

/** Where someone is, the way they face, and how far through their walking cycle (radians; 0 standing). Written by walkerAt(). */
export interface PedestrianPose {
  x: number;
  z: number;
  heading: number;
  stride: number;
}

export function createPedestrianPose(): PedestrianPose {
  return { x: 0, z: 0, heading: 0, stride: 0 };
}

/**
 * Places the towns' people from `seed`: walkers along `sidewalks` (on
 * `roads`) and people waiting at the bus stops among `furniture`.
 */
export function placePedestrians(
  roads: readonly RoadPath[],
  sidewalks: readonly Sidewalk[],
  furniture: readonly StreetFurniture[],
  seed: number,
): Pedestrians {
  const random = new SeededRandom(seed);
  const walkers: Walker[] = [];
  sidewalks.forEach((sidewalk, index) => {
    const length = sidewalk.toMeters - sidewalk.fromMeters;
    if (length <= 0 || roads[sidewalk.roadIndex] === undefined) {
      return;
    }
    const count = Math.max(1, Math.round((length / 100) * WALKERS_PER_100_METERS));
    for (let i = 0; i < count; i++) {
      walkers.push({
        sidewalk: index,
        startMeters: random.range(0, 2 * length),
        speed: random.range(WALK_SPEED[0], WALK_SPEED[1]),
        keepRight: KEEP_RIGHT_METERS + random.range(-WANDER_METERS, WANDER_METERS),
        presence: random.next(),
        look: random.next(),
      });
    }
  });
  const waiting: Waiting[] = [];
  for (const stop of furniture) {
    if (stop.kind !== 'busStop') {
      continue;
    }
    // The shelter faces the road: they wait in front of it, looking up the road for the bus now and then.
    const count = random.int(1, MOST_WAITING);
    for (let i = 0; i < count; i++) {
      const along = random.range(-WAITING_SPREAD_METERS, WAITING_SPREAD_METERS);
      const out = random.range(0.8, 1.3);
      waiting.push({
        x: stop.x + Math.sin(stop.heading) * out + Math.cos(stop.heading) * along,
        z: stop.z + Math.cos(stop.heading) * out - Math.sin(stop.heading) * along,
        heading: stop.heading + random.range(-0.9, 0.9),
        presence: random.next(),
        look: random.next(),
      });
    }
  }
  return { walkers, waiting };
}

/**
 * Where `walker` is at `timeSeconds` on its pavement (`sidewalk`, along
 * `road`): up the pavement, then back, keeping to its right; `point` is
 * scratch. Writes into `out`. Allocation-free.
 */
export function walkerAt(
  walker: Readonly<Walker>,
  road: RoadPath,
  sidewalk: Readonly<Sidewalk>,
  timeSeconds: number,
  point: RoadPoint,
  out: PedestrianPose,
): PedestrianPose {
  const length = sidewalk.toMeters - sidewalk.fromMeters;
  const round = 2 * length;
  const walked = walker.startMeters + walker.speed * timeSeconds;
  const along = ((walked % round) + round) % round;
  const outward = along < length;
  const at = sidewalk.fromMeters + (outward ? along : round - along);
  road.pointAt(at, point);
  // The pavement's middle (its side along the road's right normal, (-dz, dx)), then to the walker's right of it.
  const middle = sidewalk.side * (road.widthMeters / 2 + SIDEWALK_WIDTH_METERS / 2);
  const right = outward ? walker.keepRight : -walker.keepRight;
  const offset = middle + right;
  out.x = point.x - point.directionZ * offset;
  out.z = point.z + point.directionX * offset;
  const heading = Math.atan2(point.directionX, point.directionZ);
  out.heading = outward ? heading : heading + Math.PI;
  out.stride = ((walked / STRIDE_METERS) % 1) * Math.PI * 2;
  return out;
}

/**
 * Whether someone of `presence` is out when the crowd is `crowd` strong
 * (0..1: 1 by day, thinner at night and in the rain).
 */
export function crowdShows(presence: number, crowd: number): boolean {
  return presence < crowd;
}
