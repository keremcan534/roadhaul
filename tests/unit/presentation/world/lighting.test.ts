import { Color, MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import {
  flatGroundLight,
  PrelitMaterials,
  relativeGroundLight,
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

  it('keeps a clear day\'s light on flat ground as it is, and dims and tints it with the sun and the sky', () => {
    const white = new Color(1, 1, 1);
    const clear = relativeGroundLight(1, 1, white, new Color());
    expect([clear.r, clear.g, clear.b].map((channel) => channel.toFixed(9))).toEqual(['1.000000000', '1.000000000', '1.000000000']);

    // Without the sun, only the sky's share is left.
    const overcast = relativeGroundLight(0, 1, white, new Color());
    for (const channel of [overcast.r, overcast.g, overcast.b]) {
      expect(channel).toBeGreaterThan(0.2);
      expect(channel).toBeLessThan(0.8);
    }
    const dark = relativeGroundLight(0, 0, white, new Color());
    expect(dark.getHex()).toBe(0x000000);
    // A blue moonlight tint.
    const moonlit = relativeGroundLight(0.1, 0.3, new Color(0.6, 0.7, 1), new Color());
    expect(moonlit.b).toBeGreaterThan(moonlit.r);
  });
});

describe('PrelitMaterials', () => {
  it('relights the pre-lit materials from the colour they were built with, and fades the shadows with the sun', () => {
    const prelit = new PrelitMaterials();
    const ground = prelit.add(new MeshBasicMaterial({ color: 0x808080 }));
    const shadow = prelit.addShadow(new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 }));
    const built = ground.color.r;

    prelit.setLight(new Color(0.5, 0.25, 1), 0.5);
    expect(ground.color.r).toBeCloseTo(built * 0.5, 9);
    expect(ground.color.g).toBeCloseTo(built * 0.25, 9);
    expect(ground.color.b).toBeCloseTo(built, 9);
    expect(shadow.opacity).toBeCloseTo(0.2, 9);

    // From the colour it was built with every time, not from the last one.
    prelit.setLight(new Color(1, 1, 1), 1);
    expect(ground.color.r).toBeCloseTo(built, 9);
    expect(shadow.opacity).toBeCloseTo(0.4, 9);
  });
});
