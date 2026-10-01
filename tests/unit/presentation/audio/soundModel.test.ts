import { describe, expect, it } from 'vitest';
import {
  brakeNoiseLevel,
  COASTING,
  crashLevel,
  createEngineTone,
  createThunderSound,
  engineTone,
  exhaustHarmonics,
  type Harmonics,
  knockHarmonics,
  PULLING,
  type PulseShape,
  roadNoiseLevel,
  thunderSound,
} from '../../../../src/presentation/audio/soundModel';

/** The wave a PeriodicWave plays from `harmonics` (without normalization), at `u` (a share of its cycle). */
function waveAt(harmonics: Harmonics, u: number): number {
  let value = 0;
  for (let n = 1; n < harmonics.real.length; n++) {
    value += harmonics.real[n]! * Math.cos(2 * Math.PI * n * u) + harmonics.imag[n]! * Math.sin(2 * Math.PI * n * u);
  }
  return value;
}

const amplitude = (harmonics: Harmonics, n: number): number => Math.hypot(harmonics.real[n]!, harmonics.imag[n]!);

function power(harmonics: Harmonics, from = 1): number {
  let sum = 0;
  for (let n = from; n < harmonics.real.length; n++) {
    sum += amplitude(harmonics, n) ** 2 / 2;
  }
  return sum;
}

describe('engineTone', () => {
  it('sounds the six cylinders firing: three times a turn, the whole cycle once every two', () => {
    const tone = engineTone(createEngineTone(), 1200, 0, 700, 2700);

    expect(tone.frequency).toBeCloseTo(60, 9); // 1,200 rpm = 20 turns a second.
    expect(tone.cycleHz).toBeCloseTo(10, 9);
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
    expect(out.cycleHz).toBe(0);
    expect(out.gain).toBeLessThanOrEqual(1);
    for (const value of [out.cutoff, out.pull, out.clatter, out.turbo, out.turboHz]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('burns fuel under load and ticking over at idle, and coasts with the pedal up above idle', () => {
    expect(engineTone(createEngineTone(), 700, 0, 700, 2700).pull).toBe(1);
    expect(engineTone(createEngineTone(), 1800, 0, 700, 2700).pull).toBe(0);
    expect(engineTone(createEngineTone(), 1800, 0.25, 700, 2700).pull).toBeCloseTo(0.5, 9);
    expect(engineTone(createEngineTone(), 1800, 1, 700, 2700).pull).toBe(1);
  });

  it('clatters most labouring at low revs, lightly at idle, and not at all coasting', () => {
    const labouring = engineTone(createEngineTone(), 800, 1, 700, 2700).clatter;
    const idling = engineTone(createEngineTone(), 700, 0, 700, 2700).clatter;
    const revving = engineTone(createEngineTone(), 2600, 1, 700, 2700).clatter;

    expect(labouring).toBeGreaterThan(revving);
    expect(revving).toBeGreaterThan(0);
    expect(idling).toBeGreaterThan(0);
    expect(idling).toBeLessThan(labouring / 2);
    expect(engineTone(createEngineTone(), 1800, 0, 700, 2700).clatter).toBe(0);
  });

  it('spins the turbo up only working at revs, its whistle rising as it spins', () => {
    const idling = { ...engineTone(createEngineTone(), 700, 1, 700, 2700) };
    const cruising = { ...engineTone(createEngineTone(), 1700, 0.4, 700, 2700) };
    const boosting = { ...engineTone(createEngineTone(), 2700, 1, 700, 2700) };

    expect(idling.turbo).toBe(0);
    expect(engineTone(createEngineTone(), 2700, 0, 700, 2700).turbo).toBe(0);
    expect(cruising.turbo).toBeGreaterThan(0);
    expect(boosting.turbo).toBe(1);
    expect(boosting.turboHz).toBeGreaterThan(cruising.turboHz);
    expect(cruising.turboHz).toBeGreaterThan(idling.turboHz);
  });
});

describe('exhaustHarmonics', () => {
  it('is loudest at the firing note, with the cylinders\' small differences quietly under it', () => {
    const wave = exhaustHarmonics(PULLING, 640, 61, 0.25);
    const firing = amplitude(wave, 6);

    for (let n = 1; n <= 12; n++) {
      if (n !== 6) {
        expect(amplitude(wave, n)).toBeLessThan(firing);
      }
    }
    for (let n = 1; n <= 5; n++) {
      expect(amplitude(wave, n)).toBeGreaterThan(0.01 * firing);
      expect(amplitude(wave, n)).toBeLessThan(0.3 * firing);
    }
  });

  it('falls away toward the top faster than a buzz, keeping nearly all its power low', () => {
    const wave = exhaustHarmonics(PULLING, 640, 61, 0.25);

    // A sawtooth's harmonics fall as 1/n; from the 102nd to the 600th (both firing harmonics) these fall further.
    expect(amplitude(wave, 600) / amplitude(wave, 102)).toBeLessThan(102 / 600);
    expect(power(wave, 300) / power(wave)).toBeLessThan(0.01);
  });

  it('pulls brighter than it coasts', () => {
    const pulling = exhaustHarmonics(PULLING, 640, 61, 0.25);
    const coasting = exhaustHarmonics(COASTING, 640, 61, 0.25);

    expect(power(pulling, 60) / power(pulling)).toBeGreaterThan((2 * power(coasting, 60)) / power(coasting));
  });

  it('is the same every time, at the RMS level asked for', () => {
    const wave = exhaustHarmonics(COASTING, 320, 7, 0.17);

    expect(exhaustHarmonics(COASTING, 320, 7, 0.17)).toEqual(wave);
    expect(Math.sqrt(power(wave))).toBeCloseTo(0.17, 5);
    expect(exhaustHarmonics(COASTING, 320, 8, 0.17)).not.toEqual(wave);
  });

  it('is six pulses a cycle, each rising and dying away as drawn directly', () => {
    const even: PulseShape = { ...COASTING, strengthSpread: 0, timingSpread: 0, sharpnessSpread: 0 };
    // Enough harmonics that the series meets the pulses' sharp start closely.
    const wave = exhaustHarmonics(even, 2400, 61, 0.25);
    const { tau } = even;
    // The same pulses drawn in time: (t/τ)·e^(1−t/τ), peaking at 1, six a cycle, the last ones wrapping round.
    const points = 1200;
    const drawn = new Float64Array(points);
    for (let i = 0; i < points; i++) {
      for (let pulse = -6; pulse < 6; pulse++) {
        const t = i / points - pulse / 6;
        drawn[i]! += t > 0 ? (t / tau) * Math.exp(1 - t / tau) : 0;
      }
    }
    const mean = drawn.reduce((sum, value) => sum + value, 0) / points;
    const rms = Math.sqrt(drawn.reduce((sum, value) => sum + (value - mean) ** 2, 0) / points);

    let worst = 0;
    for (let i = 0; i < points; i++) {
      worst = Math.max(worst, Math.abs(waveAt(wave, i / points) - ((drawn[i]! - mean) * 0.25) / rms));
    }
    expect(worst).toBeLessThan(0.02);
  });
});

describe('knockHarmonics', () => {
  it('knocks briefly as each of the six cylinders fires, some harder than others, and is still between', () => {
    const knock = knockHarmonics(256, 0.02, 61);
    const at = (u: number): number => knock.mean + waveAt(knock, u);
    const heights = [0, 1, 2, 3, 4, 5].map((cylinder) => at(cylinder / 6));

    for (const height of heights) {
      expect(height).toBeGreaterThan(0.6);
      expect(height).toBeLessThan(1.02);
    }
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.02);
    for (let cylinder = 0; cylinder < 6; cylinder++) {
      expect(Math.abs(at(cylinder / 6 + 1 / 12))).toBeLessThan(0.02);
    }
    expect(knock.mean).toBeGreaterThan(0.6 * 6 * 0.01);
    expect(knock.mean).toBeLessThan(6 * 0.01);
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
