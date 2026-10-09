import { SeededRandom } from '../../core/random/SeededRandom';
import { COASTING, createEngineTone, engineTone, exhaustHarmonics, knockHarmonics, PULLING } from './soundModel';

const ENGINE_VOLUME = 0.33;
const CLATTER_VOLUME = 0.55;
const TURBO_VOLUME = 0.025;
/** Harmonics of the engine cycle in its waves: up to about 3 kHz at idle, where a cycle is 5–6 a second. */
const VOICE_HARMONICS = 640;
const KNOCK_HARMONICS = 256;
/** Each voice's RMS level: coasting, the engine only pushes air and is quieter. */
const PULLING_RMS = 0.25;
const COASTING_RMS = 0.17;
/** The knock lasts this share of the cycle: about 3 ms at idle. */
const KNOCK_WIDTH = 0.02;
/** Seconds for a level to settle: quick enough to follow the pedal, slow enough not to click. */
const SMOOTHING_SECONDS = 0.06;
/** The turbo takes its time to spin up, and slows a little quicker. */
const SPOOL_UP_SECONDS = 0.8;
const SPOOL_DOWN_SECONDS = 0.35;
/**
 * The exhaust pipe: the sound runs to its open end and back in this many
 * seconds and returns inverted, this much of it, losing its highs on the way.
 * Its resonances (about 83, 250 and 420 Hz) stay put while the revs sweep
 * through them, as a real pipe's do.
 */
const PIPE_ECHO_SECONDS = 0.006;
const PIPE_ECHO = -0.3;
const PIPE_DAMPING_HZ = 800;
/** No engine runs perfectly even: its speed wanders (cents), its strength trembles cycle to cycle and breathes (shares). */
const WANDER_CENTS = 8;
const TREMBLE = 0.12;
const BREATH = 0.05;
/** The slow random signal those come from: seconds long, samples a second, and turning points a second. */
const JITTER_SECONDS = 4;
const JITTER_SAMPLE_RATE = 8000;
const JITTER_TURNS_PER_SECOND = 16;

/**
 * A six-cylinder diesel truck engine, made in Web Audio from what makes one
 * sound the way it does:
 *
 * - its voice: one cycle of the exhaust's six pulses as a wave (PeriodicWave,
 *   band-limited by the browser), at the engine's cycle rate, so the firing
 *   note comes with the small differences between the cylinders that give a
 *   diesel its uneven beat. One wave burning fuel and one coasting,
 *   phase-locked and mixed by how much it burns (soundModel.exhaustHarmonics,
 *   engineTone);
 * - its life: the speed wanders a little, the strength trembles from cycle to
 *   cycle and breathes slowly (a smooth random signal on the waves' detune
 *   and on a gain);
 * - its body: a low boom and a growl, the exhaust pipe's echo (a feedback
 *   delay whose resonances stay put while the revs sweep through them), a
 *   low-pass that the load opens, and a softened top;
 * - its clatter: noise in the knock's band, let through by short pulses in
 *   time with the firing (soundModel.knockHarmonics), loudest labouring at
 *   low revs and silent coasting;
 * - its turbo: a soft whistle, spinning up under boost with a lag.
 *
 * `update()` only moves parameters and allocates nothing.
 */
export class EngineSound {
  private readonly pulling: OscillatorNode;
  private readonly coasting: OscillatorNode;
  private readonly knock: OscillatorNode;
  private readonly pullingLevel: GainNode;
  private readonly coastingLevel: GainNode;
  private readonly brightness: BiquadFilterNode;
  private readonly clatter: GainNode;
  private readonly turbo: OscillatorNode;
  private readonly turboHiss: BiquadFilterNode;
  private readonly turboLevel: GainNode;
  private readonly level: GainNode;
  private readonly tone = createEngineTone();
  private turboTarget = 0;

  /** Plays into `destination`; `noise` is a loop of white noise (seconds of it) for the clatter and the turbo. */
  constructor(context: BaseAudioContext, destination: AudioNode, noise: AudioBuffer) {
    const gain = (value: number): GainNode => {
      const node = context.createGain();
      node.gain.value = value;
      return node;
    };
    const filter = (type: BiquadFilterType, frequency: number, q: number, dB = 0): BiquadFilterNode => {
      const node = context.createBiquadFilter();
      node.type = type;
      node.frequency.value = frequency;
      node.Q.value = q;
      node.gain.value = dB;
      return node;
    };
    const loop = (buffer: AudioBuffer, rate: number, offset: number): AudioBufferSourceNode => {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.playbackRate.value = rate;
      source.start(0, offset % buffer.duration);
      return source;
    };
    const wave = (real: Float32Array, imag: Float32Array): OscillatorNode => {
      const oscillator = context.createOscillator();
      oscillator.setPeriodicWave(context.createPeriodicWave(real, imag, { disableNormalization: true }));
      oscillator.frequency.value = 0;
      return oscillator;
    };

    const pullingWave = exhaustHarmonics(PULLING, VOICE_HARMONICS, 61, PULLING_RMS);
    const coastingWave = exhaustHarmonics(COASTING, VOICE_HARMONICS, 61, COASTING_RMS);
    const knockTiming = knockHarmonics(KNOCK_HARMONICS, KNOCK_WIDTH, 61);
    this.pulling = wave(pullingWave.real, pullingWave.imag);
    this.coasting = wave(coastingWave.real, coastingWave.imag);
    this.knock = wave(knockTiming.real, knockTiming.imag);
    this.level = gain(0);
    this.level.connect(destination);

    // Its life: one smooth random signal, read at three speeds.
    const jitter = jitterBuffer(context);
    const wander = gain(WANDER_CENTS);
    loop(jitter, 1, 0).connect(wander);
    wander.connect(this.pulling.detune);
    wander.connect(this.coasting.detune);
    wander.connect(this.knock.detune);
    const tremble = gain(1);
    loop(jitter, 4, 1.3).connect(gain(TREMBLE)).connect(tremble.gain);
    loop(jitter, 0.3, 2.9).connect(gain(BREATH)).connect(tremble.gain);

    // Its voice, through its body.
    this.pullingLevel = gain(0);
    this.coastingLevel = gain(0);
    this.pulling.connect(this.pullingLevel).connect(tremble);
    this.coasting.connect(this.coastingLevel).connect(tremble);
    const pipe = gain(1);
    const echo = context.createDelay(0.05);
    echo.delayTime.value = PIPE_ECHO_SECONDS;
    pipe.connect(echo).connect(filter('lowpass', PIPE_DAMPING_HZ, 0.5)).connect(gain(PIPE_ECHO)).connect(pipe);
    this.brightness = filter('lowpass', 1000, 0.6);
    tremble
      .connect(filter('peaking', 75, 0.9, 4))
      .connect(filter('peaking', 210, 0.8, 3))
      // A warm body where a phone's speaker plays: the band it can carry, with the buzz above it cut.
      .connect(filter('peaking', 440, 0.9, 4))
      .connect(pipe)
      .connect(this.brightness)
      .connect(filter('highshelf', 1500, 0.7, -14))
      .connect(this.level);

    // Its clatter: the knock's band of noise, let through as each cylinder fires.
    const knockGate = gain(knockTiming.mean);
    this.knock.connect(knockGate.gain);
    this.clatter = gain(0);
    loop(noise, 1, 0.37)
      .connect(filter('bandpass', 1000, 0.9))
      .connect(filter('lowpass', 1800, 0.7))
      .connect(knockGate)
      .connect(this.clatter)
      .connect(this.level);

    // Its turbo: a soft whistle with a breath of air round it.
    this.turbo = context.createOscillator();
    this.turbo.frequency.value = 1600;
    this.turboHiss = filter('bandpass', 900, 4);
    this.turboLevel = gain(0);
    this.turbo.connect(gain(0.25)).connect(this.turboLevel);
    loop(noise, 1, 1.21).connect(this.turboHiss).connect(gain(1.5)).connect(this.turboLevel);
    this.turboLevel.connect(this.level);

    this.pulling.start();
    this.coasting.start();
    this.knock.start();
    this.turbo.start();
  }

  /**
   * Per frame: the engine at `rpm` working at `load` (0..1), for an engine
   * that idles at `idleRpm` and revs to `maxRpm`; silent unless `audible`.
   * Allocation-free.
   */
  update(audible: boolean, rpm: number, load: number, idleRpm: number, maxRpm: number, now: number): void {
    const tone = engineTone(this.tone, rpm, load, idleRpm, maxRpm);
    follow(this.pulling.frequency, tone.cycleHz, now);
    follow(this.coasting.frequency, tone.cycleHz, now);
    follow(this.knock.frequency, tone.cycleHz, now);
    follow(this.pullingLevel.gain, tone.pull, now);
    follow(this.coastingLevel.gain, 1 - tone.pull, now);
    follow(this.brightness.frequency, tone.cutoff, now);
    follow(this.clatter.gain, tone.clatter * CLATTER_VOLUME, now);
    const turbo = tone.turbo * TURBO_VOLUME;
    const spool = turbo > this.turboTarget ? SPOOL_UP_SECONDS : SPOOL_DOWN_SECONDS;
    this.turboTarget = turbo;
    this.turboLevel.gain.setTargetAtTime(turbo, now, spool);
    this.turbo.frequency.setTargetAtTime(tone.turboHz, now, spool);
    this.turboHiss.frequency.setTargetAtTime(tone.turboHz, now, spool);
    follow(this.level.gain, audible ? tone.gain * ENGINE_VOLUME : 0, now);
  }
}

/** Moves a parameter smoothly toward `value`. */
function follow(parameter: AudioParam, value: number, now: number): void {
  parameter.setTargetAtTime(value, now, SMOOTHING_SECONDS);
}

/** A smooth random signal between −1 and 1 that loops seamlessly, the same every time (seeded). */
function jitterBuffer(context: BaseAudioContext): AudioBuffer {
  const length = JITTER_SECONDS * JITTER_SAMPLE_RATE;
  const buffer = context.createBuffer(1, length, JITTER_SAMPLE_RATE);
  const samples = buffer.getChannelData(0);
  const random = new SeededRandom(53);
  const turns = JITTER_SECONDS * JITTER_TURNS_PER_SECOND;
  const values = new Float32Array(turns);
  for (let turn = 0; turn < turns; turn++) {
    values[turn] = random.range(-1, 1);
  }
  for (let i = 0; i < length; i++) {
    const at = (i / length) * turns;
    const turn = Math.floor(at);
    const from = values[turn % turns]!;
    const to = values[(turn + 1) % turns]!;
    samples[i] = from + ((to - from) * (1 - Math.cos(Math.PI * (at - turn)))) / 2;
  }
  return buffer;
}
