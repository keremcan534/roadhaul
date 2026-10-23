import { describe, expect, it } from 'vitest';
import {
  brakeNoiseLevel,
  crashLevel,
  createEngineLoopMix,
  createEngineTone,
  createThunderSound,
  engineLoopMix,
  engineTone,
  roadNoiseLevel,
  thunderSound,
} from '../../../../src/presentation/audio/soundModel';

describe('engineTone', () => {
  it('grows louder and brighter with the pedal and the revs', () => {
    const idle = { ...engineTone(createEngineTone(), 700, 0, 700, 2700) };
    const pulling = { ...engineTone(createEngineTone(), 700, 1, 700, 2700) };
    const revving = { ...engineTone(createEngineTone(), 2700, 1, 700, 2700) };

    expect(pulling.gain).toBeGreaterThan(idle.gain);
    expect(pulling.cutoff).toBeGreaterThan(idle.cutoff);
    expect(revving.gain).toBeGreaterThan(pulling.gain);
    expect(revving.gain).toBeLessThanOrEqual(1);
  });

  it('stays light: idling it is more than half as loud as at its loudest', () => {
    const idle = engineTone(createEngineTone(), 700, 0, 700, 2700).gain;
    const loudest = engineTone(createEngineTone(), 2700, 1, 700, 2700).gain;

    expect(idle).toBeGreaterThan(loudest / 2);
  });

  it('burns fuel under load and ticking over at idle, and coasts with the pedal up above idle', () => {
    expect(engineTone(createEngineTone(), 700, 0, 700, 2700).pull).toBe(1);
    expect(engineTone(createEngineTone(), 1800, 0, 700, 2700).pull).toBe(0);
    expect(engineTone(createEngineTone(), 1800, 0.25, 700, 2700).pull).toBeCloseTo(0.5, 9);
    expect(engineTone(createEngineTone(), 1800, 1, 700, 2700).pull).toBe(1);
  });

  it('coasts softer and more muffled than it idles or pulls', () => {
    const coasting = { ...engineTone(createEngineTone(), 1800, 0, 700, 2700) };
    const pulling = { ...engineTone(createEngineTone(), 1800, 0.5, 700, 2700) };
    const idle = { ...engineTone(createEngineTone(), 700, 0, 700, 2700) };

    expect(coasting.gain).toBeLessThan(pulling.gain);
    expect(coasting.cutoff).toBeLessThan(pulling.cutoff);
    expect(coasting.cutoff).toBeLessThan(idle.cutoff);
  });

  it('keeps to its range whatever it is given, and writes into the object it is given', () => {
    const out = createEngineTone();

    expect(engineTone(out, -50, 3, 700, 700)).toBe(out);
    expect(out.gain).toBeGreaterThan(0);
    expect(out.gain).toBeLessThanOrEqual(1);
    expect(Number.isFinite(out.cutoff)).toBe(true);
    expect(out.pull).toBeLessThanOrEqual(1);
  });
});

describe('engineLoopMix', () => {
  const loops = [650, 900, 1250, 1750, 2450];

  it('plays the loop recorded at the engine speed alone, as recorded', () => {
    const mix = engineLoopMix(createEngineLoopMix(5), 1250, loops);

    expect([...mix.gains]).toEqual([0, 0, 1, 0, 0]);
    expect(mix.rates[2]).toBe(1);
  });

  it('cross-fades the two loops nearest the engine speed, keeping the power, each played to meet it', () => {
    const mix = engineLoopMix(createEngineLoopMix(5), 1500, loops);

    expect(mix.gains[0]).toBe(0);
    expect(mix.gains[1]).toBe(0);
    expect(mix.gains[4]).toBe(0);
    expect(mix.gains[2]! ** 2 + mix.gains[3]! ** 2).toBeCloseTo(1, 9);
    expect(mix.rates[2]).toBeCloseTo(1500 / 1250, 9);
    expect(mix.rates[3]).toBeCloseTo(1500 / 1750, 9);
    // Half way between them in octaves, half the power each.
    const middle = engineLoopMix(createEngineLoopMix(5), Math.sqrt(1250 * 1750), loops);
    expect(middle.gains[2]).toBeCloseTo(Math.SQRT1_2, 9);
    expect(middle.gains[3]).toBeCloseTo(Math.SQRT1_2, 9);
  });

  it('plays the end loops alone, slowed or sped, below the first and above the last', () => {
    const low = engineLoopMix(createEngineLoopMix(5), 600, loops);
    const high = engineLoopMix(createEngineLoopMix(5), 2700, loops);

    expect([...low.gains]).toEqual([1, 0, 0, 0, 0]);
    expect(low.rates[0]).toBeCloseTo(600 / 650, 9);
    expect([...high.gains]).toEqual([0, 0, 0, 0, 1]);
    expect(high.rates[4]).toBeCloseTo(2700 / 2450, 9);
  });

  it('never stops the loops for a stopped engine, and leaves an empty mix alone', () => {
    const stopped = engineLoopMix(createEngineLoopMix(5), 0, loops);

    expect(stopped.rates[0]).toBe(0.5);
    expect(engineLoopMix(createEngineLoopMix(0), 1000, []).gains.length).toBe(0);
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

describe('thunderSound', () => {
  it('follows the flash by the time sound takes to come that far: about three seconds a kilometer', () => {
    expect(thunderSound(1029, createThunderSound()).delaySeconds).toBeCloseTo(3, 6);
    expect(thunderSound(0, createThunderSound()).delaySeconds).toBe(0);
  });

  it('cracks and booms near, and rumbles long, low and faint far off', () => {
    const near = { ...thunderSound(400, createThunderSound()) };
    const far = { ...thunderSound(5000, createThunderSound()) };

    expect(near.crack).toBeGreaterThan(0.6);
    expect(far.crack).toBe(0);
    expect(near.level).toBe(1);
    expect(far.level).toBeLessThan(near.level / 2);
    expect(far.level).toBeGreaterThan(0);
    expect(far.seconds).toBeGreaterThan(near.seconds);
    expect(far.cutoffHz).toBeLessThan(near.cutoffHz / 2);
    expect(far.cutoffHz).toBeGreaterThanOrEqual(160);
  });

  it('writes into the object it is given', () => {
    const out = createThunderSound();
    expect(thunderSound(2000, out)).toBe(out);
  });
});
