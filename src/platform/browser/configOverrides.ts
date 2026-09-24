import { isLogLevel } from '../../core/logging/Logger';
import { MAX_TRAFFIC_VEHICLES, type GameConfig } from '../../data/config/GameConfig';
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
 * Developer switches read from the page URL:
 * - `?debug` shows the performance overlay and enables debug logging.
 * - `?log=warn` (debug | info | warn | error) sets the log level explicitly.
 * - `?fuelScale=60` burns fuel that many times faster than the spec formula
 *   per map meter (a positive number; tests use it to empty a tank quickly).
 * - `?traffic=0` sets how many NPC vehicles drive around (0 turns traffic
 *   off; a whole number up to MAX_TRAFFIC_VEHICLES).
 * - `?weather=rain` starts in that weather and keeps it (the config check
 *   rejects ids that do not exist).
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

  return {
    ...config,
    fuel: {
      ...config.fuel,
      consumptionScale: Number.isFinite(fuelScale) && fuelScale > 0 ? fuelScale : config.fuel.consumptionScale,
    },
    traffic: {
      ...config.traffic,
      maxVehicles:
        Number.isInteger(traffic) && traffic >= 0 && traffic <= MAX_TRAFFIC_VEHICLES ? traffic : config.traffic.maxVehicles,
    },
    weather: weatherId === '' ? config.weather : { ...config.weather, initialWeatherId: weatherId, changes: false },
    debug: {
      logLevel,
      showPerfOverlay: debug || config.debug.showPerfOverlay,
    },
  };
}
