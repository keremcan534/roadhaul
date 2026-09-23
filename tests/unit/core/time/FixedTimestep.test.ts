import { describe, expect, it } from 'vitest';
import { FixedTimestep } from '../../../../src/core/time/FixedTimestep';

const STEP = 1 / 60;

describe('FixedTimestep', () => {
  it('runs one step for a frame exactly one step long', () => {
    const timestep = new FixedTimestep(STEP, 5);

    expect(timestep.advance(STEP)).toBe(1);
    expect(timestep.alpha).toBeCloseTo(0, 9);
  });

  it('carries partial frames over to the next frame', () => {
    const timestep = new FixedTimestep(STEP, 5);

    expect(timestep.advance(STEP / 2)).toBe(0);
    expect(timestep.alpha).toBeCloseTo(0.5, 9);
    expect(timestep.advance(STEP / 2)).toBe(1);
    expect(timestep.alpha).toBeCloseTo(0, 9);
  });

  it('runs several steps for a long frame and keeps the remainder', () => {
    const timestep = new FixedTimestep(STEP, 5);

    expect(timestep.advance(STEP * 2.5)).toBe(2);
    expect(timestep.alpha).toBeCloseTo(0.5, 9);
  });

  it.each([
    ['30 Hz', 30],
    ['60 Hz', 60],
    ['90 Hz', 90],
    ['120 Hz', 120],
    ['144 Hz', 144],
  ])('simulates exactly one second over one second of %s frames', (_label, framesPerSecond) => {
    const timestep = new FixedTimestep(STEP, 5);
    let steps = 0;
    for (let frame = 0; frame < framesPerSecond; frame++) {
      steps += timestep.advance(1 / framesPerSecond);
    }
    expect(steps).toBe(60);
  });

  it('caps the steps per frame and drops the backlog', () => {
    const timestep = new FixedTimestep(STEP, 5);

    expect(timestep.advance(STEP * 12.25)).toBe(5);
    expect(timestep.alpha).toBeCloseTo(0.25, 6);
    expect(timestep.advance(0)).toBe(0);
  });

  it('ignores negative and NaN frame times', () => {
    const timestep = new FixedTimestep(STEP, 5);

    expect(timestep.advance(-1)).toBe(0);
    expect(timestep.advance(Number.NaN)).toBe(0);
    expect(timestep.alpha).toBe(0);
  });

  it('forgets accumulated time on reset', () => {
    const timestep = new FixedTimestep(STEP, 5);
    timestep.advance(STEP * 0.9);

    timestep.reset();

    expect(timestep.alpha).toBe(0);
    expect(timestep.advance(STEP * 0.5)).toBe(0);
  });

  it.each([
    [0, 5],
    [-STEP, 5],
    [Number.NaN, 5],
    [STEP, 0],
    [STEP, 2.5],
  ])('rejects stepSeconds=%s, maxStepsPerFrame=%s', (stepSeconds, maxStepsPerFrame) => {
    expect(() => new FixedTimestep(stepSeconds, maxStepsPerFrame)).toThrow(RangeError);
  });
});
