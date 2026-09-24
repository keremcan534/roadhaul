import { describe, expect, it } from 'vitest';
import {
  brakeNoiseLevel,
  crashLevel,
  createEngineTone,
  engineTone,
  roadNoiseLevel,
} from '../../../../src/presentation/audio/soundModel';

describe('engineTone', () => {
  it('sounds the six cylinders firing: three times a turn', () => {
    const tone = engineTone(createEngineTone(), 1200, 0, 700, 2700);

    expect(tone.frequency).toBeCloseTo(60, 9); // 1,200 rpm = 20 turns a second.
  });

  it('grows louder and brighter with the pedal and the revs', () => {
    const idle = { ...engineTone(createEngineTone(), 700, 0, 700, 2700) };
    const pulling = { ...engineTone(createEngineTone(), 700, 1, 700, 2700) };
    const revving = { ...engineTone(createEngineTone(), 2700, 1, 700, 2700) };

    expect(pulling.gain).toBeGreaterThan(idle.gain);
    expect(pulling.cutoff).toBeGreaterThan(idle.cutoff);
    expect(revving.gain).toBeGreaterThan(pulling.gain);
    expect(revving.cutoff).toBeGreaterThan(pulling.cutoff);
    expect(revving.gain).toBeLessThanOrEqual(1);
  });

  it('keeps to its range whatever it is given, and writes into the object it is given', () => {
    const out = createEngineTone();

    expect(engineTone(out, -50, 3, 700, 700)).toBe(out);
    expect(out.frequency).toBe(0);
    expect(out.gain).toBeLessThanOrEqual(1);
    expect(Number.isFinite(out.cutoff)).toBe(true);
  });
});

describe('noise levels', () => {
  it('hears the road from nothing at a standstill to full at highway speed, either way', () => {
    expect(roadNoiseLevel(0)).toBe(0);
    expect(roadNoiseLevel(10)).toBeGreaterThan(0);
    expect(roadNoiseLevel(-10)).toBe(roadNoiseLevel(10));
    expect(roadNoiseLevel(25)).toBe(1);
    expect(roadNoiseLevel(40)).toBe(1);
  });

  it('hears the brakes only while they slow a rolling truck', () => {
    expect(brakeNoiseLevel(1, 0)).toBe(0);
    expect(brakeNoiseLevel(0, 20)).toBe(0);
    expect(brakeNoiseLevel(1, 5)).toBeCloseTo(0.5, 9);
    expect(brakeNoiseLevel(1, 20)).toBe(1);
  });

  it('makes harder crashes louder, and every crash heard', () => {
    expect(crashLevel(0)).toBeGreaterThan(0);
    expect(crashLevel(6)).toBeGreaterThan(crashLevel(2));
    expect(crashLevel(30)).toBe(1);
  });
});
