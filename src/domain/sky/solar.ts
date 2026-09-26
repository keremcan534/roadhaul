import { degreesToRadians } from '../../core/math/scalar';

/**
 * Where the sun, the moon and the stars stand over the region: the sun on
 * its real path for the date and the clock (the seasons' longer and shorter
 * days, low in winter, high in summer), the moon by its phase, the stars
 * turning round the pole. Simple spherical astronomy, good to a degree or
 * so, which is all a sky needs. Directions are in the world's axes: x east,
 * y up, z south (north is −z, as on the map).
 */

const DAY_MS = 86_400_000;
/** 2000-01-01T00:00Z, and a new moon at 2000-01-06T18:14Z, epoch ms. */
const Y2000_MS = 946_684_800_000;
const NEW_MOON_MS = 947_182_440_000;
/** Days in the year of the seasons (tropical), and from one new moon to the next (synodic month). */
const YEAR_DAYS = 365.2422;
const SYNODIC_MONTH_DAYS = 29.530588853;
/** The earth's tilt: how far north and south of the equator the sun goes through the year. */
const EARTH_TILT = degreesToRadians(23.44);
/** Days from 1 January to the March equinox, when the sun crosses the equator going north. */
const EQUINOX_DAY = 79.3;

/** A direction in the world's axes, unit length. Writable, so per-frame code can reuse one. */
export interface SkyDirection {
  x: number;
  y: number;
  z: number;
}

/** Days since 1 January's midnight (UTC), fractional, at `epochMs`: close enough for the sun's path. */
export function dayOfYear(epochMs: number): number {
  const days = (epochMs - Y2000_MS) / DAY_MS;
  return ((days % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS;
}

/** How far north of the equator the sun stands on `day` of the year (dayOfYear), radians (negative south). */
export function sunDeclination(day: number): number {
  return Math.asin(Math.sin(EARTH_TILT) * Math.sin((2 * Math.PI * (day - EQUINOX_DAY)) / YEAR_DAYS));
}

/**
 * The sun's hour angle at clock time `minutes` (after midnight), radians:
 * 0 when it stands highest (at `solarNoonHours`), negative before, positive
 * after; the sky turns 15° an hour.
 */
export function sunHourAngle(minutes: number, solarNoonHours: number): number {
  return ((minutes / 60 - solarNoonHours) / 24) * 2 * Math.PI;
}

/**
 * The direction of a body `declination` north of the sky's equator and
 * `hourAngle` past its highest (both radians), seen from `latitude` (radians
 * north). Writes and returns `out`.
 */
export function skyDirection(declination: number, hourAngle: number, latitude: number, out: SkyDirection): SkyDirection {
  const cosDeclination = Math.cos(declination);
  const east = -cosDeclination * Math.sin(hourAngle);
  const north = Math.cos(latitude) * Math.sin(declination) - Math.sin(latitude) * cosDeclination * Math.cos(hourAngle);
  out.x = east;
  out.y = Math.sin(latitude) * Math.sin(declination) + Math.cos(latitude) * cosDeclination * Math.cos(hourAngle);
  out.z = -north;
  return out;
}

/** How far through its phases the moon is at `epochMs`: 0 new, 0.5 full, toward 1 new again. */
export function moonPhase(epochMs: number): number {
  const days = (epochMs - NEW_MOON_MS) / DAY_MS;
  return (((days % SYNODIC_MONTH_DAYS) + SYNODIC_MONTH_DAYS) % SYNODIC_MONTH_DAYS) / SYNODIC_MONTH_DAYS;
}

/** The share of the moon's face lit at `phase` (moonPhase): 0 new, 1 full. */
export function moonIllumination(phase: number): number {
  return (1 - Math.cos(2 * Math.PI * phase)) / 2;
}

/**
 * The moon's declination on `day` of the year at `phase`, radians. It goes
 * round the same tilted path as the sun (its own 5° off it left out), the
 * phase ahead of it: the full moon stands where the sun will in six months,
 * so it rides high in winter and low in summer.
 */
export function moonDeclination(day: number, phase: number): number {
  return Math.asin(Math.sin(EARTH_TILT) * Math.sin((2 * Math.PI * (day - EQUINOX_DAY)) / YEAR_DAYS + 2 * Math.PI * phase));
}

/** The moon's hour angle when the sun's is `sunHourAngle`: it trails the sun by its phase, rising later each day. */
export function moonHourAngle(sunHourAngle: number, phase: number): number {
  return sunHourAngle - 2 * Math.PI * phase;
}

/**
 * How far the stars have turned round the pole (radians) at clock time
 * `minutes` on `day` of the year: as fast as the sun, plus a turn a year, so
 * the same stars stand a little further west each night.
 */
export function starTurn(minutes: number, day: number, solarNoonHours: number): number {
  return sunHourAngle(minutes, solarNoonHours) + (2 * Math.PI * day) / YEAR_DAYS;
}
