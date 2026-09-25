import { describe, expect, it } from 'vitest';
import { Validator } from '../../../../src/core/validation/Validator';
import { DAYLIGHT } from '../../../../src/data/content/daylight';
import { WEATHER } from '../../../../src/data/content/weather';
import { validateDaylightDefinition, type DaylightDefinition } from '../../../../src/data/definitions/DaylightDefinition';
import { daylightFixtures } from '../../../support/contentFixtures';

function issues(daylight: DaylightDefinition): string[] {
  const validator = new Validator();
  validateDaylightDefinition(daylight, 'daylight', validator);
  return validator.issues.map((issue) => issue.path);
}

const byId = (id: string): DaylightDefinition => DAYLIGHT.find((daylight) => daylight.id === id)!;
const clear = WEATHER.find((weather) => weather.id === 'clear')!.look;

describe('validateDaylightDefinition', () => {
  it('accepts the built-in times of day and the test fixtures', () => {
    for (const daylight of [...DAYLIGHT, ...daylightFixtures()]) {
      expect(issues(daylight), daylight.id).toEqual([]);
    }
  });

  it('ships dawn, dusk and the night of spec §39: the twilights with the sun just up, the night past the twilight', () => {
    expect(DAYLIGHT.map((daylight) => daylight.id)).toEqual(['dawn', 'dusk', 'night']);
    for (const id of ['dawn', 'dusk']) {
      expect(byId(id).sunElevationDegrees).toBeGreaterThan(0);
      expect(byId(id).sunElevationDegrees).toBeLessThan(8);
      // Warm and glowing, the lamps coming on, the first stars out; the moon only at night.
      expect(byId(id).look.warmth).toBeGreaterThan(0.2);
      expect(byId(id).look.lamps).toBeGreaterThan(0);
      expect(byId(id).look.stars).toBeGreaterThan(0);
      expect(byId(id).look.stars).toBeLessThan(0.3);
      expect(byId(id).look.moon).toBe(0);
    }
    const night = byId('night');
    expect(night.sunElevationDegrees).toBeLessThan(-6);
    expect(night.look.lamps).toBe(1);
    expect(night.look.stars).toBe(1);
    expect(night.look.moon).toBe(1);
    expect(night.trafficSpeedFactor).toBeLessThan(1);
    // Dark, but the road still shows beyond the headlights; cool and glowing.
    expect(night.look.sunlight + night.look.skylight).toBeLessThan(0.5);
    expect(night.look.skylight).toBeGreaterThan(0.2);
    expect(night.look.warmth).toBeLessThan(0);
    expect(night.look.bloom).toBeGreaterThan(clear.bloom);
  });

  it('reports ids, elevations, traffic and looks out of range', () => {
    const [dawn] = daylightFixtures();
    expect(
      issues({
        ...dawn!,
        id: 'midday' as DaylightDefinition['id'],
        sunElevationDegrees: 45,
        trafficSpeedFactor: 1.2,
        look: { ...dawn!.look, lamps: 2 },
      }),
    ).toEqual(['daylight.id', 'daylight.sunElevationDegrees', 'daylight.trafficSpeedFactor', 'daylight.look.lamps']);
  });
});
