import { describe, expect, it } from 'vitest';
import {
  BLOOM_LEVELS,
  bloomLevelSizes,
  createColorGrade,
  FXAA_FRAGMENT,
  multisampling,
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
});
