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
