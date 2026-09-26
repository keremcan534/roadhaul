import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import {
  BLOOM_LEVELS,
  bloomLevelSizes,
  COMPOSITE_FRAGMENT,
  createColorGrade,
  FXAA_FRAGMENT,
  multisampling,
  SHAFT_LIGHT_FRAGMENT,
  SHAFT_ROUND_FRAGMENT,
  SHAFTS_FRAGMENT,
  shaftsShow,
  sunOnPicture,
} from '../../../src/presentation/PostProcessing';

describe('PostProcessing', () => {
  it('blooms down a chain of halving targets, from half the picture, never under a pixel', () => {
    expect(bloomLevelSizes(1200, 540)).toEqual([
      [600, 270],
      [300, 135],
      [150, 68],
      [75, 34],
      [38, 17],
    ]);
    expect(bloomLevelSizes(1200, 540)).toHaveLength(BLOOM_LEVELS);
    expect(bloomLevelSizes(3, 1, 4)).toEqual([
      [2, 1],
      [1, 1],
      [1, 1],
      [1, 1],
    ]);
  });

  it('multisamples as asked, or as much as the GPU can for a half-float target, or not at all', () => {
    expect(multisampling(4, Int32Array.of(8, 4, 2))).toBe(4);
    expect(multisampling(4, Int32Array.of(2))).toBe(2);
    expect(multisampling(8, [4, 2])).toBe(4);
    expect(multisampling(4, [])).toBe(0);
    expect(multisampling(1, [4, 2])).toBe(0);
  });

  it('starts from a picture as drawn: the day exposure, no colour change, a light vignette', () => {
    expect(createColorGrade()).toEqual({ exposure: 1.05, saturation: 1, contrast: 1, warmth: 0, bloom: 0.25, vignette: 0.3 });
    // A fresh object each time: the owner changes it in place.
    expect(createColorGrade()).not.toBe(createColorGrade());
  });

  it("smooths edges with three.js's FXAA, blending lone pixels (stars) at half its strength", () => {
    expect(FXAA_FRAGMENT).toContain('float _SubpixelBlending = 0.5;');
    expect(FXAA_FRAGMENT).not.toContain('float _SubpixelBlending = 1.0;');
  });

  it('glares round the sun where the bloom says it shows, and lays the lens\'s ghosts across the picture from it', () => {
    // Only with bloom: its most blurred level tells how much bright light is round the sun.
    const glare = COMPOSITE_FRAGMENT.slice(COMPOSITE_FRAGMENT.indexOf('#ifdef BLOOM'), COMPOSITE_FRAGMENT.indexOf('#endif'));
    expect(glare).toContain('vec3 sunGlare(vec2 uv)');
    expect(glare).toContain('texture2D(tGlare, clamp(sunScreen, 0.0, 1.0))');
    expect(glare.match(/ghost\(uv, sunScreen \+ across \*/g)).toHaveLength(4);
    // Added in linear light, before the tone curve.
    const main = COMPOSITE_FRAGMENT.slice(COMPOSITE_FRAGMENT.indexOf('void main()'));
    expect(main.indexOf('color += sunGlare(vUv);')).toBeLessThan(main.indexOf('acesFilmic('));
  });
});

describe('the sun\'s shafts', () => {
  it('come from the light brighter than the sky\'s shade, the sun\'s disc capped, at a quarter of the size', () => {
    // Four smooth taps: the sixteen pixels under one of a quarter-size picture.
    expect(SHAFT_LIGHT_FRAGMENT.match(/texture2D\(tSource, vUv \+ texel \* vec2\(/g)).toHaveLength(4);
    expect(SHAFT_LIGHT_FRAGMENT).toContain('min(color * 0.25, vec3(8.0))');
    expect(SHAFT_LIGHT_FRAGMENT).toMatch(/max\(luma - [\d.]+, 0\.0\)/);
  });

  it("streak it out from the sun, less what shines round it every way: a gap's light and a trunk's shadow, not a veil", () => {
    // Every spot samples from the sun out toward it, so a whole line gets the same: straight shafts.
    expect(SHAFTS_FRAGMENT).toContain('vec2 uv = sunScreen + stride * k;');
    expect(SHAFTS_FRAGMENT).toMatch(/max\(sum \/ weights - [\d.]+ \* texture2D\(tRound, vec2\(0\.5\)\)\.rgb, 0\.0\)/);
    // What shines round the sun every way: sixteen ways out, weighed as the shafts weigh their steps.
    expect(SHAFT_ROUND_FRAGMENT).toContain('for (int a = 0; a < 16; a++)');
    const focus = (shader: string) => /exp\(-[\w *]+\* ([\d.]+)\)/.exec(shader)?.[1];
    expect(focus(SHAFT_ROUND_FRAGMENT)).toBeDefined();
    expect(focus(SHAFT_ROUND_FRAGMENT)).toBe(focus(SHAFTS_FRAGMENT));
    // Added in linear light, before the tone curve, and only while they show.
    const main = COMPOSITE_FRAGMENT.slice(COMPOSITE_FRAGMENT.indexOf('void main()'));
    expect(main).toContain('if (shafts > 0.0)');
    expect(main.indexOf('texture2D(tShafts, vUv).rgb * shafts')).toBeLessThan(main.indexOf('acesFilmic('));
  });

  it('show while the sun is on the picture, fading as it leaves it', () => {
    expect(shaftsShow(0.5, 0.5)).toBe(1);
    expect(shaftsShow(0, 1)).toBe(1);
    expect(shaftsShow(1.1, 0.5)).toBeGreaterThan(0);
    expect(shaftsShow(1.1, 0.5)).toBeLessThan(1);
    expect(shaftsShow(0.5, -0.1)).toBeCloseTo(shaftsShow(1.1, 0.5), 9);
    expect(shaftsShow(-0.3, 0.5)).toBe(0);
    expect(shaftsShow(0.5, 1.4)).toBe(0);
  });
});

describe('sunOnPicture', () => {
  const camera = new PerspectiveCamera(60, 2, 0.5, 1000);
  camera.position.set(10, 2, 30);
  camera.lookAt(10, 2, 0);
  camera.updateMatrixWorld();
  const out = new Vector3();

  it('finds the sun ahead on the picture, 0..1 across and up', () => {
    expect(sunOnPicture(camera, { x: 0, y: 0, z: -1 }, out)).toBe(true);
    expect(out.x).toBeCloseTo(0.5, 9);
    expect(out.y).toBeCloseTo(0.5, 9);

    const upRight = new Vector3(0.2, 0.15, -1).normalize();
    expect(sunOnPicture(camera, upRight, out)).toBe(true);
    expect(out.x).toBeGreaterThan(0.5);
    expect(out.y).toBeGreaterThan(0.5);
    expect(out.x).toBeLessThan(1);
  });

  it('puts a sun well to the side off the picture, and none behind the camera', () => {
    expect(sunOnPicture(camera, new Vector3(3, 0.2, -1).normalize(), out)).toBe(true);
    expect(out.x).toBeGreaterThan(1);
    expect(sunOnPicture(camera, { x: 0, y: 0.3, z: 0.95 }, out)).toBe(false);
    expect(sunOnPicture(camera, { x: 1, y: 0, z: 0 }, out)).toBe(false);
  });
});
