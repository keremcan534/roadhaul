import { describe, expect, it } from 'vitest';
import { AdaptiveResolution } from '../../../src/presentation/AdaptiveResolution';

/** Runs `seconds` of frames at `fps`; returns how many times the scale changed. */
function run(resolution: AdaptiveResolution, fps: number, seconds: number): number {
  let changes = 0;
  for (let t = 0; t < seconds; t += 1 / fps) {
    if (resolution.frame(1 / fps)) changes++;
  }
  return changes;
}

describe('AdaptiveResolution', () => {
  it('keeps the full resolution while frames come quickly enough', () => {
    const resolution = new AdaptiveResolution(0.6);

    run(resolution, 60, 30);
    run(resolution, 30, 30);

    expect(resolution.scale).toBe(1);
  });

  it('draws fewer pixels when frames are slow, down to its floor', () => {
    const resolution = new AdaptiveResolution(0.6);

    run(resolution, 20, 2.1); // The first window is not measured.
    expect(resolution.scale).toBe(1);
    run(resolution, 20, 2);
    expect(resolution.scale).toBeCloseTo(0.85, 6);
    run(resolution, 20, 60);
    expect(resolution.scale).toBe(0.6);
  });

  it('draws more again only after frames have been quick for a good while', () => {
    const resolution = new AdaptiveResolution(0.6);
    run(resolution, 20, 8);
    const lowered = resolution.scale;

    run(resolution, 60, 4); // Two quick windows: not yet.
    expect(resolution.scale).toBe(lowered);
    run(resolution, 60, 2.2);
    expect(resolution.scale).toBeCloseTo(lowered * 1.1, 6);
    run(resolution, 60, 120);
    expect(resolution.scale).toBe(1);
  });

  it('pays no attention to hitches, and measures afresh after a restart', () => {
    const resolution = new AdaptiveResolution(0.6);
    run(resolution, 60, 4);
    for (let i = 0; i < 20; i++) resolution.frame(0.25); // Tab switches, loading.
    expect(resolution.scale).toBe(1);

    resolution.restart();
    run(resolution, 20, 2.1);
    expect(resolution.scale).toBe(1);
  });
});
