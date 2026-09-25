import { isLogLevel } from '../../core/logging/Logger';
import { MAX_TRAFFIC_VEHICLES, type GameConfig } from '../../data/config/GameConfig';
import { parseClock } from '../../core/time/dayTime';
import { isDaylightPhase, type DaylightPhase } from '../../data/definitions/DaylightDefinition';
import { utcMidnightMs } from '../../data/definitions/EventDefinition';

/** The part of URLSearchParams this module needs. */
export interface QueryParameters {
  has(name: string): boolean;
  get(name: string): string | null;
}

/**
 * `?date=2026-09-30` (a day, or an ISO 8601 date and time, UTC unless it says
 * otherwise) starts the game's calendar then, for the special events; the
 * clock ticks on from there. Epoch ms, or null for the real date.
 */
export function requestedDateMs(query: QueryParameters): number | null {
  const text = query.get('date')?.trim() ?? '';
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(text) ? utcMidnightMs(text) : Date.parse(text);
  return text !== '' && Number.isFinite(ms) ? ms : null;
}

/**
 * `?lamps=0` keeps the night's lamps from lighting the world (their glows
 * stay), `?lamps=1` lets them light it even where the entry point would
 * not (software rendering). Null when the URL does not say.
 */
export function requestedLampLight(query: QueryParameters): boolean | null {
  const lamps = query.get('lamps');
  return lamps === '0' || lamps === '1' ? lamps === '1' : null;
}

/**
 * `?spawn=-1600,700,40` starts a new game's truck there on every map: its
 * rear axle at x, z (meters) heading that many degrees (0 along +z, 90
 * along +x; 0 if left out), to look round a place without driving to it.
 * Null when the URL does not say, or says something else.
 */
export function requestedSpawn(query: QueryParameters): { readonly x: number; readonly z: number; readonly headingDegrees: number } | null {
  const parts = (query.get('spawn') ?? '').split(',').map((part) => Number(part.trim()));
  const [x, z, headingDegrees = 0] = parts;
  if ((parts.length !== 2 && parts.length !== 3) || !parts.every(Number.isFinite) || x === undefined || z === undefined) {
    return null;
  }
  return { x, z, headingDegrees };
}

/** A time of day the URL asks for: a time on the clock, or the moment the sky takes one of the time's looks. */
export type RequestedTime = { readonly minutes: number } | { readonly phase: DaylightPhase };

/**
 * `?time=19:30` sets the game's clock to that time and keeps it there;
 * `?weather=dawn` (or `dusk`, `night`: the looks of the time of day, not
 * kinds of weather) keeps it where the sky looks so. Null when the URL
 * asks for neither.
 */
export function requestedTimeOfDay(query: QueryParameters): RequestedTime | null {
  const minutes = parseClock(query.get('time') ?? '');
  if (minutes !== null) {
    return { minutes };
  }
  const weather = query.get('weather')?.trim();
  return isDaylightPhase(weather) ? { phase: weather } : null;
}

/**
 * Developer switches read from the page URL:
 * - `?debug` shows the performance overlay and enables debug logging.
 * - `?log=warn` (debug | info | warn | error) sets the log level explicitly.
 * - `?fuelScale=60` burns fuel that many times faster than the spec formula
 *   per map meter (a positive number; tests use it to empty a tank quickly).
 * - `?traffic=0` sets how many NPC vehicles drive around (0 turns traffic
 *   off; a whole number up to MAX_TRAFFIC_VEHICLES).
 * - `?weather=rain` starts in that weather and keeps it (the config check
 *   rejects ids that do not exist). `?weather=dawn|dusk|night` keeps the
 *   first weather instead (requestedTimeOfDay sets the time).
 * - `?post=0` draws the scene straight to the screen, without the colour
 *   pass, its bloom and smoothing (`?post=1` turns it on over the preset).
 */
export function applyConfigOverrides(config: GameConfig, query: QueryParameters): GameConfig {
  const debug = query.has('debug');
  const requestedLevel = query.get('log');
  const logLevel =
    requestedLevel !== null && isLogLevel(requestedLevel) ? requestedLevel : debug ? 'debug' : config.debug.logLevel;
  const fuelScale = Number(query.get('fuelScale') ?? Number.NaN);
  const weatherId = query.get('weather')?.trim() ?? '';
  const trafficText = query.get('traffic')?.trim() ?? '';
  const traffic = trafficText === '' ? Number.NaN : Number(trafficText);
  const post = query.get('post');

  return {
    ...config,
    rendering:
      post === '0' || post === '1' ? { ...config.rendering, postProcessing: post === '1' } : config.rendering,
    fuel: {
      ...config.fuel,
      consumptionScale: Number.isFinite(fuelScale) && fuelScale > 0 ? fuelScale : config.fuel.consumptionScale,
    },
    traffic: {
      ...config.traffic,
      maxVehicles:
        Number.isInteger(traffic) && traffic >= 0 && traffic <= MAX_TRAFFIC_VEHICLES ? traffic : config.traffic.maxVehicles,
    },
    weather:
      weatherId === ''
        ? config.weather
        : isDaylightPhase(weatherId)
          ? { ...config.weather, changes: false }
          : { ...config.weather, initialWeatherId: weatherId, changes: false },
    debug: {
      logLevel,
      showPerfOverlay: debug || config.debug.showPerfOverlay,
    },
  };
}
