import { describe, expect, it } from 'vitest';
import type { Clock } from '../../../../src/core/time/Clock';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import { ContentCatalog } from '../../../../src/data/ContentCatalog';
import { GAME_CONTENT } from '../../../../src/data/content';
import { CLOCK_PRESETS, TimeOfDayService } from '../../../../src/systems/weather/TimeOfDayService';

const catalog = ContentCatalog.create(GAME_CONTENT);
const config = DEFAULT_GAME_CONFIG.timeOfDay;
/** 21 June and 21 December 2026 at noon UTC; a full moon (4 December 2025) and a new one (20 November 2025). */
const JUNE = Date.UTC(2026, 5, 21, 12);
const DECEMBER = Date.UTC(2026, 11, 21, 12);
const FULL_MOON = Date.UTC(2025, 11, 4, 23);
const NEW_MOON = Date.UTC(2025, 10, 20, 7);

function service(atMs = JUNE, offsetMinutes = 0): { time: TimeOfDayService; clock: { now: () => number; ms: number } } {
  const clock = { ms: atMs, now: () => clock.ms };
  return { time: new TimeOfDayService(catalog, clock satisfies Clock, config, offsetMinutes), clock };
}

describe('TimeOfDayService', () => {
  it('starts at the configured time, and lets the day pass twenty times faster than real time', () => {
    const { time } = service();
    expect(time.minutes).toBe(config.startMinutes);
    expect(time.flow).toBe('passes');

    time.update(60);
    expect(time.minutes).toBeCloseTo(config.startMinutes + 20, 9);
    // Round midnight into the next day.
    time.set(23 * 60 + 50);
    time.update(60);
    expect(time.minutes).toBeCloseTo(10, 9);
  });

  it('stands still when stopped, and keeps the phone\'s time when asked', () => {
    const { time, clock } = service(Date.UTC(2026, 5, 21, 9, 30), 180);
    time.flow = 'stopped';
    time.set(15 * 60);
    time.update(600);
    expect(time.minutes).toBe(15 * 60);

    time.flow = 'device';
    expect(time.minutes).toBeCloseTo(12 * 60 + 30, 6); // 09:30 UTC, three hours ahead.
    time.set(3 * 60); // The phone's time wins.
    clock.ms += 60_000;
    time.update(1 / 60);
    expect(time.minutes).toBeCloseTo(12 * 60 + 31, 6);
  });

  it('puts the sun high in the south at noon and under the horizon at midnight, higher in summer', () => {
    const { time } = service(JUNE);
    time.flow = 'stopped';
    time.set(config.solarNoonHours * 60);
    expect(time.sunElevationDegrees).toBeCloseTo(90 - config.latitudeDegrees + 23.44, 0);
    expect(time.sun.z).toBeGreaterThan(0);
    expect(time.shown).toBe('day');
    expect(time.weights).toEqual({ day: 1, twilight: 0, night: 0 });
    expect(time.trafficSpeedFactor).toBe(1);

    time.set(0);
    expect(time.sunElevationDegrees).toBeLessThan(-12);
    expect(time.shown).toBe('night');
    expect(time.trafficSpeedFactor).toBeCloseTo(catalog.daylight.get('night').trafficSpeedFactor, 12);

    const winter = service(DECEMBER).time;
    winter.flow = 'stopped';
    winter.set(config.solarNoonHours * 60);
    expect(winter.sunElevationDegrees).toBeLessThan(30);
  });

  it('dawns in the morning and dusks in the evening, when the sun stands where their looks are', () => {
    const { time } = service(JUNE);
    time.flow = 'stopped';
    const dawn = time.timeOf('dawn');
    time.set(dawn);
    expect(time.shown).toBe('dawn');
    expect(time.twilight.id).toBe('dawn');
    expect(time.sunElevationDegrees).toBeCloseTo(catalog.daylight.get('dawn').sunElevationDegrees, 0);
    const dusk = time.timeOf('dusk');
    time.set(dusk);
    expect(time.shown).toBe('dusk');
    expect(time.twilight.id).toBe('dusk');
    // A summer's evening: sunset past eight o'clock.
    expect(dusk).toBeGreaterThan(19 * 60);
  });

  it('offers the presets in the day\'s order, on the five minutes, and shorter days in winter', () => {
    const summer = service(JUNE).time;
    const winter = service(DECEMBER).time;
    const times = CLOCK_PRESETS.map((preset) => summer.timeOf(preset));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    for (const minutes of times) {
      expect(minutes % 5).toBe(0);
    }
    expect(winter.timeOf('dusk') - winter.timeOf('dawn')).toBeLessThan(summer.timeOf('dusk') - summer.timeOf('dawn') - 4 * 60);
    // The night preset is a night.
    winter.flow = 'stopped';
    winter.set(winter.timeOf('night'));
    expect(winter.shown).toBe('night');
  });

  it('lights the night by the moon as bright as its phase, when it is up', () => {
    const full = service(FULL_MOON).time;
    full.flow = 'stopped';
    // A full moon is up all night, highest round midnight.
    full.set(0);
    expect(full.moonPhase).toBeCloseTo(0.5, 1);
    expect(full.moonElevationDegrees).toBeGreaterThan(30);
    expect(full.moonlit).toBeGreaterThan(0.9);

    const dark = service(NEW_MOON).time;
    dark.flow = 'stopped';
    dark.set(0);
    expect(dark.moonlit).toBeLessThan(0.05);
  });

  it('turns the stars with the clock', () => {
    const { time } = service();
    time.flow = 'stopped';
    time.set(0);
    const midnight = time.starTurn;
    time.set(60);
    expect(time.starTurn - midnight).toBeCloseTo(Math.PI / 12, 9);
  });
});
