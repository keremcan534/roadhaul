import { isLogLevel } from '../../core/logging/Logger';
import type { GameConfig } from '../../data/config/GameConfig';

/** The part of URLSearchParams this module needs. */
export interface QueryParameters {
  has(name: string): boolean;
  get(name: string): string | null;
}

/**
 * Developer switches read from the page URL:
 * - `?debug` shows the performance overlay and enables debug logging.
 * - `?log=warn` (debug | info | warn | error) sets the log level explicitly.
 * - `?fuelScale=60` burns fuel that many times faster than the spec formula
 *   per map meter (a positive number; tests use it to empty a tank quickly).
 */
export function applyConfigOverrides(config: GameConfig, query: QueryParameters): GameConfig {
  const debug = query.has('debug');
  const requestedLevel = query.get('log');
  const logLevel =
    requestedLevel !== null && isLogLevel(requestedLevel) ? requestedLevel : debug ? 'debug' : config.debug.logLevel;
  const fuelScale = Number(query.get('fuelScale') ?? Number.NaN);

  return {
    ...config,
    fuel: {
      ...config.fuel,
      consumptionScale: Number.isFinite(fuelScale) && fuelScale > 0 ? fuelScale : config.fuel.consumptionScale,
    },
    debug: {
      logLevel,
      showPerfOverlay: debug || config.debug.showPerfOverlay,
    },
  };
}
