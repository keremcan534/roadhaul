import { Color, MeshBasicMaterial, ShaderLib, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createCabinLight, keyLightInside, lightCabin, shadeCabin } from '../../../../src/presentation/vehicles/cabinShading';

/** The way toward a light `elevation` degrees up, `bearing` degrees round from the truck's nose toward its left, for heading 0 (+z). */
function toward(elevation: number, bearing: number): Vector3 {
  const up = (elevation * Math.PI) / 180;
  const round = (bearing * Math.PI) / 180;
  return new Vector3(Math.cos(up) * Math.sin(round), Math.sin(up), Math.cos(up) * Math.cos(round));
}

describe('cabinShading', () => {
  it('lets the key light in through the windscreen and the side windows, never through the roof or the back wall', () => {
    expect(keyLightInside(toward(20, 0), 0)).toBe(1);
    expect(keyLightInside(toward(20, 180), 0)).toBe(0);
    expect(keyLightInside(toward(89, 0), 0)).toBe(0);
    // Low from either side, through the smaller side windows.
    expect(keyLightInside(toward(15, 90), 0)).toBeCloseTo(0.8, 9);
    expect(keyLightInside(toward(15, -90), 0)).toBeCloseTo(0.8, 9);
    // High over the side, the roof shades it.
    expect(keyLightInside(toward(60, 90), 0)).toBe(0);
    // It turns with the truck: heading a quarter turn left (+x), the light from +x is ahead.
    expect(keyLightInside(new Vector3(1, 0.3, 0).normalize(), Math.PI / 2)).toBe(1);
  });

  it('lights the cab from the scene\'s light, less in the dark, and glows with the lamps', () => {
    const uniforms = createCabinLight();
    const light = {
      keyDirection: toward(30, 0),
      key: new Color(2.6, 2.3, 1.8),
      sky: new Color(0.8, 0.95, 1.15),
      ground: new Color(0.12, 0.1, 0.05),
    };

    lightCabin(uniforms, light, 0, 0);
    const day = { up: uniforms.cabinSky.value.clone(), down: uniforms.cabinGround.value.clone(), glow: uniforms.cabinGlow.value.r };
    // Up-facing faces take more than down-facing ones; the sky's blue half-way to grey.
    expect(day.up.g).toBeGreaterThan(day.down.g);
    expect(day.up.b / day.up.r).toBeLessThan(light.sky.b / light.sky.r);
    expect(uniforms.cabinKey.value.r).toBeCloseTo(light.key.r / Math.PI, 9);
    expect(uniforms.cabinKeyDirection.value.toArray()).toEqual(light.keyDirection.toArray());
    expect(uniforms.cabinFill.value.r).toBe(0);

    lightCabin(uniforms, light, 0, 1);
    expect(uniforms.cabinSky.value.g).toBeLessThan(day.up.g / 2);
    expect(uniforms.cabinGround.value.g).toBeLessThan(day.down.g / 2);
    expect(uniforms.cabinGlow.value.r).toBeGreaterThan(day.glow * 2);
    expect(uniforms.cabinFill.value.r).toBeGreaterThan(0);
  });

  it('shades an unlit material with the cabin light: the atlas\'s alpha glows, and its program stays apart', () => {
    const material = new MeshBasicMaterial({ vertexColors: true });
    const uniforms = createCabinLight();
    shadeCabin(material, uniforms);
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: ShaderLib.basic.vertexShader,
      fragmentShader: ShaderLib.basic.fragmentShader,
    };

    material.onBeforeCompile(shader as never, undefined as never);

    expect(shader.uniforms['cabinGlow']).toBe(uniforms.cabinGlow);
    expect(shader.vertexShader).toContain('vCabinLight');
    expect(shader.fragmentShader).toContain('cabinGlowMask');
    expect(shader.fragmentShader).not.toContain('#include <map_fragment>');
    expect(material.customProgramCacheKey()).toBe('cabin-shading');
  });
});
