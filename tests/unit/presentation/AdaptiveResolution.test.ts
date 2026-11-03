import { describe, expect, it } from 'vitest';
import { AdaptiveResolution } from '../../../src/presentation/AdaptiveResolution';

/**
 * Runs `seconds` of frames at `fps`, `work` of each the main thread's own (a share); returns how many times the
 * scale changed.
 */
function run(resolution: AdaptiveResolution, fps: number, seconds: number, work = 0): number {
  let changes = 0;
  for (let t = 0; t < seconds; t += 1 / fps) {
    if (resolution.frame(1 / fps, work / fps)) changes++;
  }
  return changes;
}

describe('AdaptiveResolution', () => {
  it('keeps the full resolution while frames come as fast as the screen shows them, or the player caps them', () => {
    const resolution = new AdaptiveResolution(0.6);
    run(resolution, 60, 30);
    expect(resolution.scale).toBe(1);
    expect(resolution.targetFps).toBe(60);

    // Capped at 30 a second, 30 is all it aims for.
    const capped = new AdaptiveResolution(0.6);
    capped.setFrameCap(30);
    run(capped, 60, 2);
    run(capped, 30, 30);
    expect(capped.targetFps).toBe(30);
    expect(capped.scale).toBe(1);
  });

  it('aims for the screen\'s rate: on a 120 Hz screen frames at 80 a second are slow, and under a cap of 60 they are not', () => {
    const resolution = new AdaptiveResolution(0.6);
    run(resolution, 120, 3);
    expect(resolution.targetFps).toBe(120);
    run(resolution, 80, 4);
    expect(resolution.scale).toBeLessThan(1);

    const capped = new AdaptiveResolution(0.6);
    capped.setFrameCap(60);
    run(capped, 120, 3);
    run(capped, 58, 30);
    expect(capped.targetFps).toBe(60);
    expect(capped.scale).toBe(1);
  });

  it('takes no frame that came early for a quicker screen: only frames that quick in a row', () => {
    const resolution = new AdaptiveResolution(0.6);
    // A 60 Hz screen whose frames' timestamps jitter: now and then one comes 5 ms early, the next 5 ms late.
    for (let i = 0; i < 600; i++) {
      const jitter = i % 7 === 3 ? -0.005 : i % 7 === 4 ? 0.005 : 0;
      resolution.frame(1 / 60 + jitter);
    }
    expect(resolution.targetFps).toBe(60);
    expect(resolution.scale).toBe(1);
    // Two quick frames in a row are not enough either; three are.
    resolution.frame(1 / 120);
    resolution.frame(1 / 120);
    resolution.frame(1 / 60);
    expect(resolution.targetFps).toBe(60);
    run(resolution, 120, 0.05);
    expect(resolution.targetFps).toBe(120);
  });

  it('aims at half the screen\'s rate when even its fewest pixels cannot keep up with it, and draws more again', () => {
    const resolution = new AdaptiveResolution(0.6);
    run(resolution, 120, 3);
    // A GPU that draws 70 frames a second whatever the resolution: down to the floor, then 60 aimed at.
    run(resolution, 70, 30);
    expect(resolution.targetFps).toBe(60);
    run(resolution, 70, 60);
    expect(resolution.scale).toBe(1);
    expect(resolution.targetFps).toBe(60);

    // Frames the CPU holds back keep the pixels and the target.
    const cpuBound = new AdaptiveResolution(0.6);
    run(cpuBound, 120, 3, 0.9);
    run(cpuBound, 70, 60, 0.9);
    expect(cpuBound.targetFps).toBe(120);
    expect(cpuBound.scale).toBe(1);

    // A 60 Hz screen's out of reach: 30, as the old floor had it.
    const slow = new AdaptiveResolution(0.6);
    run(slow, 20, 30);
    expect(slow.targetFps).toBe(30);
  });

  it('sees the screen\'s rate afresh after a restart: it may have changed while the game was away', () => {
    const resolution = new AdaptiveResolution(0.6);
    run(resolution, 120, 3);
    expect(resolution.targetFps).toBe(120);
    resolution.restart();
    run(resolution, 60, 3);
    expect(resolution.targetFps).toBe(60);
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

  it("keeps its pixels when the main thread's own work makes the frames slow: fewer would only blur the picture", () => {
    const resolution = new AdaptiveResolution(0.6);

    expect(run(resolution, 20, 30, 0.9)).toBe(0);
    expect(resolution.scale).toBe(1);
    // The GPU short of time while the CPU waits: fewer pixels.
    run(resolution, 20, 4, 0.4);
    expect(resolution.scale).toBeLessThan(1);
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
