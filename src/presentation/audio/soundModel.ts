import { clamp01 } from '../../core/math/scalar';
import { SeededRandom } from '../../core/random/SeededRandom';

/** A six-cylinder four-stroke diesel: each cylinder fires once in a cycle of two turns, so three times a turn. */
const CYLINDERS = 6;
const TURNS_PER_CYCLE = 2;
const FIRINGS_PER_REVOLUTION = CYLINDERS / TURNS_PER_CYCLE;
/**
 * With the pedal up the governor still feeds the engine fuel near idle, so it
 * ticks over burning; this far above idle (a share of the rev range) the fuel
 * is cut and the engine only coasts.
 */
const IDLE_FUEL_REVS = 0.12;
/** Road and wind noise are at their loudest from this speed on, m/s (90 km/h). */
const FULL_ROAD_NOISE_SPEED = 25;
/** Brakes rub loudest from this speed on, m/s. */
const FULL_BRAKE_NOISE_SPEED = 10;
/** A crash this hard (m/s into the obstacle) is as loud as crashes get. */
const LOUDEST_CRASH_SPEED = 12;

/** How the engine sounds at a moment: its notes, how loud and how bright, its clatter and its turbo. */
export interface EngineTone {
  /** Engine cycles a second, Hz: the engine's voice repeats once a cycle (two turns, each cylinder firing once). */
  cycleHz: number;
  /** Firing frequency, Hz: the note the six cylinders make between them. */
  frequency: number;
  /** 0..1 */
  gain: number;
  /** 0..1: how much of the voice is the engine burning fuel (the rest is it coasting, unfuelled, with the pedal up). */
  pull: number;
  /** Hz: the harder it works, the more of its bark comes through (a low-pass filter's cutoff). */
  cutoff: number;
  /** 0..1: the diesel's clatter, loudest labouring at low revs, a light tick at idle, fading as it revs; none coasting. */
  clatter: number;
  /** The turbo's whistle: its note, Hz, rising as the turbo spins up, and how loud, 0..1 (only under boost). */
  turboHz: number;
  turbo: number;
}

export function createEngineTone(): EngineTone {
  return { cycleHz: 0, frequency: 0, gain: 0, pull: 0, cutoff: 0, clatter: 0, turboHz: 0, turbo: 0 };
}

/**
 * The engine at `rpm` working at `load` (0..1: the drive pedal while the
 * clutch holds), for an engine that idles at `idleRpm` and revs to `maxRpm`:
 * the notes follow the engine speed; load makes it louder, brighter and
 * clatter more, revs louder and smoother, and the two together spin the
 * turbo up. It burns fuel under load and ticking over at idle; with the pedal
 * up above idle it coasts. Writes into `out`, allocation-free.
 */
export function engineTone(out: EngineTone, rpm: number, load: number, idleRpm: number, maxRpm: number): EngineTone {
  const work = clamp01(load);
  const revs = clamp01((rpm - idleRpm) / Math.max(1, maxRpm - idleRpm));
  const turnsPerSecond = Math.max(0, rpm) / 60;
  out.cycleHz = turnsPerSecond / TURNS_PER_CYCLE;
  out.frequency = turnsPerSecond * FIRINGS_PER_REVOLUTION;
  out.gain = Math.min(1, 0.25 + 0.47 * work + 0.28 * revs);
  // Even a light load burns fuel enough to sound it.
  out.pull = Math.max(Math.sqrt(work), 1 - revs / IDLE_FUEL_REVS, 0);
  // Kept low: a phone's speaker plays little under 300 Hz, so what it does play is all the ear hears, and the
  // engine's upper harmonics there buzz.
  out.cutoff = 520 + 480 * work + 420 * revs;
  // The knock is fuel burning: none while the engine coasts.
  out.clatter = out.pull * (0.3 + 0.7 * work) * (1 - 0.6 * revs);
  const spin = revs * (0.4 + 0.6 * work);
  out.turboHz = 900 + 1100 * spin;
  out.turbo = spin * work;
  return out;
}

/** A PeriodicWave's harmonics: cosine (`real`) and sine (`imag`) amplitudes; index 0, the constant, is unused. */
export interface Harmonics {
  readonly real: Float32Array;
  readonly imag: Float32Array;
}

/** How the six exhaust pulses of one engine cycle are shaped, and how much the cylinders differ. */
export interface PulseShape {
  /** Each pulse dies away with this time constant, a share of the cycle: the shorter, the sharper and brighter. */
  readonly tau: number;
  /** How round the pulse rises: 2 rises smoothly, 3 rounder still. */
  readonly order: number;
  /** 0..1: how much of a sharp-edged pulse joins the round one, the bark of fuel burning. */
  readonly bark: number;
  /** How much the cylinders differ: in strength (a share), in timing (a share of the cycle), in sharpness (a share). */
  readonly strengthSpread: number;
  readonly timingSpread: number;
  readonly sharpnessSpread: number;
}

/** The engine pulling: fuel burns, the pulses are sharp and strong, and they bark. */
export const PULLING: PulseShape = Object.freeze({
  tau: 0.0085,
  order: 2,
  bark: 0.12,
  strengthSpread: 0.1,
  timingSpread: 0.004,
  sharpnessSpread: 0.12,
});

/** The engine coasting: no fuel burns, the cylinders only push air out, round and soft. */
export const COASTING: PulseShape = Object.freeze({
  tau: 0.012,
  order: 2,
  bark: 0,
  strengthSpread: 0.06,
  timingSpread: 0.003,
  sharpnessSpread: 0.08,
});

/**
 * One cycle of the engine's exhaust as harmonics of the cycle: six pulses, one
 * a cylinder, each a little different from the others in strength, timing and
 * sharpness (drawn from `seed`), which gives the engine its uneven, living
 * beat under the firing note. A pulse of order k is (t/τ)^(k−1)·e^(−t/τ),
 * scaled to peak at 1; its transform at harmonic n is τ·Γ(k)/(1 + 2πinτ)^k, so
 * the harmonics are exact and quick to find. They fall away smoothly toward
 * the top: a warm voice, not a buzz. Scaled to the RMS level `rms`.
 */
export function exhaustHarmonics(shape: PulseShape, count: number, seed: number, rms: number): Harmonics {
  const random = new SeededRandom(seed);
  const strengths = new Float64Array(CYLINDERS);
  const phases = new Float64Array(CYLINDERS);
  const taus = new Float64Array(CYLINDERS);
  for (let cylinder = 0; cylinder < CYLINDERS; cylinder++) {
    strengths[cylinder] = 1 + shape.strengthSpread * random.range(-1, 1);
    phases[cylinder] = cylinder / CYLINDERS + shape.timingSpread * random.range(-1, 1);
    taus[cylinder] = shape.tau * (1 + shape.sharpnessSpread * random.range(-1, 1));
  }
  // The round pulse and the sharp one, each at its share and scaled to peak at 1.
  const parts = [
    { order: shape.order, weight: ((1 - shape.bark) * factorial(shape.order - 1)) / pulsePeak(shape.order) },
    { order: 1, weight: shape.bark },
  ];
  const real = new Float32Array(count + 1);
  const imag = new Float32Array(count + 1);
  let power = 0;
  for (let n = 1; n <= count; n++) {
    let cosines = 0;
    let sines = 0;
    for (let cylinder = 0; cylinder < CYLINDERS; cylinder++) {
      const tau = taus[cylinder]!;
      const theta = 2 * Math.PI * n * tau;
      const shift = 2 * Math.PI * n * phases[cylinder]!;
      for (const { order, weight } of parts) {
        // (1 + iθ)^−k = r^−k·e^(−ikα), with r = √(1 + θ²) and α = atan θ.
        const magnitude = (weight * strengths[cylinder]! * tau) / Math.pow(1 + theta * theta, order / 2);
        const angle = order * Math.atan(theta) + shift;
        cosines += magnitude * Math.cos(angle);
        sines += magnitude * Math.sin(angle);
      }
    }
    real[n] = 2 * cosines;
    imag[n] = 2 * sines;
    power += (real[n]! * real[n]! + imag[n]! * imag[n]!) / 2;
  }
  scale(real, imag, power > 0 ? rms / Math.sqrt(power) : 0);
  return { real, imag };
}

/** The diesel's knock in the cycle: a short pulse as each cylinder fires, how loud each knocks, and their average. */
export interface KnockTiming extends Harmonics {
  /** The pulses' average, which a PeriodicWave leaves out (it has no constant term): add it back to gate with them. */
  readonly mean: number;
}

/**
 * When the diesel knocks, as harmonics of the cycle: six short raised-cosine
 * pulses `width` (a share of the cycle) wide, one as each cylinder fires,
 * some knocking harder than others (drawn from `seed`), peaking near 1 and
 * near 0 between. A raised cosine of width w transforms to
 * (w/2)·sinc(nw)/(1 − (nw)²) at harmonic n.
 */
export function knockHarmonics(count: number, width: number, seed: number): KnockTiming {
  const random = new SeededRandom(seed);
  const real = new Float32Array(count + 1);
  const imag = new Float32Array(count + 1);
  const heights = new Float64Array(CYLINDERS);
  const centres = new Float64Array(CYLINDERS);
  let mean = 0;
  for (let cylinder = 0; cylinder < CYLINDERS; cylinder++) {
    heights[cylinder] = 1 - 0.3 * random.next();
    centres[cylinder] = cylinder / CYLINDERS + 0.003 * random.range(-1, 1);
    mean += (heights[cylinder]! * width) / 2;
  }
  for (let n = 1; n <= count; n++) {
    const x = n * width;
    const envelope = Math.abs(x - 1) < 1e-9 ? width / 4 : ((width / 2) * sinc(x)) / (1 - x * x);
    let cosines = 0;
    let sines = 0;
    for (let cylinder = 0; cylinder < CYLINDERS; cylinder++) {
      const angle = 2 * Math.PI * n * centres[cylinder]!;
      cosines += heights[cylinder]! * envelope * Math.cos(angle);
      sines += heights[cylinder]! * envelope * Math.sin(angle);
    }
    real[n] = 2 * cosines;
    imag[n] = 2 * sines;
  }
  return { real, imag, mean };
}

function factorial(n: number): number {
  let product = 1;
  for (let i = 2; i <= n; i++) {
    product *= i;
  }
  return product;
}

/** The peak of (t/τ)^(k−1)·e^(−t/τ): ((k−1)/e)^(k−1), at t = (k−1)τ; 1 for k = 1. */
function pulsePeak(order: number): number {
  return order === 1 ? 1 : Math.pow((order - 1) / Math.E, order - 1);
}

function sinc(x: number): number {
  return x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
}

function scale(real: Float32Array, imag: Float32Array, factor: number): void {
  for (let n = 0; n < real.length; n++) {
    real[n] = real[n]! * factor;
    imag[n] = imag[n]! * factor;
  }
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
