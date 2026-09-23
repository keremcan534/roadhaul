/** Small numeric helpers shared by simulation, presentation and UI code. None of them allocate. */

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/** Replaces NaN and ±Infinity with `fallback`, so one bad input cannot poison a simulation. */
export function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Moves `current` toward `target` by at most `maxDelta`. */
export function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) {
    return Math.min(current + maxDelta, target);
  }
  return Math.max(current - maxDelta, target);
}

/**
 * Frame-rate independent exponential smoothing: the fraction of the remaining
 * distance to cover this frame, for a response rate `rate` (1/s).
 * Use as `value += (target - value) * dampFactor(rate, dt)`.
 */
export function dampFactor(rate: number, deltaSeconds: number): number {
  return 1 - Math.exp(-rate * deltaSeconds);
}

export function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function kmhToMetersPerSecond(kmh: number): number {
  return kmh / 3.6;
}

export function metersPerSecondToKmh(metersPerSecond: number): number {
  return metersPerSecond * 3.6;
}
