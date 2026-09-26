import { clamp01 } from '../../core/math/scalar';

/** A six-cylinder four-stroke diesel fires three times per turn of the crankshaft. */
const FIRINGS_PER_REVOLUTION = 3;
/** Road and wind noise are at their loudest from this speed on, m/s (90 km/h). */
const FULL_ROAD_NOISE_SPEED = 25;
/** Brakes rub loudest from this speed on, m/s. */
const FULL_BRAKE_NOISE_SPEED = 10;
/** A crash this hard (m/s into the obstacle) is as loud as crashes get. */
const LOUDEST_CRASH_SPEED = 12;

/** How the engine sounds: its note, how loud, and how bright (a low-pass filter's cutoff). */
export interface EngineTone {
  /** Firing frequency, Hz. */
  frequency: number;
  /** 0..1 */
  gain: number;
  /** Hz: the harder it works, the more of its rasp comes through. */
  cutoff: number;
}

export function createEngineTone(): EngineTone {
  return { frequency: 0, gain: 0, cutoff: 0 };
}

/**
 * The engine at `rpm` with the pedal at `throttle` (0..1), for an engine
 * that idles at `idleRpm` and revs to `maxRpm`: the note follows the engine
 * speed; load makes it louder and brighter. Writes into `out`, allocation-free.
 */
export function engineTone(out: EngineTone, rpm: number, throttle: number, idleRpm: number, maxRpm: number): EngineTone {
  const load = clamp01(throttle);
  const revs = clamp01((rpm - idleRpm) / Math.max(1, maxRpm - idleRpm));
  out.frequency = (Math.max(0, rpm) / 60) * FIRINGS_PER_REVOLUTION;
  out.gain = 0.35 + 0.35 * load + 0.2 * revs;
  out.cutoff = 250 + 900 * load + 600 * revs;
  return out;
}

/** Tyres on the road and wind round the cab, 0..1: nothing at a standstill, growing with speed (m/s, either way). */
export function roadNoiseLevel(speed: number): number {
  return clamp01(Math.abs(speed) / FULL_ROAD_NOISE_SPEED) ** 1.5;
}

/** Brakes rubbing, 0..1: the pedal (0..1) pressed while the truck rolls (m/s). */
export function brakeNoiseLevel(brake: number, speed: number): number {
  return clamp01(brake) * clamp01(Math.abs(speed) / FULL_BRAKE_NOISE_SPEED);
}

/** How loud a crash sounds, 0..1, from how hard the truck hit (m/s into the obstacle). */
export function crashLevel(impactSpeed: number): number {
  return clamp01(0.25 + (0.75 * Math.max(0, impactSpeed)) / LOUDEST_CRASH_SPEED);
}

/** Sound travels this fast, m/s: thunder follows its flash by the strike's distance over this. */
const SPEED_OF_SOUND = 343;
/** Thunder from nearer than this cracks before it rumbles. */
const CRACK_WITHIN_METERS = 1500;
/** Thunder is loudest from nearer than this, and fades to a fifth of that by FAINT_THUNDER_METERS. */
const LOUD_THUNDER_METERS = 800;
const FAINT_THUNDER_METERS = 6000;

/** How a strike's thunder sounds: when it comes, how loud, how long it rolls, how deep, and how it cracks first. */
export interface ThunderSound {
  /** Seconds after the flash. */
  delaySeconds: number;
  /** 0..1 */
  level: number;
  /** How long it rolls, seconds: the farther, the longer. */
  seconds: number;
  /** The rumble's low-pass cutoff as it starts, Hz: the air takes the highs out of far thunder. */
  cutoffHz: number;
  /** How loud the crack before the rumble is, 0..1: only near strikes crack. */
  crack: number;
}

export function createThunderSound(): ThunderSound {
  return { delaySeconds: 0, level: 0, seconds: 0, cutoffHz: 0, crack: 0 };
}

/** The thunder of a strike `distanceMeters` away. Writes into `out`, allocation-free. */
export function thunderSound(distanceMeters: number, out: ThunderSound): ThunderSound {
  const distance = Math.max(0, distanceMeters);
  const far = clamp01((distance - LOUD_THUNDER_METERS) / (FAINT_THUNDER_METERS - LOUD_THUNDER_METERS));
  out.delaySeconds = distance / SPEED_OF_SOUND;
  out.level = 1 - 0.8 * far;
  out.seconds = 4.5 + distance / 1500;
  out.cutoffHz = Math.max(160, 1200 * Math.exp(-distance / 2500));
  out.crack = clamp01(1 - distance / CRACK_WITHIN_METERS);
  return out;
}
