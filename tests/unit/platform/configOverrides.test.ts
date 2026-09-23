import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_CONFIG } from '../../../src/data/config/GameConfig';
import { applyConfigOverrides, type QueryParameters } from '../../../src/platform/browser/configOverrides';

/** The URL's query as the game reads it, from "?a=1&b" (the unit tests run without browser globals). */
function query(search: string): QueryParameters {
  const values = new Map<string, string>();
  for (const pair of search.replace(/^\?/, '').split('&').filter(Boolean)) {
    const [name, value = ''] = pair.split('=');
    values.set(name!, decodeURIComponent(value));
  }
  return { has: (name) => values.has(name), get: (name) => values.get(name) ?? null };
}

describe('applyConfigOverrides', () => {
  it('leaves the config alone without switches', () => {
    expect(applyConfigOverrides(DEFAULT_GAME_CONFIG, query(''))).toEqual(DEFAULT_GAME_CONFIG);
  });

  it('turns on the overlay and debug logging with ?debug, and takes an explicit log level', () => {
    const debug = applyConfigOverrides(DEFAULT_GAME_CONFIG, query('?debug'));
    const quiet = applyConfigOverrides(DEFAULT_GAME_CONFIG, query('?debug&log=warn'));

    expect(debug.debug).toEqual({ logLevel: 'debug', showPerfOverlay: true });
    expect(quiet.debug.logLevel).toBe('warn');
  });

  it('scales fuel use with a positive ?fuelScale and ignores anything else', () => {
    expect(applyConfigOverrides(DEFAULT_GAME_CONFIG, query('?fuelScale=60')).fuel.consumptionScale).toBe(60);
    for (const bad of ['0', '-5', 'fast', 'Infinity', '']) {
      expect(applyConfigOverrides(DEFAULT_GAME_CONFIG, query(`?fuelScale=${bad}`)).fuel, bad).toEqual(
        DEFAULT_GAME_CONFIG.fuel,
      );
    }
  });
});
