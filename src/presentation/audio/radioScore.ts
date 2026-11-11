import { SeededRandom } from '../../core/random/SeededRandom';
import type { RadioStation } from '../../data/config/radio';

/** An oscillator's wave (Web Audio's OscillatorType, without the DOM). */
export type Wave = 'sine' | 'square' | 'sawtooth' | 'triangle';

/** A station's sound: its tempo, key and chords, its instruments and its beat. */
export interface StationStyle {
  readonly bpm: number;
  /** The key's root, a MIDI note, and its scale (semitones from the root). */
  readonly root: number;
  readonly scale: readonly number[];
  /** The chords, a bar each, as degrees of the scale (0 the root). */
  readonly progression: readonly number[];
  readonly lead: Wave;
  readonly pad: Wave;
  readonly bass: Wave;
  /** How loud each part is, 0..1. */
  readonly levels: { readonly lead: number; readonly pad: number; readonly bass: number; readonly drums: number };
  /** The beat, sixteen steps a bar: 1 hits, 0 rests. */
  readonly kick: readonly number[];
  readonly snare: readonly number[];
  readonly hat: readonly number[];
  /** The bass plays on these steps of the bar. */
  readonly bassSteps: readonly number[];
  /** How likely the lead plays on a step it may (every other one), 0..1. */
  readonly leadDensity: number;
  /** The lead's notes last this many steps. */
  readonly leadSteps: number;
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11] as const;
const MINOR = [0, 2, 3, 5, 7, 8, 10] as const;
export const STATION_STYLES: Readonly<Record<RadioStation, StationStyle>> = {
  // Highway FM: bright pop-rock on the motorway, I–V–vi–IV.
  highway: {
    bpm: 116,
    root: 62,
    scale: MAJOR,
    progression: [0, 4, 5, 3],
    lead: 'square',
    pad: 'sawtooth',
    bass: 'triangle',
    levels: { lead: 0.05, pad: 0.035, bass: 0.16, drums: 0.5 },
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1],
    bassSteps: [0, 3, 6, 8, 11, 14],
    leadDensity: 0.55,
    leadSteps: 2,
  },
  // Night Drive: slow synthwave in a minor key, i–VI–III–VII, arpeggios over pads.
  night: {
    bpm: 92,
    root: 57,
    scale: MINOR,
    progression: [0, 5, 2, 6],
    lead: 'sawtooth',
    pad: 'sawtooth',
    bass: 'sawtooth',
    levels: { lead: 0.035, pad: 0.05, bass: 0.1, drums: 0.42 },
    kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
    bassSteps: [0, 2, 4, 6, 8, 10, 12, 14],
    leadDensity: 0.8,
    leadSteps: 1,
  },
  // Dust Road: easy country, plucked notes and a shuffle, I–IV–I–V.
  country: {
    bpm: 84,
    root: 55,
    scale: MAJOR,
    progression: [0, 3, 0, 4],
    lead: 'triangle',
    pad: 'triangle',
    bass: 'triangle',
    levels: { lead: 0.09, pad: 0.04, bass: 0.18, drums: 0.3 },
    kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
    hat: [1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1],
    bassSteps: [0, 8],
    leadDensity: 0.45,
    leadSteps: 3,
  },
};

/** Every this many bars the lead rests a while (two bars): a song breathes. */
const BREAK_EVERY_BARS = 8;
/** A chord: the root, the third and the fifth, as scale degrees above its root. */
const CHORD = [0, 2, 4] as const;

/** What a note is played on: the drums, the bass, the chord's pad, the lead. */
export type NotePart = 'kick' | 'snare' | 'hat' | 'bass' | 'chord' | 'lead';

/** A note of the score: its part, its pitch (MIDI; 0 for a drum), how many sixteenths it lasts, its level and wave. */
export interface ScoreNote {
  part: NotePart;
  midi: number;
  steps: number;
  level: number;
  wave: Wave;
}

/** A score's notes, enough for its busiest step. */
export function createScoreNotes(): ScoreNote[] {
  return Array.from({ length: 8 }, () => ({ part: 'kick' as NotePart, midi: 0, steps: 1, level: 0, wave: 'sine' as Wave }));
}

/**
 * A station's music, a sixteenth at a time (CabRadio plays it): its beat,
 * the bass on the chord's root, the bar's chord held, and a lead that walks
 * through the scale and comes back to the chord's notes on the beat, resting
 * two bars in every eight. Seeded: the same station plays the same way from
 * its start. No DOM: what is played is decided here, how it sounds there.
 */
export class RadioScore {
  private step = 0;
  private bar = 0;
  private melody = 0;
  private random: SeededRandom;
  readonly style: StationStyle;

  constructor(readonly station: RadioStation) {
    this.style = STATION_STYLES[station];
    this.random = new SeededRandom(station.length * 7919 + 13);
  }

  /** How long a sixteenth lasts, seconds. */
  get stepSeconds(): number {
    return 60 / this.style.bpm / 4;
  }

  /** The next sixteenth's notes, written into `out` (createScoreNotes); how many. Allocation-free. */
  next(out: ScoreNote[]): number {
    const style = this.style;
    const step = this.step;
    const chordDegree = style.progression[this.bar % style.progression.length]!;
    const drums = style.levels.drums;
    let count = 0;
    const put = (part: NotePart, midi: number, steps: number, level: number, wave: Wave): void => {
      const note = out[count++]!;
      note.part = part;
      note.midi = midi;
      note.steps = steps;
      note.level = level;
      note.wave = wave;
    };
    if (style.kick[step] === 1) {
      put('kick', 0, 1, drums, 'sine');
    }
    if (style.snare[step] === 1) {
      put('snare', 0, 1, drums, 'triangle');
    }
    if (style.hat[step] === 1) {
      put('hat', 0, 1, drums, 'sine');
    }
    if (style.bassSteps.includes(step)) {
      put('bass', this.pitch(chordDegree, -2), 1.8, style.levels.bass, style.bass);
    }
    if (step === 0) {
      // The bar's chord, held to its end: root, third and fifth.
      for (const above of CHORD) {
        put('chord', this.pitch(chordDegree + above, 0), 16, style.levels.pad, style.pad);
      }
    }
    const resting = this.bar % BREAK_EVERY_BARS >= BREAK_EVERY_BARS - 2;
    if (!resting && step % style.leadSteps === 0 && this.random.next() < style.leadDensity) {
      this.melody = Math.max(-3, Math.min(9, this.melody + this.random.int(-2, 2)));
      const degree = step % 4 === 0 ? chordDegree + CHORD[this.random.int(0, 2)]! : chordDegree + this.melody;
      put('lead', this.pitch(degree, 1), style.leadSteps * 0.95, style.levels.lead, style.lead);
    }
    this.step = (step + 1) % 16;
    if (this.step === 0) {
      this.bar++;
    }
    return count;
  }

  /** The MIDI note of scale degree `degree` (any whole number), `octave` octaves up from the key's. */
  private pitch(degree: number, octave: number): number {
    const scale = this.style.scale;
    const within = ((degree % scale.length) + scale.length) % scale.length;
    const octaves = Math.floor(degree / scale.length) + octave;
    return this.style.root + scale[within]! + 12 * octaves;
  }
}

/** A MIDI note's frequency, Hz. */
export function midiFrequency(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}
