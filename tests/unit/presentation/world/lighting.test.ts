import { Color } from 'three';
import { describe, expect, it } from 'vitest';
import {
  flatGroundLight,
  SHADOW_OFFSET_PER_METER,
  SKY_LIGHT_COLOR,
  SKY_LIGHT_INTENSITY,
  SUN_COLOR,
  SUN_DIRECTION,
  SUN_INTENSITY,
} from '../../../../src/presentation/world/lighting';

describe('lighting', () => {
  it('points at a sun above the horizon', () => {
    expect(Math.hypot(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z)).toBeCloseTo(1, 12);
    expect(SUN_DIRECTION.y).toBeGreaterThan(0.3);
  });

  it('casts shadows away from the sun', () => {
    expect(Math.sign(SHADOW_OFFSET_PER_METER.x)).toBe(-Math.sign(SUN_DIRECTION.x));
    expect(Math.sign(SHADOW_OFFSET_PER_METER.z)).toBe(-Math.sign(SUN_DIRECTION.z));
  });

  it("pre-lights flat ground the way three.js's Lambert shading lights an upward surface", () => {
    // Lambert: (hemisphere sky irradiance at full weight + sun irradiance × cos θ) × albedo / π.
    const expected = new Color(SKY_LIGHT_COLOR)
      .multiplyScalar(SKY_LIGHT_INTENSITY)
      .add(new Color(SUN_COLOR).multiplyScalar(SUN_INTENSITY * SUN_DIRECTION.y))
      .multiplyScalar(1 / Math.PI);
    const light = flatGroundLight();

    expect(light.r).toBeCloseTo(expected.r, 12);
    expect(light.g).toBeCloseTo(expected.g, 12);
    expect(light.b).toBeCloseTo(expected.b, 12);
    // Bright daylight, slightly warm: never darker than half, never blown out.
    for (const channel of [light.r, light.g, light.b]) {
      expect(channel).toBeGreaterThan(0.5);
      expect(channel).toBeLessThan(1.2);
    }
    expect(light.r).toBeGreaterThan(light.b);
  });
});
