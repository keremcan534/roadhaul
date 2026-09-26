import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_CONFIG } from '../../../src/data/config/GameConfig';
import {
  applyConfigOverrides,
  requestedDateMs,
  requestedLampLight,
  requestedSpawn,
  requestedTimeOfDay,
  requestedWetness,
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

  it('keeps the first weather for ?weather=dawn, dusk or night: those are times of day (requestedTimeOfDay)', () => {
    for (const phase of ['dawn', 'dusk', 'night']) {
      expect(applyConfigOverrides(DEFAULT_GAME_CONFIG, query(`?weather=${phase}`)).weather, phase).toEqual({
        ...DEFAULT_GAME_CONFIG.weather,
        changes: false,
      });
    }
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

describe('requestedLampLight', () => {
  it('turns the lamps\' light off or on when the URL says, and leaves it to the entry point otherwise', () => {
    expect(requestedLampLight(query('?lamps=0'))).toBe(false);
    expect(requestedLampLight(query('?lamps=1'))).toBe(true);
    expect(requestedLampLight(query('?lamps=yes'))).toBeNull();
    expect(requestedLampLight(query(''))).toBeNull();
  });
});

describe('requestedWetness', () => {
  it('keeps the roads as wet as the URL says, from dry to soaked, and leaves them to the weather otherwise', () => {
    expect(requestedWetness(query('?wet=1'))).toBe(1);
    expect(requestedWetness(query('?wet=0.4'))).toBe(0.4);
    expect(requestedWetness(query('?wet=0'))).toBe(0);
    for (const search of ['', '?wet=', '?wet=2', '?wet=-1', '?wet=soaked']) {
      expect(requestedWetness(query(search)), search).toBeNull();
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

describe('requestedTimeOfDay', () => {
  it('reads a time on the clock from ?time=, and a time of day\'s look from ?weather=', () => {
    expect(requestedTimeOfDay(query('?time=19:30'))).toEqual({ minutes: 19 * 60 + 30 });
    expect(requestedTimeOfDay(query('?weather=night'))).toEqual({ phase: 'night' });
    expect(requestedTimeOfDay(query('?weather=dusk&time=6:05'))).toEqual({ minutes: 6 * 60 + 5 });
    expect(requestedTimeOfDay(query('?weather=rain'))).toBeNull();
    expect(requestedTimeOfDay(query('?time=25:00'))).toBeNull();
    expect(requestedTimeOfDay(query(''))).toBeNull();
  });
});

describe('requestedSpawn', () => {
  it('starts the truck where ?spawn=x,z[,heading in degrees] says, and nowhere else without one it can read', () => {
    expect(requestedSpawn(query('?spawn=-1086,-339,-68'))).toEqual({ x: -1086, z: -339, headingDegrees: -68 });
    expect(requestedSpawn(query('?spawn=12.5, 40'))).toEqual({ x: 12.5, z: 40, headingDegrees: 0 });
    expect(requestedSpawn(query('?spawn=12'))).toBeNull();
    expect(requestedSpawn(query('?spawn=1,2,3,4'))).toBeNull();
    expect(requestedSpawn(query('?spawn=a,2'))).toBeNull();
    expect(requestedSpawn(query('?spawn='))).toBeNull();
    expect(requestedSpawn(query(''))).toBeNull();
  });
});
