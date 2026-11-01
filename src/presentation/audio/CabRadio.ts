import { SeededRandom } from '../../core/random/SeededRandom';
import type { RadioChoice } from '../../data/config/radio';
import { createScoreNotes, midiFrequency, RadioScore, type ScoreNote } from './radioScore';

/** Where the radio plays: the game's audio context and its master volume (GameAudio.output). */
export interface RadioOutput {
  readonly context: AudioContext;
  readonly destination: AudioNode;
}

/** Runs `run` every `ms` until the returned function is called. */
export type RepeatTimer = (run: () => void, ms: number) => () => void;

/** How far ahead the notes are lined up, seconds, and how often the radio looks again, ms. */
const LOOK_AHEAD_SECONDS = 0.25;
const TICK_MS = 90;
/** The radio's volume on the road, and how fast it fades, seconds. */
const LEVEL = 0.55;
const FADE_SECONDS = 0.35;

/**
 * The cab radio: three stations of music made as it plays (RadioScore
 * decides the notes; here Web Audio oscillators and noise sound them:
 * nothing to download, nothing licensed). It plays only on the road
 * (`playing`), fading in and out; a station picked starts from its top. The
 * notes are lined up a quarter of a second ahead from a timer, not the frame
 * loop.
 */
export class CabRadio {
  private output: RadioOutput | null = null;
  private gain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private stationValue: RadioChoice = 'off';
  private score: RadioScore | null = null;
  private readonly notes: ScoreNote[] = createScoreNotes();
  private playingValue = false;
  private stop: (() => void) | null = null;
  private nextStepTime = 0;
  private readonly random = new SeededRandom(5);

  constructor(private readonly repeat: RepeatTimer) {}

  /** The station on, or 'off'. */
  get station(): RadioChoice {
    return this.stationValue;
  }

  set station(choice: RadioChoice) {
    if (choice === this.stationValue) {
      return;
    }
    this.stationValue = choice;
    this.score = choice === 'off' ? null : new RadioScore(choice);
    if (this.output !== null) {
      this.nextStepTime = this.output.context.currentTime + 0.05;
    }
    this.apply();
  }

  /** Whether it may play now (on the road, not paused). */
  set playing(playing: boolean) {
    if (playing !== this.playingValue) {
      this.playingValue = playing;
      this.apply();
    }
  }

  /** The game's audio, once it has started (a touch or key press): where the radio plays. */
  connect(output: RadioOutput | null): void {
    if (output === null || this.output !== null) {
      return;
    }
    this.output = output;
    const { context } = output;
    this.gain = context.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(output.destination);
    this.noise = noiseBuffer(context);
    this.nextStepTime = context.currentTime + 0.05;
    this.apply();
  }

  dispose(): void {
    this.stop?.();
    this.stop = null;
    this.gain?.disconnect();
  }

  /** Fades to the station's level or to silence, and runs the timer only while there is something to play. */
  private apply(): void {
    const gain = this.gain;
    const output = this.output;
    if (gain === null || output === null) {
      return;
    }
    const on = this.playingValue && this.score !== null;
    gain.gain.setTargetAtTime(on ? LEVEL : 0, output.context.currentTime, FADE_SECONDS / 3);
    if (on && this.stop === null) {
      this.nextStepTime = Math.max(this.nextStepTime, output.context.currentTime + 0.05);
      this.stop = this.repeat(() => this.schedule(), TICK_MS);
    } else if (!on && this.stop !== null) {
      this.stop();
      this.stop = null;
    }
  }

  /** Lines up the notes of the sixteenths due before the look-ahead ends. */
  private schedule(): void {
    const output = this.output;
    const score = this.score;
    if (output === null || score === null || output.context.state !== 'running') {
      return;
    }
    const stepSeconds = score.stepSeconds;
    const now = output.context.currentTime;
    if (this.nextStepTime < now) {
      // Fell behind (the tab slept): on from now.
      this.nextStepTime = now + 0.02;
    }
    while (this.nextStepTime < now + LOOK_AHEAD_SECONDS) {
      const count = score.next(this.notes);
      for (let i = 0; i < count; i++) {
        this.play(this.notes[i]!, this.nextStepTime, stepSeconds);
      }
      this.nextStepTime += stepSeconds;
    }
  }

  private play(note: ScoreNote, time: number, stepSeconds: number): void {
    switch (note.part) {
      case 'kick':
        this.kick(time, note.level);
        break;
      case 'snare':
        this.hiss(time, 'bandpass', 1900, 0.16, 0.22 * note.level);
        this.tone(185, time, 0.08, 0.1 * note.level, 'triangle', 0.005);
        break;
      case 'hat':
        this.hiss(time, 'highpass', 7000, 0.04, 0.09 * note.level);
        break;
      default:
        this.tone(midiFrequency(note.midi), time, stepSeconds * note.steps, note.level, note.wave, note.part === 'chord' ? 0.08 : 0.01);
    }
  }

  private tone(frequency: number, time: number, seconds: number, level: number, type: OscillatorType, attack: number): void {
    const { context } = this.output!;
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(level, time + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + seconds);
    oscillator.connect(envelope).connect(this.gain!);
    oscillator.start(time);
    oscillator.stop(time + seconds + 0.02);
  }

  /** A kick drum: a sine falling fast in pitch. */
  private kick(time: number, level: number): void {
    const { context } = this.output!;
    const oscillator = context.createOscillator();
    oscillator.frequency.setValueAtTime(140, time);
    oscillator.frequency.exponentialRampToValueAtTime(42, time + 0.12);
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.6 * level, time);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);
    oscillator.connect(envelope).connect(this.gain!);
    oscillator.start(time);
    oscillator.stop(time + 0.25);
  }

  /** Filtered noise: a snare's rattle, a hat's tick. */
  private hiss(time: number, type: BiquadFilterType, frequency: number, seconds: number, level: number): void {
    const { context } = this.output!;
    const source = context.createBufferSource();
    source.buffer = this.noise;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(level, time);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + seconds);
    source.connect(filter).connect(envelope).connect(this.gain!);
    source.start(time, this.random.range(0, 0.8));
    source.stop(time + seconds + 0.02);
  }
}

/** A second of white noise, made once, for the drums. */
function noiseBuffer(context: AudioContext): AudioBuffer {
  const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
  const data = buffer.getChannelData(0);
  const random = new SeededRandom(97);
  for (let i = 0; i < data.length; i++) {
    data[i] = random.next() * 2 - 1;
  }
  return buffer;
}
