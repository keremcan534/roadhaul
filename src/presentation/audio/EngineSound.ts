import { createEngineLoopMix, createEngineTone, engineLoopMix, engineTone } from './soundModel';

/** The engine at its loudest: kept light, a sound under the drive rather than over it ("hafif yeterli"). */
const ENGINE_VOLUME = 0.25;
/** Seconds for a level or a speed to settle: quick enough to follow the pedal, slow enough not to click. */
const SMOOTHING_SECONDS = 0.06;

/** One loop of the engine running steadily: the engine speed it runs at, and its sound, the first `seconds` of `buffer`. */
export interface EngineLoop {
  readonly rpm: number;
  readonly buffer: AudioBuffer;
  readonly seconds: number;
}

interface Voice {
  readonly source: AudioBufferSourceNode;
  readonly level: GainNode;
}

/**
 * The truck's diesel, from a recording: loops of a real engine running at
 * a few speeds (engineLoops.ts), the two nearest the engine's speed cross-
 * faded and each played a little faster or slower to meet it
 * (soundModel.engineLoopMix). Load and revs lift it and open a low-pass;
 * coasting it is softer and muffled (soundModel.engineTone). Silent until
 * play() is given the loops.
 *
 * `update()` only moves parameters and allocates nothing.
 */
export class EngineSound {
  private readonly mix: GainNode;
  private readonly brightness: BiquadFilterNode;
  private readonly level: GainNode;
  private readonly tone = createEngineTone();
  private voices: readonly Voice[] = [];
  private loopRpms: readonly number[] = [];
  private loopMix = createEngineLoopMix(0);

  constructor(
    private readonly context: BaseAudioContext,
    destination: AudioNode,
  ) {
    this.mix = context.createGain();
    this.brightness = context.createBiquadFilter();
    this.brightness.type = 'lowpass';
    this.brightness.Q.value = 0.5;
    this.level = context.createGain();
    this.level.gain.value = 0;
    this.mix.connect(this.brightness).connect(this.level).connect(destination);
  }

  /** Starts the loops, silent until update() turns them up. Only the first call counts. */
  play(loops: readonly EngineLoop[]): void {
    if (this.voices.length > 0 || loops.length === 0) {
      return;
    }
    const rising = [...loops].sort((a, b) => a.rpm - b.rpm);
    this.voices = rising.map((loop, index) => {
      const source = this.context.createBufferSource();
      source.buffer = loop.buffer;
      source.loop = true;
      source.loopStart = 0;
      source.loopEnd = loop.seconds;
      const level = this.context.createGain();
      level.gain.value = 0;
      source.connect(level).connect(this.mix);
      // Each from its own place, so no two loops pass the same moment of the recording together.
      source.start(0, (index * 0.37 * loop.seconds) % loop.seconds);
      return { source, level };
    });
    this.loopRpms = rising.map((loop) => loop.rpm);
    this.loopMix = createEngineLoopMix(rising.length);
  }

  /**
   * Per frame: the engine at `rpm` working at `load` (0..1), for an engine
   * that idles at `idleRpm` and revs to `maxRpm`; silent unless `audible`.
   * Allocation-free.
   */
  update(audible: boolean, rpm: number, load: number, idleRpm: number, maxRpm: number, now: number): void {
    const tone = engineTone(this.tone, rpm, load, idleRpm, maxRpm);
    follow(this.brightness.frequency, tone.cutoff, now);
    follow(this.level.gain, audible ? tone.gain * ENGINE_VOLUME : 0, now);
    const mix = engineLoopMix(this.loopMix, rpm, this.loopRpms);
    for (let index = 0; index < this.voices.length; index++) {
      const voice = this.voices[index]!;
      follow(voice.level.gain, mix.gains[index]!, now);
      follow(voice.source.playbackRate, mix.rates[index]!, now);
    }
  }
}

/** Moves a parameter smoothly toward `value`. */
function follow(parameter: AudioParam, value: number, now: number): void {
  parameter.setTargetAtTime(value, now, SMOOTHING_SECONDS);
}
