import type { PaintRarity } from '../../data/definitions/PaintDefinition';
import { clamp01 } from '../../core/math/scalar';
import { SeededRandom } from '../../core/random/SeededRandom';
import type { KnockableKind } from '../../domain/crash/knockables';
import { type EngineLoop, EngineSound } from './EngineSound';
import { brakeNoiseLevel, crashLevel, createThunderSound, roadNoiseLevel, SPEED_OF_SOUND, thunderSound } from './soundModel';

/** What the sound follows, written by the entry point every frame into one reused object. */
export interface SoundState {
  /** On the road and not paused: the engine, the tyres and the brakes are heard. */
  driving: boolean;
  engineRunning: boolean;
  engineRpm: number;
  idleRpm: number;
  maxRpm: number;
  /** How hard the engine works, 0..1: the pedal that drives while the clutch holds (a gear change lets it go). */
  engineLoad: number;
  /** The pedal that brakes, 0..1 (in reverse the pedals swap roles). */
  brakePedal: number;
  /** m/s along the heading. */
  speed: number;
  /** How hard it rains, 0..1. */
  rain: number;
  /** In reverse gear: the reversing alarm beeps. */
  reversing: boolean;
  /** Meters to the nearest emergency vehicle's siren (CityLifeView); Infinity for none. */
  sirenMeters: number;
}

export function createSoundState(): SoundState {
  return {
    driving: false,
    engineRunning: false,
    engineRpm: 0,
    idleRpm: 0,
    maxRpm: 1,
    engineLoad: 0,
    brakePedal: 0,
    speed: 0,
    rain: 0,
    reversing: false,
    sirenMeters: Number.POSITIVE_INFINITY,
  };
}

/** Off (the player's setting), waiting for the page's first touch, or on. */
export type SoundStatus = 'off' | 'waiting' | 'on';

const MASTER_VOLUME = 0.8;
const ROAD_VOLUME = 0.22;
const BRAKE_VOLUME = 0.1;
/** The rain: its soft wash, the drops pattering on the cab, and the tyres' spray off a wet road at speed. */
const RAIN_WASH_VOLUME = 0.07;
const RAIN_DROPS_VOLUME = 0.32;
const SPRAY_VOLUME = 0.09;
/** The tyres throw their loudest spray from this speed, m/s (about 70 km/h). */
const SPRAY_FULL_SPEED = 20;
/** The drops' loop: this long, seconds, with about this many drops a second on it. */
const DROPS_SECONDS = 4;
const DROPS_PER_SECOND = 70;
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
/** The emergency services' two-tone siren: its note, how far it swings either way and how often, Hz. */
const SIREN_HZ = 520;
const SIREN_SWING_HZ = 95;
const SIREN_TONES_PER_SECOND = 0.85;
const SIREN_VOLUME = 0.09;
/** It is heard from this far, meters, louder as it nears. */
const SIREN_REACH_METERS = 380;
const FIREWORK_VOLUME = 0.5;
/** A truck's dual-tone air horn: two notes a major third apart, Hz. */
const HORN_NOTES = [196, 247] as const;

/** The nodes that play all the time; their levels follow the SoundState. */
interface Graph {
  readonly master: GainNode;
  readonly noise: AudioBuffer;
  readonly engine: EngineSound;
  readonly roadFilter: BiquadFilterNode;
  readonly road: GainNode;
  readonly brake: GainNode;
  readonly rain: GainNode;
  readonly drops: GainNode;
  readonly spray: GainNode;
  readonly horn: GainNode;
  readonly alarm: GainNode;
  readonly siren: GainNode;
}

/**
 * The game's sound, spec §37's first version: the engine, the brakes, the
 * horn, the road, wind, rain and thunder, and the interface. The engine
 * (EngineSound) plays loops of a real diesel's recording, fetched with the
 * game (engineLoops.ts) and following the rpm and the load; everything else
 * is made with the Web Audio API from oscillators and noise. The tyres and
 * wind follow the speed, the rain the weather.
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
  private readonly thunderShape = createThunderSound();
  /** Braking from speed: stopping will let out the air brakes' hiss. */
  private hissArmed = false;
  /** Where in the noise each burst starts, so no two sound quite alike. */
  private readonly random = new SeededRandom(11);

  /**
   * `createContext` returns null where the browser has no Web Audio;
   * `loadEngineLoops` fetches the engine's sound for a context (none if it cannot).
   */
  constructor(
    private readonly createContext: () => AudioContext | null,
    enabled: boolean,
    private readonly loadEngineLoops: (context: AudioContext) => Promise<readonly EngineLoop[]>,
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
      const graph = buildGraph(this.context);
      this.graph = graph;
      void this.loadEngineLoops(this.context).then((loops) => graph.engine.play(loops));
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
    graph.engine.update(driving && state.engineRunning, state.engineRpm, state.engineLoad, state.idleRpm, state.maxRpm, now);
    follow(graph.roadFilter.frequency, 300 + 25 * Math.abs(state.speed), now);
    follow(graph.road.gain, driving ? roadNoiseLevel(state.speed) * ROAD_VOLUME : 0, now);
    follow(graph.brake.gain, driving ? brakeNoiseLevel(state.brakePedal, state.speed) * BRAKE_VOLUME : 0, now);
    // The rain is heard behind the menus too, softer; the spray only from tyres turning on a wet road.
    const rain = clamp01(state.rain) * (driving ? 1 : 0.5);
    follow(graph.rain.gain, rain * RAIN_WASH_VOLUME, now);
    follow(graph.drops.gain, rain * RAIN_DROPS_VOLUME, now);
    follow(graph.spray.gain, driving ? clamp01(state.rain) * clamp01(Math.abs(state.speed) / SPRAY_FULL_SPEED) * SPRAY_VOLUME : 0, now);
    follow(graph.horn.gain, driving && this.hornPressed ? HORN_VOLUME : 0, now);
    // Beep, beep: on for the first half of each beat while in reverse.
    const beeping = driving && state.reversing && (now * ALARM_BEATS_PER_SECOND) % 1 < 0.5;
    follow(graph.alarm.gain, beeping ? ALARM_VOLUME : 0, now);
    // Behind the menus too, softer, like the rain.
    const near = Math.max(0, 1 - state.sirenMeters / SIREN_REACH_METERS);
    follow(graph.siren.gain, near * near * SIREN_VOLUME * (driving ? 1 : 0.5), now);

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

  /** A delivery's star lands (`index` 0 to 2): a bell, higher for each; an unlit one a soft low tap. */
  star(index: number, lit: boolean): void {
    if (!lit) {
      this.note(220, 0, 0.18, 0.06, 'triangle');
      return;
    }
    const base = [659.25, 783.99, 987.77][Math.min(2, Math.max(0, index))]!;
    this.note(base, 0, 0.45, 0.13, 'sine');
    this.note(base * 2, 0, 0.25, 0.05, 'sine');
    this.noiseBurst('highpass', 6000, 0.12, 0.05);
  }

  /** A new company level: a rising fanfare, ending on a chord. */
  fanfare(): void {
    [392, 523.25, 659.25, 783.99].forEach((frequency, i) => this.note(frequency, i * 0.11, 0.3, 0.12, 'triangle'));
    for (const frequency of [523.25, 659.25, 783.99, 1046.5]) {
      this.note(frequency, 0.48, 1.1, 0.07, 'sine');
    }
  }

  /** A crate shakes (`step` 0 to 2, harder each time): a wooden knock. */
  crateShake(step: number): void {
    const level = 0.12 + 0.06 * step;
    this.note(150 + step * 30, 0, 0.12, level, 'triangle');
    this.noiseBurst('bandpass', 900 + step * 300, 0.1, level);
  }

  /** A crate bursts open: a crack and a shimmer, brighter for a rarer colour (null: credits alone). */
  crateBurst(rarity: PaintRarity | null): void {
    this.noiseBurst('lowpass', 1200, 0.3, 0.3);
    const notes = rarity === 'legendary' ? [783.99, 987.77, 1174.66, 1567.98] : rarity === 'epic' ? [659.25, 830.61, 987.77] : [587.33, 739.99];
    notes.forEach((frequency, i) => this.note(frequency, 0.05 + i * 0.08, 0.6, rarity === null ? 0.08 : 0.11, 'sine'));
    this.noiseBurst('highpass', 7000, 0.5, rarity === null ? 0.04 : 0.08, 0.1);
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

  /**
   * `kind` was knocked over, struck `speed` m/s hard: a tall post's ring and
   * its clatter as it lands, a sign's clang, a bin's hollow bonk, a
   * shelter's panes shattering, a bench's clack, a bale's soft thump.
   */
  knock(kind: KnockableKind, speed: number): void {
    const level = crashLevel(speed) * 0.8;
    switch (kind) {
      case 'lamp':
        this.note(196, 0, 0.9, 0.22 * level, 'triangle');
        this.note(523, 0, 0.6, 0.12 * level, 'triangle');
        this.note(1397, 0, 0.35, 0.06 * level, 'sine');
        this.noiseBurst('highpass', 1800, 0.18, 0.35 * level);
        this.noiseBurst('bandpass', 700, 0.3, 0.3 * level, 0.9);
        break;
      case 'speedSign':
      case 'roadSign':
        this.note(880, 0, 0.35, 0.12 * level, 'triangle');
        this.note(2217, 0, 0.2, 0.05 * level, 'sine');
        this.noiseBurst('highpass', 2500, 0.12, 0.3 * level);
        break;
      case 'bin':
      case 'mailbox':
        this.note(330, 0, 0.25, 0.14 * level, 'triangle');
        this.noiseBurst('bandpass', 1200, 0.15, 0.3 * level);
        break;
      case 'busStop':
        this.note(262, 0, 0.5, 0.12 * level, 'triangle');
        this.noiseBurst('highpass', 4000, 0.4, 0.4 * level);
        this.noiseBurst('highpass', 6000, 0.25, 0.25 * level, 0.08);
        break;
      case 'bench':
        this.note(180, 0, 0.12, 0.2 * level, 'triangle');
        this.noiseBurst('bandpass', 900, 0.12, 0.4 * level);
        break;
      case 'hayBale':
        this.note(70, 0, 0.25, 0.3 * level, 'sine');
        this.noiseBurst('lowpass', 500, 0.35, 0.45 * level);
        break;
    }
  }

  /** A car or minibus was wrecked, struck `speed` m/s hard: a heavy crunch, and the tinkle of its glass. */
  wreck(speed: number): void {
    const level = crashLevel(speed);
    this.note(48, 0, 0.4, 0.5 * level, 'sine');
    this.noiseBurst('lowpass', 1400, 0.55, 0.5 * level);
    this.noiseBurst('bandpass', 600, 0.3, 0.35 * level, 0.05);
    for (let shard = 0; shard < 5; shard++) {
      this.noiseBurst('highpass', 5000 + shard * 700, 0.08, 0.18 * level, 0.08 + shard * 0.05 + this.random.range(0, 0.03));
    }
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

  /** A firework `distanceMeters` off, bursting `delaySeconds` from now: a bang, heard later the farther it is, and a crackle. */
  firework(distanceMeters: number, delaySeconds: number): void {
    const delay = delaySeconds + distanceMeters / SPEED_OF_SOUND;
    const level = FIREWORK_VOLUME * Math.min(1, Math.max(0.08, 120 / Math.max(1, distanceMeters)));
    this.noiseBurst('lowpass', 420, 0.7, level, delay);
    let at = delay + 0.15;
    for (let crackle = 0; crackle < 5; crackle++) {
      at += this.random.range(0.06, 0.22);
      this.noiseBurst('highpass', 2800, 0.05, level * 0.35, at);
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

/**
 * Rain on the cab, made once (seeded): drops landing at random, each a short tick of noise dying away in a few
 * milliseconds, some heavy and dull, most light and brighter. Looped, it patters without a pattern to hear.
 */
function dropsBuffer(context: AudioContext): AudioBuffer {
  const rate = context.sampleRate;
  const buffer = context.createBuffer(1, Math.round(rate * DROPS_SECONDS), rate);
  const samples = buffer.getChannelData(0);
  const random = new SeededRandom(41);
  const drops = Math.round(DROPS_SECONDS * DROPS_PER_SECOND);
  for (let drop = 0; drop < drops; drop++) {
    const start = Math.floor(random.next() * samples.length);
    const weight = random.next();
    const strength = 0.15 + 0.85 * weight * weight;
    const length = Math.round(rate * (0.004 + 0.01 * weight));
    // A heavier drop is duller: a stronger one-pole low-pass on its noise.
    const smoothing = 0.35 + 0.5 * weight;
    let value = 0;
    for (let i = 0; i < length; i++) {
      value += (random.range(-1, 1) - value) * (1 - smoothing);
      const index = (start + i) % samples.length;
      samples[index] = samples[index]! + value * strength * Math.exp((-5 * i) / length);
    }
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

  const engine = new EngineSound(context, master);

  // Tyres and wind, the brakes rubbing, and rain.
  const roadFilter = filterNode(context, 'lowpass', 300);
  const road = gainNode(context, 0);
  noiseLoop().connect(roadFilter).connect(road).connect(master);
  const brake = gainNode(context, 0);
  noiseLoop().connect(filterNode(context, 'bandpass', 2500, 0.8)).connect(brake).connect(master);
  // The rain: a soft wash, low and dull (a phone's speaker makes a bright one a hiss)…
  const rain = gainNode(context, 0);
  noiseLoop().connect(filterNode(context, 'highpass', 350)).connect(filterNode(context, 'lowpass', 2200, 0.6)).connect(rain).connect(master);
  // …its drops pattering on the cab…
  const drops = gainNode(context, 0);
  const patter = context.createBufferSource();
  patter.buffer = dropsBuffer(context);
  patter.loop = true;
  patter.connect(filterNode(context, 'highpass', 500)).connect(filterNode(context, 'lowpass', 4500, 0.6)).connect(drops).connect(master);
  patter.start();
  // …and the tyres' spray off the wet road.
  const spray = gainNode(context, 0);
  noiseLoop().connect(filterNode(context, 'bandpass', 1400, 0.6)).connect(filterNode(context, 'lowpass', 3000, 0.6)).connect(spray).connect(master);

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

  // The siren: a softened square wave swung between two notes by a slow square wave, switched on by update().
  const siren = gainNode(context, 0);
  const sirenNote = context.createOscillator();
  sirenNote.type = 'square';
  sirenNote.frequency.value = SIREN_HZ;
  const swing = context.createOscillator();
  swing.type = 'square';
  swing.frequency.value = SIREN_TONES_PER_SECOND;
  const swingDepth = gainNode(context, SIREN_SWING_HZ);
  swing.connect(swingDepth).connect(sirenNote.frequency);
  sirenNote.connect(filterNode(context, 'lowpass', 1600)).connect(siren).connect(master);
  sirenNote.start();
  swing.start();

  return { master, noise, engine, roadFilter, road, brake, rain, drops, spray, horn, alarm, siren };
}
