import type { SeededRandom } from '../../core/random/SeededRandom';
import type { TrafficVehicleDefinition } from '../../data/definitions/TrafficVehicleDefinition';
import type { DebrisLaunch } from './DebrisSimulation';
import { KNOCKABLES, knockableCode, type KnockableKind } from './knockables';
import { WRECK_DEBRIS_KIND, wreckShape, type Wreckable } from './wrecks';

/**
 * How what gives way to the truck is sent off, and what it costs the truck.
 * The truck's knock is a collision along the contact's normal (from the
 * thing to the truck): the thing flies off the other way, with some of the
 * truck's speed past it dragged along, toppling away from the truck and
 * tumbling a little at random; the truck loses the momentum it gave. The
 * throw factor exaggerates the throw (more is funnier); the truck's loss
 * stays true to the masses.
 */

/** Bounciness of the truck's knock itself: 0 the thing sticks to the bumper, 1 it springs off. */
const KNOCK_RESTITUTION = 0.3;
/** A thing struck a glancing blow is dragged along at this share of the truck's speed past it. */
const GLANCE_DRAG = 0.4;
/** A wreck flies up at this share of the speed it is knocked with… */
const WRECK_POP = 0.22;
/** …topples away at this many rad/s per m/s of it (a car rolls over), and yaws at up to this many. */
const WRECK_TOPPLE = 0.09;
const WRECK_YAW = 0.08;

/** The truck as it knocks something: its mass, and its velocity (m/s, world). */
export interface Striker {
  readonly massKg: number;
  readonly vx: number;
  readonly vz: number;
}

/** Where a thing stood: its foot and the way it faced (radians, 0 toward +z). */
export interface StandingThing {
  readonly x: number;
  readonly z: number;
  readonly heading?: number;
}

/** A traffic vehicle as it was wrecked: its middle, heading and speed along it. */
export interface WreckedVehicle {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly speed: number;
}

/**
 * How much speed (m/s) the truck of `truckMassKg` loses knocking a thing of
 * `thingMassKg` it drove into `into` m/s fast: the momentum the thing takes.
 */
export function truckSpeedLoss(truckMassKg: number, thingMassKg: number, into: number): number {
  return ((1 + KNOCK_RESTITUTION) * thingMassKg * Math.max(0, into)) / (truckMassKg + thingMassKg);
}

/**
 * Sends off a `kind` of thing knocked over where it stood (`thing`, its
 * circle `circle`), struck by `truck` `into` m/s fast along the normal
 * (nx, nz) from it to the truck. Its middle starts where it was.
 */
export function knockThrow(
  kind: KnockableKind,
  circle: number,
  thing: StandingThing,
  truck: Striker,
  into: number,
  nx: number,
  nz: number,
  throwFactor: number,
  random: SeededRandom,
): DebrisLaunch {
  const knockable = KNOCKABLES[kind];
  const heading = thing.heading ?? 0;
  const speed = Math.max(0, into) * knockable.throwShare * throwFactor;
  const [dragX, dragZ] = glance(truck, nx, nz);
  const topple = knockable.topple * into;
  const tumble = knockable.tumble * into;
  return {
    kind: knockableCode(kind),
    ref: circle,
    shape: knockable.shape,
    x: thing.x + Math.sin(heading) * knockable.centreZ,
    y: knockable.shape.halfY,
    z: thing.z + Math.cos(heading) * knockable.centreZ,
    heading,
    vx: -nx * speed + dragX,
    vy: speed * knockable.popShare,
    vz: -nz * speed + dragZ,
    // About up × d (d = -n, the way it flies): its top goes the way it flies.
    spinX: -nz * topple + random.range(-tumble, tumble),
    spinY: random.range(-tumble, tumble),
    spinZ: nx * topple + random.range(-tumble, tumble),
  };
}

/**
 * Sends off a traffic vehicle of `type` (its index `typeIndex`), wrecked
 * where it was going (`vehicle`) by `truck` driving into it `into` m/s
 * fast along the normal (nx, nz) from it to the truck: its own velocity
 * and the knock's. Its paint is the caller's to keep.
 */
export function wreckThrow(
  type: TrafficVehicleDefinition,
  typeIndex: number,
  wreckable: Wreckable,
  vehicle: WreckedVehicle,
  truck: Striker,
  into: number,
  nx: number,
  nz: number,
  throwFactor: number,
  random: SeededRandom,
): DebrisLaunch {
  const shape = wreckShape(type, wreckable);
  const knock =
    (((1 + KNOCK_RESTITUTION) * truck.massKg) / (truck.massKg + wreckable.massKg)) * Math.max(0, into) * throwFactor;
  const [dragX, dragZ] = glance(truck, nx, nz);
  const topple = WRECK_TOPPLE * knock;
  const yaw = WRECK_YAW * knock;
  return {
    kind: WRECK_DEBRIS_KIND,
    ref: typeIndex,
    shape,
    x: vehicle.x,
    y: shape.halfY,
    z: vehicle.z,
    heading: vehicle.heading,
    vx: Math.sin(vehicle.heading) * vehicle.speed - nx * knock + dragX,
    vy: knock * WRECK_POP,
    vz: Math.cos(vehicle.heading) * vehicle.speed - nz * knock + dragZ,
    spinX: -nz * topple,
    spinY: random.range(-yaw, yaw),
    spinZ: nx * topple,
  };
}

/** The truck's velocity past the thing (across the normal), at the share a glancing blow drags it along. */
function glance(truck: Striker, nx: number, nz: number): [number, number] {
  const along = truck.vx * nx + truck.vz * nz;
  return [(truck.vx - along * nx) * GLANCE_DRAG, (truck.vz - along * nz) * GLANCE_DRAG];
}
