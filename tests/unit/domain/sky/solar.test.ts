import { describe, expect, it } from 'vitest';
import {
  dayOfYear,
  moonDeclination,
  moonHourAngle,
  moonIllumination,
  moonPhase,
  skyDirection,
  sunDeclination,
  sunHourAngle,
  type SkyDirection,
} from '../../../../src/domain/sky/solar';

const degrees = (radians: number): number => (radians * 180) / Math.PI;
const radians = (value: number): number => (value * Math.PI) / 180;
const elevation = (direction: SkyDirection): number => degrees(Math.asin(direction.y));
const LATITUDE = radians(39);

describe('solar', () => {
  it('counts the days of the year from 1 January, within a day (the leap years aside), the seasons going round', () => {
    expect(Math.abs(dayOfYear(Date.UTC(2026, 0, 1)))).toBeLessThan(1);
    expect(Math.abs(dayOfYear(Date.UTC(2026, 5, 21)) - 171)).toBeLessThan(1);
    // Round the new year the count starts again, and the sun's path goes on without a jump.
    const newYearsEve = sunDeclination(dayOfYear(Date.UTC(2025, 11, 31, 12)));
    const newYear = sunDeclination(dayOfYear(Date.UTC(2026, 0, 1, 12)));
    expect(Math.abs(degrees(newYear - newYearsEve))).toBeLessThan(0.3);
  });

  it('moves the sun between the tropics through the year, over the equator at the equinoxes', () => {
    expect(degrees(sunDeclination(dayOfYear(Date.UTC(2026, 2, 20))))).toBeCloseTo(0, 0);
    expect(degrees(sunDeclination(dayOfYear(Date.UTC(2026, 5, 21))))).toBeCloseTo(23.44, 0);
    expect(degrees(sunDeclination(dayOfYear(Date.UTC(2026, 11, 21))))).toBeCloseTo(-23.44, 0);
  });

  it('stands the sun highest in the south at noon, rising in the east and setting in the west', () => {
    const out = { x: 0, y: 0, z: 0 };
    const june = sunDeclination(171);
    const noon = skyDirection(june, 0, LATITUDE, out);
    expect(Math.hypot(noon.x, noon.y, noon.z)).toBeCloseTo(1, 12);
    expect(elevation(noon)).toBeCloseTo(90 - 39 + 23.44, 1);
    expect(noon.x).toBeCloseTo(0, 12);
    expect(noon.z).toBeGreaterThan(0); // South is +z.

    const morning = skyDirection(june, sunHourAngle(7 * 60, 12), LATITUDE, { x: 0, y: 0, z: 0 });
    const evening = skyDirection(june, sunHourAngle(17 * 60, 12), LATITUDE, { x: 0, y: 0, z: 0 });
    expect(morning.x).toBeGreaterThan(0.5); // East is +x.
    expect(evening.x).toBeLessThan(-0.5);
    expect(elevation(morning)).toBeCloseTo(elevation(evening), 9);

    // Winter noon: low, 47° under the summer's.
    const december = skyDirection(sunDeclination(354), 0, LATITUDE, { x: 0, y: 0, z: 0 });
    expect(elevation(noon) - elevation(december)).toBeCloseTo(46.9, 0);
    // Midnight: under the horizon.
    expect(elevation(skyDirection(june, Math.PI, LATITUDE, { x: 0, y: 0, z: 0 }))).toBeLessThan(0);
  });

  it('turns the sky 15° an hour', () => {
    expect(degrees(sunHourAngle(13 * 60, 12))).toBeCloseTo(15, 9);
    expect(degrees(sunHourAngle(6 * 60, 12))).toBeCloseTo(-90, 9);
  });

  it('knows the moon\'s phases: new, full, and the share of its face lit', () => {
    // Full moon 2025-12-04 23:14 UTC; new moon 2025-11-20 06:47 UTC.
    expect(moonPhase(Date.UTC(2025, 11, 4, 23, 14))).toBeCloseTo(0.5, 1);
    const newMoon = moonPhase(Date.UTC(2025, 10, 20, 6, 47));
    expect(Math.min(newMoon, 1 - newMoon)).toBeLessThan(0.03);
    expect(moonIllumination(0)).toBeCloseTo(0, 12);
    expect(moonIllumination(0.5)).toBeCloseTo(1, 12);
    expect(moonIllumination(0.25)).toBeCloseTo(0.5, 12);
  });

  it('puts the full moon opposite the sun: rising at sunset, high in the winter night', () => {
    expect(moonHourAngle(0.3, 0.5)).toBeCloseTo(0.3 - Math.PI, 12);
    // In December the full moon rides where the June sun does.
    expect(degrees(moonDeclination(354, 0.5))).toBeCloseTo(23.4, 0);
    expect(degrees(moonDeclination(171, 0.5))).toBeCloseTo(-23.4, 0);
  });
});
