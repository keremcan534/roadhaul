import { describe, expect, it } from 'vitest';
import { PUDDLE_GLSL, PUDDLES_FROM, puddleDepth } from '../../../../src/presentation/world/puddles';
import { puddleImage } from '../../../../src/presentation/textures/proceduralImages';

/** The share of the puddle map under water on a road `wetness` wet. */
function underWater(wetness: number): number {
  const image = puddleImage();
  let wet = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    wet += puddleDepth(image.data[i]! / 255, wetness) > 0.5 ? 1 : 0;
  }
  return wet / (image.data.length / 4);
}

describe('puddles', () => {
  it('fill the road\'s dips as it gets wetter, none on a damp road, about a sixth of it soaked', () => {
    expect(underWater(PUDDLES_FROM)).toBe(0);
    expect(underWater(0.3)).toBe(0);
    const half = underWater(0.7);
    const soaked = underWater(1);
    expect(half).toBeGreaterThan(0);
    expect(soaked).toBeGreaterThan(half * 1.5);
    expect(soaked).toBeGreaterThan(0.08);
    expect(soaked).toBeLessThan(0.3);
  });

  it('deepen from their edge in, and the shader finds them the same way', () => {
    expect(puddleDepth(1, 1)).toBe(1);
    expect(puddleDepth(0.2, 1)).toBe(0);
    expect(puddleDepth(0.72, 1)).toBeGreaterThan(0);
    expect(puddleDepth(0.72, 1)).toBeLessThan(1);
    expect(PUDDLE_GLSL).toContain('float puddleAt( vec2 ground )');
    expect(PUDDLE_GLSL).toContain('uniform float puddleWetness;');
  });
});
