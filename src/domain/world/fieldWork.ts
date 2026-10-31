import { SeededRandom } from '../../core/random/SeededRandom';
import type { Field } from './DrivingWorld';

/**
 * Tractors at work in the fields: some of the ploughed and green fields
 * (none where bales lie) have one going up and down them along their rows,
 * a pass every PASS_SPACING_METERS across, turning at the headlands. Where
 * it is comes from the time alone (tractorAt), like the walkers', so
 * nothing is stepped or stored. Presentation draws them (FieldWorkView);
 * nothing collides with them.
 */

/** A field being worked: which (World.fields), how far round its work the tractor is at time 0 (meters), and its pace (m/s). */
export interface FieldWork {
  readonly field: number;
  readonly startMeters: number;
  readonly speed: number;
}

/** The share of the ploughed and green fields with a tractor at work. */
const WORKED_SHARE = 0.4;
/** Its passes this far apart across the field, and its turns this far in from the field's ends and sides, meters. */
const PASS_SPACING_METERS = 7;
const HEADLAND_METERS = 6;
/** Its pace, m/s: a tractor at work in a field. */
const SPEED = [2.2, 3.4] as const;

/** Where a tractor is and the way it faces (radians, 0 along +z). Written by tractorAt(). */
export interface TractorPose {
  x: number;
  z: number;
  heading: number;
}

export function createTractorPose(): TractorPose {
  return { x: 0, z: 0, heading: 0 };
}

/** The fields worked, from `seed`: the same ones every time. */
export function workedFields(fields: readonly Field[], seed: number): FieldWork[] {
  const random = new SeededRandom(seed);
  const worked: FieldWork[] = [];
  fields.forEach((field, index) => {
    const roll = random.next();
    const start = random.next();
    const pace = random.next();
    if ((field.crop === 'ploughed' || field.crop === 'green') && roll < WORKED_SHARE && passesOf(field) >= 2) {
      worked.push({ field: index, startMeters: start * workLength(field), speed: SPEED[0] + (SPEED[1] - SPEED[0]) * pace });
    }
  });
  return worked;
}

/** How many passes the tractor makes across `field`. */
function passesOf(field: Field): number {
  return Math.max(0, Math.floor((field.area.widthMeters - 2 * HEADLAND_METERS) / PASS_SPACING_METERS) + 1);
}

/** One pass's length, along the field between its headlands, meters. */
function passLength(field: Field): number {
  return Math.max(0, field.area.lengthMeters - 2 * HEADLAND_METERS);
}

/** All its work round the field, there and back across it: the passes and the turns between them, meters. */
function workLength(field: Field): number {
  const passes = passesOf(field);
  // Across and back again: every pass but the last and first twice, each turn a half circle.
  return 2 * (passes - 1) * (passLength(field) + (Math.PI * PASS_SPACING_METERS) / 2);
}

/**
 * Where the tractor working `field` is after `seconds`: along a pass, or
 * round a half circle at the headland into the next, across the field and
 * back again, pass after pass. Allocation-free.
 */
export function tractorAt(field: Field, work: FieldWork, seconds: number, out: TractorPose): TractorPose {
  const passes = passesOf(field);
  const pass = passLength(field);
  const radius = PASS_SPACING_METERS / 2;
  const turn = Math.PI * radius;
  const leg = pass + turn;
  // Across and back: passes 0, 1, … the last, … 1, then 0 again: twice the passes less one, a leg each.
  const period = 2 * (passes - 1);
  const total = period * leg;
  let along = (work.startMeters + work.speed * seconds) % total;
  if (along < 0) {
    along += total;
  }
  const k = Math.min(period - 1, Math.floor(along / leg));
  const inLeg = along - k * leg;
  const passIndex = k <= passes - 1 ? k : period - k;
  const next = (k + 1) % period;
  const nextIndex = next <= passes - 1 ? next : period - next;
  const across = nextIndex - passIndex;
  const { area } = field;
  const heading = (area.headingDegrees * Math.PI) / 180;
  const alongX = Math.sin(heading);
  const alongZ = Math.cos(heading);
  const acrossX = Math.cos(heading);
  const acrossZ = -Math.sin(heading);
  const firstAcross = -area.widthMeters / 2 + HEADLAND_METERS;
  // Every other leg runs the other way along the field.
  const forward = k % 2 === 0;
  let s: number;
  let t: number;
  // The way it drives in the field's frame: along it (ds) and across it (dt).
  let ds: number;
  let dt: number;
  if (inLeg < pass) {
    s = forward ? -pass / 2 + inLeg : pass / 2 - inLeg;
    t = firstAcross + passIndex * PASS_SPACING_METERS;
    ds = forward ? 1 : -1;
    dt = 0;
  } else {
    // Round the headland, a half circle into the next pass.
    const angle = ((inLeg - pass) / turn) * Math.PI;
    const outward = forward ? 1 : -1;
    s = (forward ? pass / 2 : -pass / 2) + outward * Math.sin(angle) * radius;
    t = firstAcross + passIndex * PASS_SPACING_METERS + across * (radius - Math.cos(angle) * radius);
    ds = outward * Math.cos(angle);
    dt = across * Math.sin(angle);
  }
  out.x = area.x + alongX * s + acrossX * t;
  out.z = area.z + alongZ * s + acrossZ * t;
  out.heading = Math.atan2(alongX * ds + acrossX * dt, alongZ * ds + acrossZ * dt);
  return out;
}
