import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import { localDay } from '../../../../src/domain/rewards/dailyReward';
import {
  createEclipseState,
  discOverlap,
  eclipseAt,
  eclipseCentredAt,
  eclipseDaylight,
  eclipseMoonlight,
  eclipseOnDay,
  eclipseSky,
  type EclipseKind,
} from '../../../../src/domain/sky/eclipses';
import { createSkyLook } from '../../../../src/domain/sky/skyLook';
import {
  dayOfYear,
  moonDeclination,
  moonHourAngle,
  moonPhase,
  skyDirection,
  sunDeclination,
  sunHourAngle,
  type SkyDirection,
} from '../../../../src/domain/sky/solar';

const CONFIG = DEFAULT_GAME_CONFIG.skyWonders.eclipses;
const SKY = DEFAULT_GAME_CONFIG.timeOfDay;
const LATITUDE = (SKY.latitudeDegrees * Math.PI) / 180;
const DAY_MS = 86_400_000;
const FIRST_DAY = localDay(Date.UTC(2026, 0, 1), 0);

/** Toward the sun on the day of `dayMs` at `minutes` of the game's clock. */
function sunDirection(dayMs: number, minutes: number): SkyDirection {
  const day = dayOfYear(dayMs);
  return skyDirection(sunDeclination(day), sunHourAngle(minutes, SKY.solarNoonHours), LATITUDE, { x: 0, y: 0, z: 0 });
}

/** Toward a full moon then. */
function fullMoonDirection(dayMs: number, minutes: number): SkyDirection {
  const day = dayOfYear(dayMs);
  const hour = moonHourAngle(sunHourAngle(minutes, SKY.solarNoonHours), 0.5);
  return skyDirection(moonDeclination(day, 0.5), hour, LATITUDE, { x: 0, y: 0, z: 0 });
}

function elevation(direction: SkyDirection): number {
  return (Math.asin(direction.y) * 180) / Math.PI;
}

/** The eclipse `kind` at the minute `minutes` of the game's clock, its middle at `centre`. */
function at(kind: EclipseKind, centre: number, minutes: number) {
  return { ...eclipseAt(kind, centre, minutes, CONFIG, createEclipseState()) };
}

describe('eclipseOnDay', () => {
  it("brings the sun's on new-moon days and the moon's on full-moon days, about as often as the chances say", () => {
    const always = { ...CONFIG, solarChance: 1, lunarChance: 1 };
    const counts = { newMoons: 0, fullMoons: 0, solar: 0, lunar: 0 };
    for (let day = FIRST_DAY; day < FIRST_DAY + 3650; day++) {
      const midday = moonPhase(day * DAY_MS + DAY_MS / 2);
      const possible = eclipseOnDay(day, 0, always, SKY);
      const drawn = eclipseOnDay(day, 0, CONFIG, SKY);
      if (possible?.kind === 'solar') {
        counts.newMoons++;
        expect(Math.min(midday, 1 - midday)).toBeLessThan(0.02);
      } else if (possible?.kind === 'lunar') {
        counts.fullMoons++;
        expect(Math.abs(midday - 0.5)).toBeLessThan(0.02);
      }
      if (drawn !== null) {
        // Drawn from the possible ones, the same middle.
        expect(drawn).toEqual(possible);
        counts[drawn.kind]++;
      }
    }
    // Every new moon and every full moon has its day: some 124 of each in ten years.
    expect(counts.newMoons).toBeGreaterThanOrEqual(123);
    expect(counts.fullMoons).toBeGreaterThanOrEqual(123);
    expect(counts.solar / counts.newMoons).toBeGreaterThan(0.35);
    expect(counts.solar / counts.newMoons).toBeLessThan(0.65);
    expect(counts.lunar / counts.fullMoons).toBeGreaterThan(0.35);
    expect(counts.lunar / counts.fullMoons).toBeLessThan(0.65);
  });

  it('times them for a low sun or moon, morning or evening, where a driver sees it ahead: up all through the sun\'s, at night for the moon\'s', () => {
    const sides = { solar: new Set<string>(), lunar: new Set<string>() };
    const half = CONFIG.solarPartialMinutes + CONFIG.solarTotalMinutes / 2;
    for (let day = FIRST_DAY; day < FIRST_DAY + 3650; day++) {
      const eclipse = eclipseOnDay(day, 0, CONFIG, SKY);
      if (eclipse === null) {
        continue;
      }
      expect(eclipse.centreMinutes % 5).toBe(0);
      const total = eclipse.kind === 'solar' ? CONFIG.solarTotalMinutes : CONFIG.lunarTotalMinutes;
      expect((eclipse.centreMinutes - eclipse.totalityMinutes + 1440) % 1440).toBe(total / 2);
      const dayMs = day * DAY_MS + DAY_MS / 2;
      const sunAt = (minutes: number) => elevation(sunDirection(dayMs, minutes));
      if (eclipse.kind === 'solar') {
        expect(sunAt(eclipse.centreMinutes)).toBeGreaterThan(9);
        expect(sunAt(eclipse.centreMinutes)).toBeLessThan(17);
        expect(sunAt(eclipse.centreMinutes - half)).toBeGreaterThan(-2);
        expect(sunAt(eclipse.centreMinutes + half)).toBeGreaterThan(-2);
        sides.solar.add(eclipse.centreMinutes < SKY.solarNoonHours * 60 ? 'morning' : 'evening');
      } else {
        const moon = elevation(fullMoonDirection(dayMs, eclipse.centreMinutes));
        expect(moon).toBeGreaterThan(11);
        expect(moon).toBeLessThan(18);
        // The night's: the sun well down.
        expect(sunAt(eclipse.centreMinutes)).toBeLessThan(-9);
        sides.lunar.add(eclipse.centreMinutes > 12 * 60 ? 'evening' : 'morning');
      }
    }
    expect([...sides.solar].sort()).toEqual(['evening', 'morning']);
    expect([...sides.lunar].sort()).toEqual(['evening', 'morning']);
  });

  it("follows the phone's time zone: a new moon's day is the local one", () => {
    const always = { ...CONFIG, solarChance: 1, lunarChance: 1 };
    // The model's new moon of 9 November 2026 comes at 21:58 UTC: the 10th's an hour and more east of UTC.
    const utc = localDay(Date.UTC(2026, 10, 9, 12), 0);
    expect(eclipseOnDay(utc, 0, always, SKY)?.kind).toBe('solar');
    expect(eclipseOnDay(utc + 1, 0, always, SKY)).toBeNull();
    expect(eclipseOnDay(utc, 180, always, SKY)).toBeNull();
    expect(eclipseOnDay(utc + 1, 180, always, SKY)?.kind).toBe('solar');
  });

  it('puts one for a look at the hour asked, rounded', () => {
    expect(eclipseCentredAt('solar', 1021, CONFIG)).toEqual({ kind: 'solar', centreMinutes: 1020, totalityMinutes: 1014 });
    expect(eclipseCentredAt('lunar', 10, CONFIG)).toEqual({ kind: 'lunar', centreMinutes: 10, totalityMinutes: 1430 });
  });
});

describe('eclipseAt', () => {
  it('slides the moon over the sun: from its first touch to totality, across, and away', () => {
    const half = CONFIG.solarPartialMinutes + CONFIG.solarTotalMinutes / 2;
    expect(at('solar', 770, 770 - half - 1).kind).toBeNull();
    expect(at('solar', 770, 770 + half + 1).kind).toBeNull();
    const start = at('solar', 770, 770 - half + 0.5);
    expect(start.kind).toBe('solar');
    expect(start.offset).toBeLessThan(-1.9);
    expect(start.cover).toBeLessThan(0.01);
    let last = -1;
    for (let minutes = 770 - half + 1; minutes <= 770 - CONFIG.solarTotalMinutes / 2; minutes += 1) {
      const now = at('solar', 770, minutes);
      expect(now.cover).toBeGreaterThan(last);
      last = now.cover;
    }
    expect(at('solar', 770, 764)).toMatchObject({ cover: 1, totality: 1 });
    expect(at('solar', 770, 770)).toMatchObject({ offset: 0, cover: 1, totality: 1 });
    // Just before totality the last of the sun shows: not yet total.
    expect(at('solar', 770, 762).totality).toBeLessThan(1);
    // The same on the way out, the moon on the other side.
    const before = at('solar', 770, 740);
    const after = at('solar', 770, 800);
    expect(after.cover).toBeCloseTo(before.cover, 9);
    expect(after.offset).toBeCloseTo(-before.offset, 9);
    expect(before.penumbra).toBe(0);
  });

  it("dims the moon in the earth's half shadow first, then takes it into the full shadow round midnight", () => {
    // Its middle at 00:50: 23:30 is 80 minutes before, in the half shadow only.
    const halfShadow = at('lunar', 50, 1410);
    expect(halfShadow.kind).toBe('lunar');
    expect(halfShadow.cover).toBe(0);
    expect(halfShadow.penumbra).toBeGreaterThan(0);
    // The moon is drawn to stand exactly full from the first touch of the half shadow, before the full shadow's.
    expect(at('lunar', 50, 1311).fullMoon).toBeLessThan(0.05);
    expect(halfShadow.fullMoon).toBeGreaterThan(0.3);
    expect(at('lunar', 50, 1440 - 21).fullMoon).toBe(1);
    expect(at('solar', 770, 770).fullMoon).toBe(0);
    expect(at('lunar', 50, 1300).kind).toBeNull();
    const partial = at('lunar', 50, 0);
    expect(partial.cover).toBeGreaterThan(0.2);
    expect(partial.cover).toBeLessThan(1);
    expect(at('lunar', 50, 50)).toMatchObject({ cover: 1, penumbra: 1, totality: 1 });
    expect(at('lunar', 50, 35).totality).toBe(1);
  });

  it('shares the area of overlapping discs', () => {
    expect(discOverlap(0, 1, 2)).toBeCloseTo(Math.PI, 9);
    expect(discOverlap(3.1, 1, 2)).toBe(0);
    expect(discOverlap(1, 1, 1)).toBeCloseTo((2 * Math.PI) / 3 - Math.sqrt(3) / 2, 9);
  });
});

describe('the sky in an eclipse', () => {
  it('darkens the day only once most of the sun is hidden, to a deep twilight with the lamps lit and the stars out', () => {
    const clear = createSkyLook();
    clear.cloudCover = 0.2;
    expect(eclipseSky({ ...clear }, createEclipseState())).toEqual(clear);
    expect(eclipseSky({ ...clear }, at('solar', 770, 730))).toMatchObject({ sunlight: clear.sunlight, lamps: 0, stars: 0 });
    expect(eclipseDaylight(0.4)).toBe(1);
    expect(eclipseDaylight(0.9)).toBeLessThan(0.2);

    const total = eclipseSky({ ...clear }, at('solar', 770, 770));
    expect(total.sunlight).toBeLessThan(0.02 * clear.sunlight);
    expect(total.skylight).toBeLessThan(0.25 * clear.skylight);
    expect(total.lamps).toBeGreaterThan(0.85);
    expect(total.stars).toBeGreaterThan(0.6);
    expect(total.zenithColor & 0xff).toBeLessThan(clear.zenithColor & 0xff);
    // Under cloud no stars come out, though it darkens all the same.
    const overcast = eclipseSky({ ...clear, cloudCover: 1 }, at('solar', 770, 770));
    expect(overcast.stars).toBe(0);
    expect(overcast.sunlight).toBeLessThan(0.02);
  });

  it("takes the moon's light in the earth's shadow, a little in the half shadow, most of it at totality", () => {
    expect(eclipseMoonlight(createEclipseState())).toBe(1);
    expect(eclipseMoonlight(at('solar', 770, 770))).toBe(1);
    const halfShadow = eclipseMoonlight(at('lunar', 50, 1410));
    expect(halfShadow).toBeLessThan(1);
    expect(halfShadow).toBeGreaterThan(0.75);
    expect(eclipseMoonlight(at('lunar', 50, 50))).toBeCloseTo(0.05, 9);
  });
});
