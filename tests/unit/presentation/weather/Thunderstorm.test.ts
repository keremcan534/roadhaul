import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../../../../src/core/random/SeededRandom';
import { Thunderstorm, type LightningStrike } from '../../../../src/presentation/weather/Thunderstorm';

const STEP = 1 / 60;

/** Runs the storm `seconds` on in rain `rain` hard; each strike is copied out, with the flash each step. */
function run(storm: Thunderstorm, seconds: number, rain: number, lookBearing = 0) {
  const strikes: LightningStrike[] = [];
  const flashes: number[] = [];
  for (let step = 0; step < Math.round(seconds / STEP); step++) {
    const strike = storm.update(STEP, rain, lookBearing);
    if (strike !== null) {
      strikes.push({ ...strike });
    }
    flashes.push(storm.flash);
  }
  return { strikes, flashes };
}

describe('Thunderstorm', () => {
  it('strikes now and then in heavy rain, never in lighter rain or in the dry', () => {
    expect(run(new Thunderstorm(), 600, 0).strikes).toEqual([]);
    expect(run(new Thunderstorm(), 600, 0.5).strikes).toEqual([]);

    const { strikes } = run(new Thunderstorm(), 600, 1);
    // A strike every 7 to 22 seconds in a full storm.
    expect(strikes.length).toBeGreaterThan(600 / 22);
    expect(strikes.length).toBeLessThan(600 / 7 + 1);
    // Fewer in a weaker one.
    expect(run(new Thunderstorm(), 600, 0.8).strikes.length).toBeLessThan(strikes.length);
  });

  it('lands strikes near and far, the nearer brighter, half of them toward where the camera looks', () => {
    const { strikes } = run(new Thunderstorm(new SeededRandom(5)), 3000, 1, 2);
    const distances = strikes.map((strike) => strike.distanceMeters);

    expect(Math.min(...distances)).toBeGreaterThanOrEqual(500);
    expect(Math.max(...distances)).toBeLessThanOrEqual(6000);
    const near = strikes.filter((strike) => strike.distanceMeters < 1500);
    const far = strikes.filter((strike) => strike.distanceMeters > 4500);
    expect(Math.min(...near.map((strike) => strike.brightness))).toBeGreaterThan(Math.max(...far.map((strike) => strike.brightness)));
    const inView = strikes.filter((strike) => Math.abs(strike.bearing - 2) < 0.91).length;
    expect(inView / strikes.length).toBeGreaterThan(0.45);
  });

  it('flashes at once and dies away within a couple of seconds, in a stroke or a few', () => {
    const storm = new Thunderstorm();
    let flashes: number[] = [];
    // To the first strike, then a while on.
    while (storm.update(STEP, 1) === null) {
      expect(storm.flash).toBe(0);
    }
    const first = storm.flash;
    flashes = run(storm, 2.5, 0).flashes;

    expect(first).toBeGreaterThan(0.2);
    expect(Math.max(first, ...flashes)).toBeLessThanOrEqual(1);
    expect(flashes.at(-1)).toBe(0);
    expect(storm.secondsSinceStrike).toBeCloseTo(2.5, 1);
    // Flashing down from the first stroke's peak within a tenth of a second.
    expect(flashes[5]!).toBeLessThan(first);
  });

  it('strikes the same way every time from the same seed', () => {
    const a = run(new Thunderstorm(new SeededRandom(9)), 120, 1).strikes;
    const b = run(new Thunderstorm(new SeededRandom(9)), 120, 1).strikes;

    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });
});
