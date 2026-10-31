import { clamp01 } from '../../core/math/scalar';

/**
 * With the pedal up the governor still feeds the engine fuel near idle, so it
 * ticks over burning; this far above idle (a share of the rev range) the fuel
 * is cut and the engine only coasts.
 */
const IDLE_FUEL_REVS = 0.12;
/** The engine's brightness (a low-pass filter's cutoff, Hz): coasting it is muffled, pulling hard it barks. */
const COASTING_CUTOFF_HZ = 1300;
const IDLING_CUTOFF_HZ = 3200;
const PULLING_CUTOFF_HZ = 6500;
/** Road and wind noise are at their loudest from this speed on, m/s (90 km/h). */
const FULL_ROAD_NOISE_SPEED = 25;
/** Brakes rub loudest from this speed on, m/s. */
const FULL_BRAKE_NOISE_SPEED = 10;
/** A crash this hard (m/s into the obstacle) is as loud as crashes get. */
const LOUDEST_CRASH_SPEED = 12;

/** How the engine sounds at a moment: how loud, how much it burns, how bright. */
export interface EngineTone {
  /** 0..1 */
  gain: number;
  /** 0..1: how much of the sound is the engine burning fuel (the rest is it coasting, unfuelled, with the pedal up). */
  pull: number;
  /** Hz: the harder it works, the more of its bark comes through (a low-pass filter's cutoff). */
  cutoff: number;
}

export function createEngineTone(): EngineTone {
  return { gain: 0, pull: 0, cutoff: 0 };
}

/**
 * The engine at `rpm` working at `load` (0..1: the drive pedal while the
 * clutch holds), for an engine that idles at `idleRpm` and revs to `maxRpm`.
 * The recording carries the engine's voice, so this only shapes it, and
 * lightly: load and revs lift it a little and brighten it; with the pedal up
 * above idle it coasts, softer and muffled. Writes into `out`, allocation-free.
 */
export function engineTone(out: EngineTone, rpm: number, load: number, idleRpm: number, maxRpm: number): EngineTone {
  const work = clamp01(load);
  const revs = clamp01((rpm - idleRpm) / Math.max(1, maxRpm - idleRpm));
  // Even a light load burns fuel enough to sound it.
  out.pull = Math.max(Math.sqrt(work), 1 - revs / IDLE_FUEL_REVS, 0);
  out.gain = Math.min(1, 0.55 + 0.25 * work + 0.2 * revs) * (0.7 + 0.3 * out.pull);
  const burning = IDLING_CUTOFF_HZ + (PULLING_CUTOFF_HZ - IDLING_CUTOFF_HZ) * work;
  out.cutoff = COASTING_CUTOFF_HZ + (burning - COASTING_CUTOFF_HZ) * out.pull;
  return out;
}

/** How the engine's recorded loops mix at a moment: each one's level, and how fast it plays (1: as recorded). */
export interface EngineLoopMix {
  readonly gains: Float64Array;
  readonly rates: Float64Array;
}

export function createEngineLoopMix(loops: number): EngineLoopMix {
  return { gains: new Float64Array(loops), rates: new Float64Array(loops) };
}

/**
 * Mixes the engine's loops, each recorded at one engine speed (`loopRpms`,
 * rising), for the engine at `rpm`: the two recorded nearest it, cross-faded
 * by power along the octaves between them, each played faster or slower to
 * meet it; below the first or above the last, that one alone. Writes into
 * `out`, allocation-free.
 */
export function engineLoopMix(out: EngineLoopMix, rpm: number, loopRpms: readonly number[]): EngineLoopMix {
  const count = loopRpms.length;
  if (count === 0) {
    return out;
  }
  // A stopped engine's loops keep a sound, slowed, rather than freeze (the engine's level silences them).
  const speed = Math.max(rpm, loopRpms[0]! / 2);
  let upper = 0;
  while (upper < count && loopRpms[upper]! <= speed) {
    upper++;
  }
  for (let loop = 0; loop < count; loop++) {
    out.gains[loop] = 0;
    out.rates[loop] = speed / loopRpms[loop]!;
  }
  if (upper === 0 || upper === count) {
    out.gains[upper === 0 ? 0 : count - 1] = 1;
    return out;
  }
  const below = loopRpms[upper - 1]!;
  const share = Math.log(speed / below) / Math.log(loopRpms[upper]! / below);
  out.gains[upper - 1] = Math.cos((share * Math.PI) / 2);
  out.gains[upper] = Math.sin((share * Math.PI) / 2);
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
export const SPEED_OF_SOUND = 343;
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
