import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_CONFIG } from '../../../src/data/config/GameConfig';
import {
  applyConfigOverrides,
  requestedDateMs,
  type QueryParameters,
} from '../../../src/platform/browser/configOverrides';

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

  it('sets how much traffic drives around with ?traffic, from none to the most a phone can take', () => {
    expect(applyConfigOverrides(DEFAULT_GAME_CONFIG, query('?traffic=0')).traffic.maxVehicles).toBe(0);
    expect(applyConfigOverrides(DEFAULT_GAME_CONFIG, query('?traffic=30')).traffic.maxVehicles).toBe(30);
    for (const bad of ['-1', '2.5', 'lots', '', '1000']) {
      expect(applyConfigOverrides(DEFAULT_GAME_CONFIG, query(`?traffic=${bad}`)).traffic, bad).toEqual(
        DEFAULT_GAME_CONFIG.traffic,
      );
    }
  });

  it('starts in the weather ?weather names and keeps it', () => {
    expect(applyConfigOverrides(DEFAULT_GAME_CONFIG, query('?weather=rain')).weather).toEqual({
      ...DEFAULT_GAME_CONFIG.weather,
      initialWeatherId: 'rain',
      changes: false,
    });
    expect(applyConfigOverrides(DEFAULT_GAME_CONFIG, query('?weather=')).weather).toEqual(DEFAULT_GAME_CONFIG.weather);
  });

  it('turns the colour pass off with ?post=0, and on over the preset with ?post=1', () => {
    const low = { ...DEFAULT_GAME_CONFIG, rendering: { ...DEFAULT_GAME_CONFIG.rendering, postProcessing: false } };

    expect(applyConfigOverrides(DEFAULT_GAME_CONFIG, query('?post=0')).rendering).toEqual({
      ...DEFAULT_GAME_CONFIG.rendering,
      postProcessing: false,
    });
    expect(applyConfigOverrides(low, query('?post=1')).rendering.postProcessing).toBe(true);
    for (const other of ['', 'off', 'yes']) {
      expect(applyConfigOverrides(DEFAULT_GAME_CONFIG, query(`?post=${other}`)).rendering, other).toBe(
        DEFAULT_GAME_CONFIG.rendering,
      );
    }
  });
});

describe('requestedDateMs', () => {
  it('reads a day as its midnight UTC, or a full date and time', () => {
    expect(requestedDateMs(query('?date=2026-09-30'))).toBe(Date.UTC(2026, 8, 30));
    expect(requestedDateMs(query('?date=2026-09-30T14:30:00Z'))).toBe(Date.UTC(2026, 8, 30, 14, 30));
  });

  it('keeps the real date without one, or with one it cannot read', () => {
    for (const search of ['', '?date=', '?date=someday', '?date=2026-02-30']) {
      expect(requestedDateMs(query(search)), search).toBeNull();
    }
  });
});
