import { clamp01 } from '../../core/math/scalar';
import { SeededRandom } from '../../core/random/SeededRandom';
import {
  brakeNoiseLevel,
  crashLevel,
  createEngineTone,
  createThunderSound,
  engineTone,
  roadNoiseLevel,
  thunderSound,
} from './soundModel';

/** What the sound follows, written by the entry point every frame into one reused object. */
export interface SoundState {
  /** On the road and not paused: the engine, the tyres and the brakes are heard. */
  driving: boolean;
  engineRunning: boolean;
  engineRpm: number;
  idleRpm: number;
  maxRpm: number;
  /** The pedal that drives and the one that brakes, 0..1 (in reverse the pedals swap roles). */
  drivePedal: number;
  brakePedal: number;
  /** m/s along the heading. */
  speed: number;
  /** How hard it rains, 0..1. */
  rain: number;
  /** In reverse gear: the reversing alarm beeps. */
  reversing: boolean;
}

export function createSoundState(): SoundState {
  return {
    driving: false,
    engineRunning: false,
    engineRpm: 0,
    idleRpm: 0,
    maxRpm: 1,
    drivePedal: 0,
    brakePedal: 0,
    speed: 0,
    rain: 0,
    reversing: false,
  };
}

/** Off (the player's setting), waiting for the page's first touch, or on. */
export type SoundStatus = 'off' | 'waiting' | 'on';

const MASTER_VOLUME = 0.8;
const ENGINE_VOLUME = 0.3;
const ROAD_VOLUME = 0.22;
const BRAKE_VOLUME = 0.1;
const RAIN_VOLUME = 0.14;
const HORN_VOLUME = 0.2;
const THUNDER_VOLUME = 0.9;
/** Thunder's rumble swells again this many times as the sound comes in from farther along the channel. */
const THUNDER_ROLLS = 3;
/** Seconds for a level to settle: quick enough to follow the pedal, slow enough not to click. */
const SMOOTHING_SECONDS = 0.06;
const NOISE_SECONDS = 2;
/** The air brakes hiss when the truck stops (under this speed, m/s) after braking from at least HISS_FROM_SPEED. */
const STOPPED_SPEED = 0.3;
const HISS_FROM_SPEED = 3;
/** The reversing alarm: this note, on for half of each beat, this many beats a second. */
const ALARM_HZ = 1150;
const ALARM_BEATS_PER_SECOND = 1.25;
const ALARM_VOLUME = 0.07;
/** A truck's dual-tone air horn: two notes a major third apart, Hz. */
const HORN_NOTES = [196, 247] as const;

/** The nodes that play all the time; their levels follow the SoundState. */
interface Graph {
  readonly master: GainNode;
  readonly noise: AudioBuffer;
  readonly fire: OscillatorNode;
  readonly sub: OscillatorNode;
  readonly engineFilter: BiquadFilterNode;
  readonly clatter: GainNode;
  readonly engine: GainNode;
  readonly roadFilter: BiquadFilterNode;
  readonly road: GainNode;
  readonly brake: GainNode;
  readonly rain: GainNode;
  readonly horn: GainNode;
  readonly alarm: GainNode;
}

/**
 * The game's sound, spec §37's first version: the engine, the brakes, the
 * horn, the road, wind, rain and thunder, and the interface. All of it is made with
 * the Web Audio API from oscillators and noise: no sound files, nothing to
 * download, original by construction. The engine note follows the rpm and
 * the pedal, the tyres and wind the speed, the rain the weather.
 *
 * Browsers start sound only after the player touches the page, so unlock()
 * is called from every touch or key press until it has. update() only moves
 * parameters and allocates nothing; a one-shot sound (a click, a crash)
 * makes its few nodes when it plays.
 */
export class GameAudio {
  private context: AudioContext | null = null;
  private graph: Graph | null = null;
  private on: boolean;
  private hornPressed = false;
  private readonly tone = createEngineTone();
  private readonly thunderShape = createThunderSound();
  /** Braking from speed: stopping will let out the air brakes' hiss. */
  private hissArmed = false;
  /** Where in the noise each burst starts, so no two sound quite alike. */
  private readonly random = new SeededRandom(11);

  /** `createContext` returns null where the browser has no Web Audio. */
  constructor(
    private readonly createContext: () => AudioContext | null,
    enabled: boolean,
  ) {
    this.on = enabled;
  }

  get status(): SoundStatus {
    if (!this.on) {
      return 'off';
    }
    return this.context?.state === 'running' ? 'on' : 'waiting';
  }

  get enabled(): boolean {
    return this.on;
  }

  /** The player's setting. Off also stops the audio thread's work. */
  set enabled(on: boolean) {
    this.on = on;
    if (on) {
      this.unlock();
    } else if (this.context?.state === 'running') {
      void this.context.suspend();
    }
  }

  /** Call from a touch or a key press: makes the audio context on the first, and wakes it up after that. */
  unlock(): void {
    if (!this.on) {
      return;
    }
    if (this.context === null) {
      this.context = this.createContext();
      if (this.context === null) {
        return;
      }
      this.graph = buildGraph(this.context);
    }
    if (this.context.state === 'suspended') {
      void this.context.resume();
    }
  }

  /** The page was hidden: nothing plays while nobody listens. */
  suspend(): void {
    if (this.context?.state === 'running') {
      void this.context.suspend();
    }
  }

  /** The page is back: sound resumes (the page was touched before, so the browser allows it). */
  resume(): void {
    if (this.on && this.context?.state === 'suspended') {
      void this.context.resume();
    }
  }

  /** The horn, held down or let go. It sounds only while driving. */
  setHorn(pressed: boolean): void {
    this.hornPressed = pressed;
  }

  /** Per frame: the levels and notes follow `state`. Allocation-free. */
  update(state: Readonly<SoundState>): void {
    const context = this.context;
    const graph = this.graph;
    if (context === null || graph === null || context.state !== 'running') {
      return;
    }
    const now = context.currentTime;
    const { driving } = state;
    engineTone(this.tone, state.engineRpm, state.drivePedal, state.idleRpm, state.maxRpm);
    follow(graph.fire.frequency, this.tone.frequency, now);
    follow(graph.sub.frequency, this.tone.frequency / 2, now);
    follow(graph.engineFilter.frequency, this.tone.cutoff, now);
    follow(graph.clatter.gain, 0.1 + 0.3 * clamp01(state.drivePedal), now);
    follow(graph.engine.gain, driving && state.engineRunning ? this.tone.gain * ENGINE_VOLUME : 0, now);
    follow(graph.roadFilter.frequency, 300 + 25 * Math.abs(state.speed), now);
    follow(graph.road.gain, driving ? roadNoiseLevel(state.speed) * ROAD_VOLUME : 0, now);
    follow(graph.brake.gain, driving ? brakeNoiseLevel(state.brakePedal, state.speed) * BRAKE_VOLUME : 0, now);
    // The rain is heard behind the menus too, softer.
    follow(graph.rain.gain, clamp01(state.rain) * RAIN_VOLUME * (driving ? 1 : 0.5), now);
    follow(graph.horn.gain, driving && this.hornPressed ? HORN_VOLUME : 0, now);
    // Beep, beep: on for the first half of each beat while in reverse.
    const beeping = driving && state.reversing && (now * ALARM_BEATS_PER_SECOND) % 1 < 0.5;
    follow(graph.alarm.gain, beeping ? ALARM_VOLUME : 0, now);

    const speed = Math.abs(state.speed);
    if (!driving || state.brakePedal < 0.5) {
      this.hissArmed = false;
    } else if (speed >= HISS_FROM_SPEED) {
      this.hissArmed = true;
    } else if (this.hissArmed && speed < STOPPED_SPEED) {
      this.hissArmed = false;
      this.noiseBurst('highpass', 2500, 0.7, 0.16);
    }
  }

  /** A button pressed. */
  click(): void {
    this.note(1100, 0, 0.05, 0.08, 'sine');
  }

  /** A contract delivered: a rising chord. */
  chime(): void {
    [523.25, 659.25, 783.99].forEach((frequency, i) => this.note(frequency, i * 0.12, 0.5, 0.14, 'sine'));
  }

  /** A contract failed: a falling pair of notes. */
  fail(): void {
    this.note(392, 0, 0.28, 0.14, 'triangle');
    this.note(311.13, 0.22, 0.4, 0.14, 'triangle');
  }

  /** The truck hit something `impactSpeed` m/s hard: a thud and a crunch. */
  crash(impactSpeed: number): void {
    const level = crashLevel(impactSpeed);
    this.note(58, 0, 0.3, 0.5 * level, 'sine');
    this.noiseBurst('lowpass', 900, 0.45, 0.45 * level);
  }

  /** The cargo was loaded: a heavy clunk. */
  clunk(): void {
    this.note(90, 0, 0.16, 0.35, 'sine');
    this.noiseBurst('bandpass', 220, 0.2, 0.3);
  }

  /**
   * Thunder from a strike `distanceMeters` off (thunderSound): after the
   * time sound takes to come that far, a crack if it was near, then a long,
   * deep rumble that swells a few times as it rolls, getting deeper.
   */
  thunder(distanceMeters: number): void {
    const context = this.context;
    const graph = this.graph;
    if (context === null || graph === null || context.state !== 'running') {
      return;
    }
    const sound = thunderSound(distanceMeters, this.thunderShape);
    const start = context.currentTime + sound.delaySeconds;
    const end = start + sound.seconds;
    const level = sound.level * THUNDER_VOLUME;
    const source = context.createBufferSource();
    source.buffer = graph.noise;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(sound.cutoffHz, start);
    filter.frequency.exponentialRampToValueAtTime(90, end);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, start);
    let at = start + 0.15;
    gain.gain.linearRampToValueAtTime(level, at);
    for (let roll = 0; roll < THUNDER_ROLLS; roll++) {
      at += this.random.range(0.3, 0.8);
      gain.gain.linearRampToValueAtTime(level * this.random.range(0.35, 0.9), at);
    }
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    source.connect(filter).connect(gain).connect(graph.master);
    source.start(start, this.random.range(0, NOISE_SECONDS));
    source.stop(end + 0.1);
    if (sound.crack > 0) {
      this.noiseBurst('highpass', 300, 0.35, 0.6 * sound.crack * THUNDER_VOLUME, sound.delaySeconds);
    }
  }

  dispose(): void {
    void this.context?.close();
    this.context = null;
    this.graph = null;
  }

  /** One decaying note, `delay` seconds from now. */
  private note(frequency: number, delay: number, seconds: number, level: number, type: OscillatorType): void {
    const context = this.context;
    const graph = this.graph;
    if (context === null || graph === null || context.state !== 'running') {
      return;
    }
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    const envelope = decay(context, start, seconds, level);
    oscillator.connect(envelope).connect(graph.master);
    oscillator.start(start);
    oscillator.stop(start + seconds);
  }

  /** A short burst of filtered noise, `delay` seconds from now. */
  private noiseBurst(type: BiquadFilterType, frequency: number, seconds: number, level: number, delay = 0): void {
    const context = this.context;
    const graph = this.graph;
    if (context === null || graph === null || context.state !== 'running') {
      return;
    }
    const start = context.currentTime + delay;
    const source = context.createBufferSource();
    source.buffer = graph.noise;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    source.connect(filter).connect(decay(context, start, seconds, level)).connect(graph.master);
    source.start(start, this.random.range(0, NOISE_SECONDS - seconds));
    source.stop(start + seconds);
  }
}

/** Moves a parameter smoothly toward `value`. */
function follow(parameter: AudioParam, value: number, now: number): void {
  parameter.setTargetAtTime(value, now, SMOOTHING_SECONDS);
}

/** A gain that starts at `level` at `start` and dies away over `seconds`. */
function decay(context: AudioContext, start: number, seconds: number, level: number): GainNode {
  const gain = context.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(level, start + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + seconds);
  return gain;
}

function gainNode(context: AudioContext, value: number): GainNode {
  const gain = context.createGain();
  gain.gain.value = value;
  return gain;
}

function filterNode(context: AudioContext, type: BiquadFilterType, frequency: number, q = 1): BiquadFilterNode {
  const filter = context.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  return filter;
}

/** Two seconds of white noise, the same every time (seeded). */
function noiseBuffer(context: AudioContext): AudioBuffer {
  const buffer = context.createBuffer(1, Math.round(context.sampleRate * NOISE_SECONDS), context.sampleRate);
  const samples = buffer.getChannelData(0);
  const random = new SeededRandom(37);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = random.range(-1, 1);
  }
  return buffer;
}

/** Everything that plays for the whole session, silent until update() turns it up. */
function buildGraph(context: AudioContext): Graph {
  const master = gainNode(context, MASTER_VOLUME);
  master.connect(context.destination);
  const noise = noiseBuffer(context);
  // Each noise loop starts at its own place in the buffer, so they do not sound alike.
  let offset = 0;
  const noiseLoop = (): AudioBufferSourceNode => {
    const source = context.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    source.start(0, offset);
    offset += NOISE_SECONDS / 4;
    return source;
  };

  // The engine: the firing note, a rumble an octave down, and diesel clatter, through a filter the load opens.
  const fire = context.createOscillator();
  fire.type = 'sawtooth';
  const sub = context.createOscillator();
  sub.type = 'square';
  const engineFilter = filterNode(context, 'lowpass', 400, 0.9);
  const clatter = gainNode(context, 0);
  const engine = gainNode(context, 0);
  fire.connect(engineFilter);
  sub.connect(gainNode(context, 0.45)).connect(engineFilter);
  noiseLoop().connect(filterNode(context, 'bandpass', 900, 1.2)).connect(clatter).connect(engineFilter);
  engineFilter.connect(engine).connect(master);
  fire.start();
  sub.start();

  // Tyres and wind, the brakes rubbing, and rain.
  const roadFilter = filterNode(context, 'lowpass', 300);
  const road = gainNode(context, 0);
  noiseLoop().connect(roadFilter).connect(road).connect(master);
  const brake = gainNode(context, 0);
  noiseLoop().connect(filterNode(context, 'bandpass', 2500, 0.8)).connect(brake).connect(master);
  const rain = gainNode(context, 0);
  noiseLoop().connect(filterNode(context, 'highpass', 1500)).connect(filterNode(context, 'lowpass', 7000)).connect(rain).connect(master);

  // The horn: two notes, softened.
  const horn = gainNode(context, 0);
  const hornFilter = filterNode(context, 'lowpass', 1800);
  hornFilter.connect(horn).connect(master);
  for (const frequency of HORN_NOTES) {
    const note = context.createOscillator();
    note.type = 'sawtooth';
    note.frequency.value = frequency;
    note.connect(hornFilter);
    note.start();
  }

  // The reversing alarm: one steady note, switched on and off by update().
  const alarm = gainNode(context, 0);
  const alarmNote = context.createOscillator();
  alarmNote.type = 'sine';
  alarmNote.frequency.value = ALARM_HZ;
  alarmNote.connect(alarm).connect(master);
  alarmNote.start();

  return { master, noise, fire, sub, engineFilter, clatter, engine, roadFilter, road, brake, rain, horn, alarm };
}
