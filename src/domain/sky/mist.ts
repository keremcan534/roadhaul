import { clamp01, smoothstep } from '../../core/math/scalar';

/**
 * Morning mist (radiation fog): on a clear night the land cools, and the
 * air over it mists up. The mist gathers while the sun is between these
 * elevations under the horizon (degrees), lies full from the second until
 * the sun is a little up, and lifts as it climbs, gone by the second of
 * MIST_LIFTS_DEGREES: about an hour and a half after sunrise.
 */
const MIST_GATHERS_DEGREES = [-14, -5] as const;
const MIST_LIFTS_DEGREES = [2, 15] as const;
/** An overcast night keeps the land warm: from this much cloud the mist thins, to MIST_UNDER_CLOUD at the most. */
const CLOUD_THINS_MIST = [0.55, 0.95] as const;
const MIST_UNDER_CLOUD = 0.3;
/** On dry ground the mist lies this thick; after rain, full. */
const MIST_ON_DRY_GROUND = 0.7;

/**
 * How thick the morning mist lies, 0..1, with the sun at
 * `sunElevationDegrees`, `rising` (in the morning; none in the evening),
 * in `rain` (0..1: none while it rains, which brings its own haze), under
 * `cloudCover` (0..1) and on ground as wet as `wetness` (0..1).
 */
export function morningMist(sunElevationDegrees: number, rising: boolean, rain: number, cloudCover: number, wetness: number): number {
  if (!rising) {
    return 0;
  }
  const time =
    smoothstep(MIST_GATHERS_DEGREES[0], MIST_GATHERS_DEGREES[1], sunElevationDegrees) *
    (1 - smoothstep(MIST_LIFTS_DEGREES[0], MIST_LIFTS_DEGREES[1], sunElevationDegrees));
  const clearNight = 1 - (1 - MIST_UNDER_CLOUD) * smoothstep(CLOUD_THINS_MIST[0], CLOUD_THINS_MIST[1], cloudCover);
  const dry = (1 - clamp01(rain)) ** 2;
  const ground = MIST_ON_DRY_GROUND + (1 - MIST_ON_DRY_GROUND) * clamp01(wetness);
  return clamp01(time * clearNight * dry * ground);
}
