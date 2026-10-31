// The trailer's music, synthesised here from arithmetic alone: no samples, nothing licensed, no melody borrowed from
// any song (spec §85). A 128 BPM drive on the trailer's sixteen bars (timeline.mjs): an A minor verse (Am F C G) that
// lifts into C major for the chorus (F C Am G), a six-note hook (E G A G E D, answered E D C) that is heard small on a
// bell in the loop and big on the lead in the lift, three stabs for the finale's words and a held C chord under the
// brand.
//
// The music leaves room for the game's own sounds the cut lays over it: the cold open's air horn (the middle thins
// for a second), the montage's thunder (the bass and the kick step aside), and the air brakes and C-E-G chime of the
// delivery (a quiet C major there, nothing else in the middle).
//
// music() returns 48 kHz stereo at a sane level (about -14 LUFS, true peak under -1.5 dBTP); the cut mixes the
// game's sounds over it and ffmpeg brings the whole to the store's loudness.
import { BAR, BEAT, DURATION, HITS, SECTIONS, beat } from './timeline.mjs';

export const SAMPLE_RATE = 48000;
const TAU = Math.PI * 2;
const LENGTH = Math.round(DURATION * SAMPLE_RATE);
const SIXTEENTH = BEAT / 4;

/**
 * What the picture can sync to, in seconds: the timeline's HITS (the horn's pocket, the drop, the finale's three hits,
 * the brand's impact) and the other pockets and sections the music is built on.
 */
export const CUES = Object.freeze({
  /** The air horn of the cold open: the music's middle dips from here for about a second. */
  horn: beat(HITS.horn),
  /** The drop: kick, clap, crash and a sub boom. */
  drop: beat(HITS.drop),
  /** The finale's three hits: a chord stab, a kick, a clap and an impact each. */
  finale: Object.freeze(HITS.finale.map(beat)),
  /** The brand's impact, then the held chord to the end. */
  brand: beat(HITS.brand),
  /** Where the bass and the kick step aside for the montage's thunder (beats 28 to 29.5). */
  thunder: Object.freeze([beat(28), beat(29.5)]),
  /** The delivery's pocket: a quiet C major under the air brakes and the chime (beats 32 to 34). */
  deliver: Object.freeze([beat(32), beat(34)]),
  /** The start of each section, by id. */
  sections: Object.freeze(Object.fromEntries(SECTIONS.map((section) => [section.id, beat(section.from)]))),
});

// ---- Tools ----

/** A seeded noise source (mulberry32), -1..1: the same music every render. */
function noiseSource(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

const hz = (note) => 440 * 2 ** ((note - 69) / 12);
const fromDb = (decibels) => 10 ** (decibels / 20);
const toDb = (value) => 20 * Math.log10(Math.max(value, 1e-12));
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (x) => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};

/** 0 before `a`, up to 1 by `b`, held to `c`, down to 0 by `d` (smooth ramps): the shape of a pocket. */
const pocket = (t, a, b, c, d) => (t < b ? smoothstep((t - a) / (b - a)) : t < c ? 1 : 1 - smoothstep((t - c) / (d - c)));

/**
 * A note's level at `t`: up in `attack`, then down toward `sustain` (over `decay`, 0 for none), and after `gate` a
 * release that reaches exactly 0 at `gate + release`, so no note ever ends in a click.
 */
function envelope(t, gate, attack, decay, sustain, release) {
  let level = t < attack ? t / attack : decay > 0 ? sustain + (1 - sustain) * Math.exp(-(t - attack) / decay) : 1;
  if (t > gate) {
    const left = 1 - (t - gate) / release;
    level *= left > 0 ? left * left : 0;
  }
  return level;
}

/**
 * The PolyBLEP correction for a saw's jump at phase 0 (`dt` the phase step a sample): subtracted from the naive saw,
 * it rounds off the step so the harmonics past Nyquist don't fold back down as a hiss of aliases.
 */
function blep(phase, dt) {
  if (phase < dt) {
    const x = phase / dt;
    return x + x - x * x - 1;
  }
  if (phase > 1 - dt) {
    const x = (phase - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

/** A band-limited saw from its phase (0..1) and phase step. */
const saw = (phase, dt) => 2 * phase - 1 - blep(phase, dt);

/**
 * A state-variable filter in the trapezoidal (zero-delay feedback) form: stable at any cutoff and resonance, with
 * the low, band and high pass from one state.
 */
class Svf {
  constructor() {
    this.ic1 = 0;
    this.ic2 = 0;
    this.low = 0;
    this.band = 0;
    this.high = 0;
    this.tune(1000, 0.7);
  }

  tune(cutoffHz, q) {
    const g = Math.tan((Math.PI * Math.min(cutoffHz, SAMPLE_RATE * 0.45)) / SAMPLE_RATE);
    this.k = 1 / q;
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
    return this;
  }

  /** Filters one sample; returns the low pass (the band and high pass are left on the filter). */
  run(input) {
    const v3 = input - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.low = v2;
    this.band = v1;
    this.high = input - this.k * v1 - v2;
    return v2;
  }
}

/** A biquad (the Audio EQ Cookbook's), for the buses' and the master's EQ. */
class Biquad {
  constructor(b0, b1, b2, a1, a2) {
    Object.assign(this, { b0, b1, b2, a1, a2 });
  }

  static of(type, frequency, q = Math.SQRT1_2, gainDb = 0) {
    const w = (TAU * frequency) / SAMPLE_RATE;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a = 10 ** (gainDb / 40);
    const shelf = 2 * Math.sqrt(a) * alpha;
    const [b0, b1, b2, a0, a1, a2] = {
      lowpass: [(1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha],
      highpass: [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha],
      peak: [1 + alpha * a, -2 * cos, 1 - alpha * a, 1 + alpha / a, -2 * cos, 1 - alpha / a],
      highshelf: [
        a * (a + 1 + (a - 1) * cos + shelf),
        -2 * a * (a - 1 + (a + 1) * cos),
        a * (a + 1 + (a - 1) * cos - shelf),
        a + 1 - (a - 1) * cos + shelf,
        2 * (a - 1 - (a + 1) * cos),
        a + 1 - (a - 1) * cos - shelf,
      ],
    }[type];
    return new Biquad(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
  }

  /** Filters `channel` in place (transposed direct form II; the state lives in the call, so a stage is reusable). */
  apply(channel) {
    const { b0, b1, b2, a1, a2 } = this;
    let z1 = 0;
    let z2 = 0;
    for (let i = 0; i < channel.length; i++) {
      const x = channel[i];
      const y = b0 * x + z1;
      z1 = b1 * x - a1 * y + z2;
      z2 = b2 * x - a2 * y;
      channel[i] = y;
    }
    return channel;
  }
}

/** Runs a chain of biquads over both channels of a bus, in place. */
function equalise(bus, ...stages) {
  for (const channel of [bus.left, bus.right]) {
    for (const stage of stages) {
      stage.apply(channel);
    }
  }
  return bus;
}

/** A stereo bus the voices write into: the whole 30 seconds. */
class Bus {
  constructor() {
    this.left = new Float32Array(LENGTH);
    this.right = new Float32Array(LENGTH);
  }

  /** Writes mono `render(time since start)` for `seconds` from `start`, panned (-1 left .. 1 right, or a function of time). */
  add(start, seconds, pan, render) {
    const first = Math.max(0, Math.round(start * SAMPLE_RATE));
    const last = Math.min(LENGTH, Math.round((start + seconds) * SAMPLE_RATE));
    const fixed = typeof pan === 'number';
    let gainLeft = Math.cos(((fixed ? pan : 0) + 1) * (Math.PI / 4));
    let gainRight = Math.sin(((fixed ? pan : 0) + 1) * (Math.PI / 4));
    for (let i = first; i < last; i++) {
      const t = i / SAMPLE_RATE - start;
      const value = render(t);
      if (!fixed) {
        const p = pan(t);
        gainLeft = Math.cos((p + 1) * (Math.PI / 4));
        gainRight = Math.sin((p + 1) * (Math.PI / 4));
      }
      this.left[i] += value * gainLeft;
      this.right[i] += value * gainRight;
    }
  }

  /** Writes stereo `render(time since start, frame)` (which sets `frame.left` and `frame.right`) for `seconds` from `start`. */
  addStereo(start, seconds, render) {
    const first = Math.max(0, Math.round(start * SAMPLE_RATE));
    const last = Math.min(LENGTH, Math.round((start + seconds) * SAMPLE_RATE));
    const frame = { left: 0, right: 0 };
    for (let i = first; i < last; i++) {
      render(i / SAMPLE_RATE - start, frame);
      this.left[i] += frame.left;
      this.right[i] += frame.right;
    }
  }
}

/**
 * One render's buses and state: the drums (never ducked), the ducked music (pads, bass, lead), the effects, the two
 * sends (the hall and the echo), the kicks the sidechain pumps on, and the seeded noise.
 */
class Session {
  constructor() {
    this.random = noiseSource(0x524f4144);
    this.drums = new Bus();
    this.pads = new Bus();
    this.bass = new Bus();
    this.lead = new Bus();
    this.fx = new Bus();
    this.hall = new Bus();
    this.echo = new Bus();
    /** [time, depth] of every kick the music pumps to. */
    this.kicks = [];
  }

  /** Adds a stereo frame to the hall and echo sends at sample `i`. */
  send(i, left, right, hall, echo) {
    if (hall) {
      this.hall.left[i] += left * hall;
      this.hall.right[i] += right * hall;
    }
    if (echo) {
      this.echo.left[i] += left * echo;
      this.echo.right[i] += right * echo;
    }
  }
}

// ---- Instruments ----

/**
 * A stack of detuned band-limited saws per note (a supersaw), spread across the stereo field, through a low pass
 * per side: the pads, the stabs and the plucks. `cutoff(time, t)` gives the filter at the song's time and the note's.
 */
function sawStack(session, bus, start, seconds, notes, options) {
  const {
    gain,
    cutoff,
    voices = 7,
    detune = 0.16,
    width = 0.85,
    attack = 0.01,
    decay = 0,
    sustain = 1,
    release = 0.15,
    q = 0.7,
    hall = 0,
    echo = 0,
  } = options;
  const random = session.random;
  const count = notes.length * voices;
  const phase = new Float64Array(count);
  const step = new Float64Array(count);
  const gainLeft = new Float64Array(count);
  const gainRight = new Float64Array(count);
  let k = 0;
  notes.forEach((note, n) => {
    for (let v = 0; v < voices; v++, k++) {
      const spread = voices === 1 ? 0 : (v / (voices - 1)) * 2 - 1;
      const offset = detune * Math.sign(spread) * Math.abs(spread) ** 1.4 + random() * 0.004;
      step[k] = hz(note + offset) / SAMPLE_RATE;
      phase[k] = (random() + 1) / 2;
      const level = (spread === 0 ? 1 : 0.8) / Math.sqrt(voices);
      const pan = width * spread * (n % 2 ? -1 : 1);
      gainLeft[k] = level * Math.cos((pan + 1) * (Math.PI / 4));
      gainRight[k] = level * Math.sin((pan + 1) * (Math.PI / 4));
    }
  });
  const left = new Svf();
  const right = new Svf();
  const first = Math.max(0, Math.round(start * SAMPLE_RATE));
  const last = Math.min(LENGTH, Math.round((start + seconds + release) * SAMPLE_RATE));
  for (let i = first; i < last; i++) {
    const t = i / SAMPLE_RATE - start;
    if ((i - first) % 16 === 0) {
      const frequency = cutoff(start + t, t);
      left.tune(frequency, q);
      right.tune(frequency, q);
    }
    let l = 0;
    let r = 0;
    for (let j = 0; j < count; j++) {
      let p = phase[j] + step[j];
      if (p >= 1) {
        p -= 1;
      }
      phase[j] = p;
      const s = saw(p, step[j]);
      l += s * gainLeft[j];
      r += s * gainRight[j];
    }
    const level = envelope(t, seconds, attack, decay, sustain, release) * gain;
    const yl = left.run(l) * level;
    const yr = right.run(r) * level;
    bus.left[i] += yl;
    bus.right[i] += yr;
    session.send(i, yl, yr, hall, echo);
  }
}

/** A short plucked note: two saws and a filter that snaps shut. */
function pluck(session, bus, start, note, options) {
  const { gain, pan = 0, decay = 0.16, bright = 4200, hall = 0.15, echo = 0.2 } = options;
  sawStack(session, bus, start, 0.2, [note], {
    gain,
    voices: 2,
    detune: 0.07,
    width: pan,
    attack: 0.002,
    decay,
    sustain: 0,
    release: 0.12,
    q: 0.9,
    cutoff: (time, t) => 600 + bright * Math.exp(-t / 0.05),
    hall,
    echo,
  });
}

/**
 * A glassy FM bell: a carrier modulated at its own frequency (a soft saw-like body that mellows as the index decays)
 * and at four times it (a short bright tine).
 */
function bell(session, bus, start, note, options) {
  const { gain, pan = 0, decay = 0.8, seconds = 1.8, bright = 1, hall = 0.3, echo = 0.35 } = options;
  const step = hz(note) / SAMPLE_RATE;
  let carrier = 0;
  let tine = 0;
  const first = Math.max(0, Math.round(start * SAMPLE_RATE));
  const last = Math.min(LENGTH, Math.round((start + seconds) * SAMPLE_RATE));
  const gainLeft = Math.cos((pan + 1) * (Math.PI / 4));
  const gainRight = Math.sin((pan + 1) * (Math.PI / 4));
  for (let i = first; i < last; i++) {
    const t = i / SAMPLE_RATE - start;
    carrier = (carrier + step) % 1;
    tine = (tine + step * 4) % 1;
    const body = (0.35 + 1.3 * Math.exp(-t / 0.22)) * bright;
    const shine = 0.9 * Math.exp(-t / 0.035) * bright;
    const value =
      Math.sin(TAU * carrier + body * Math.sin(TAU * carrier) + shine * Math.sin(TAU * tine)) *
      Math.min(1, t / 0.003) *
      Math.exp(-t / decay) *
      Math.min(1, (seconds - t) / 0.08) *
      gain;
    bus.left[i] += value * gainLeft;
    bus.right[i] += value * gainRight;
    session.send(i, value * gainLeft, value * gainRight, hall, echo);
  }
}

/**
 * The lead: a monophonic line of three detuned saws and a sine an octave down, gliding from note to note, with a
 * filter that opens on each note and a vibrato that grows into the held ones. `notes` are [{ time, length, note }].
 */
function lead(session, bus, notes, options) {
  const { gain, cutoff = 2200, open = 3200, glide = 0.035, vibrato = 0.13, hall = 0.25, echo = 0.28 } = options;
  const start = notes[0].time;
  const end = notes.at(-1).time + notes.at(-1).length + 0.5;
  const glideStep = 1 - Math.exp(-1 / (glide * SAMPLE_RATE));
  const rise = 1 - Math.exp(-1 / (0.004 * SAMPLE_RATE));
  const fall = 1 - Math.exp(-1 / (0.07 * SAMPLE_RATE));
  const phases = [0, 0.31, 0.67, 0];
  const s = [0, 0, 0, 0];
  const detunes = [-0.07, 0, 0.07, -12];
  const left = new Svf();
  const right = new Svf();
  let pitch = notes[0].note;
  let level = 0;
  let index = 0;
  const first = Math.round(start * SAMPLE_RATE);
  const last = Math.min(LENGTH, Math.round(end * SAMPLE_RATE));
  for (let i = first; i < last; i++) {
    const time = i / SAMPLE_RATE;
    while (index + 1 < notes.length && time >= notes[index + 1].time) {
      index++;
    }
    const note = notes[index];
    const since = time - note.time;
    pitch += (note.note - pitch) * glideStep;
    const wobble = vibrato * smoothstep((since - 0.2) / 0.35) * Math.sin(TAU * 5.3 * since);
    const target = since < note.length ? 0.82 + 0.18 * Math.exp(-since / 0.12) : 0;
    level += (target - level) * (target > level ? rise : fall);
    if ((i - first) % 8 === 0) {
      const frequency = cutoff + open * Math.exp(-since / 0.18);
      left.tune(frequency, 0.85);
      right.tune(frequency, 0.85);
    }
    for (let o = 0; o < 4; o++) {
      const dt = hz(pitch + wobble + detunes[o]) / SAMPLE_RATE;
      phases[o] = (phases[o] + dt) % 1;
      s[o] = o === 3 ? Math.sin(TAU * phases[o]) : saw(phases[o], dt);
    }
    const yl = Math.tanh(left.run(s[0] * 0.75 + s[1] * 0.55 + s[3] * 0.35) * 1.2) * level * gain;
    const yr = Math.tanh(right.run(s[2] * 0.75 + s[1] * 0.55 + s[3] * 0.35) * 1.2) * level * gain;
    bus.left[i] += yl;
    bus.right[i] += yr;
    session.send(i, yl, yr, hall, echo);
  }
}

/** The sub: a sine with a touch of drive (a third harmonic, so a phone's speaker hears where the low end is). */
function sub(session, start, seconds, note, gain, { attack = 0.008, release = 0.06 } = {}) {
  const step = hz(note) / SAMPLE_RATE;
  let phase = 0;
  const drive = Math.tanh(1.5);
  session.bass.add(start, seconds + release, 0, (t) => {
    phase = (phase + step) % 1;
    return (Math.tanh(1.5 * Math.sin(TAU * phase)) / drive) * envelope(t, seconds, attack, 0, 1, release) * gain;
  });
}

/** The mid bass: two saws an octave over the sub through a low pass that snaps from bright to round on each note. */
function midBass(session, start, seconds, note, gain, { cutoff = 420, open = 1300, decay = 0.07 } = {}) {
  const step = hz(note) / SAMPLE_RATE;
  const stepUp = step * 1.004;
  let a = 0;
  let b = 0.5;
  const filter = new Svf();
  session.bass.add(start, seconds + 0.03, 0, (t) => {
    a = (a + step) % 1;
    b = (b + stepUp) % 1;
    filter.tune(cutoff + open * Math.exp(-t / decay), 1.1);
    const y = filter.run((saw(a, step) + saw(b, stepUp)) * 0.5);
    return Math.tanh(y * 1.6) * envelope(t, seconds, 0.003, 0, 1, 0.03) * gain;
  });
}

// ---- Drums and effects ----

/**
 * The kick: a sine that drops from a click-bright 300 Hz to 50 Hz, a short noise click on top, gently saturated.
 * `muffle` puts it behind a wall (a low pass at that frequency); `pump` is how hard it ducks the music.
 */
function kick(session, time, gain, { muffle = 0, pump = 1 } = {}) {
  const seconds = 0.45;
  const random = session.random;
  const click = new Svf().tune(2600, 0.7);
  const wall = new Svf().tune(muffle || 20000, 0.7);
  const drive = Math.tanh(1.8);
  let phase = 0;
  session.drums.add(time, seconds, 0, (t) => {
    phase += (50 + 95 * Math.exp(-t / 0.045) + 160 * Math.exp(-t / 0.006)) / SAMPLE_RATE;
    const level = Math.min(1, t / 0.0005) * (t < 0.04 ? 1 : Math.exp(-(t - 0.04) / 0.14)) * Math.min(1, (seconds - t) / 0.04);
    click.run(random());
    const out = Math.tanh(1.8 * (Math.sin(TAU * phase) * level + click.high * Math.exp(-t / 0.003) * 0.45)) / drive;
    return (muffle ? wall.run(out) * 1.15 : out) * gain;
  });
  if (pump) {
    session.kicks.push([time, pump]);
  }
}

/** The snare: a tuned body that drops a little and a bright noise rattle. */
function snare(session, time, gain, { hall = 0.18 } = {}) {
  const seconds = 0.35;
  const random = session.random;
  const rattle = new Svf().tune(1900, 0.6);
  const top = new Svf().tune(9500, 0.7);
  let phase = 0;
  const first = Math.round(time * SAMPLE_RATE);
  session.drums.add(time, seconds, 0, (t) => {
    phase += (185 + 90 * Math.exp(-t / 0.012)) / SAMPLE_RATE;
    const body = Math.sin(TAU * phase) * Math.exp(-t / 0.06) * 0.55;
    rattle.run(random());
    const noise = top.run(rattle.high) * Math.exp(-t / 0.13);
    const out = Math.tanh((body + noise) * Math.min(1, t / 0.0008) * Math.min(1, (seconds - t) / 0.03) * 1.3) * gain;
    const i = first + Math.round(t * SAMPLE_RATE);
    if (i < LENGTH) {
      session.send(i, out * 0.7, out * 0.7, hall, 0);
    }
    return out;
  });
}

/** The clap: three quick bursts of band-passed noise and a short tail, different noise each side (wide). */
function clap(session, time, gain, { hall = 0.28 } = {}) {
  const seconds = 0.4;
  const random = session.random;
  const bands = [new Svf().tune(1250, 1.3), new Svf().tune(1350, 1.3)];
  const first = Math.round(time * SAMPLE_RATE);
  session.drums.addStereo(time, seconds, (t, frame) => {
    let bursts = 0;
    for (const at of [0, 0.01, 0.021]) {
      if (t >= at) {
        bursts += Math.exp(-(t - at) / 0.0045);
      }
    }
    const tail = t >= 0.021 ? Math.exp(-(t - 0.021) / 0.1) : 0;
    const level = (bursts * 0.7 + tail) * Math.min(1, (seconds - t) / 0.03) * gain;
    bands[0].run(random());
    bands[1].run(random());
    frame.left = bands[0].band * level;
    frame.right = bands[1].band * level;
    const i = first + Math.round(t * SAMPLE_RATE);
    if (i < LENGTH) {
      session.send(i, frame.left, frame.right, hall, 0);
    }
  });
}

/** A hi-hat (closed, or open with a long `decay`): high-passed noise with a ring around 10 kHz. */
function hat(session, time, gain, { decay = 0.03, pan = 0.2, tone = 7600 } = {}) {
  const seconds = Math.min(0.8, decay * 7);
  const random = session.random;
  const high = new Svf().tune(tone, 0.7);
  const ring = new Svf().tune(10500, 2.2);
  session.drums.add(time, seconds, pan, (t) => {
    high.run(random());
    ring.run(high.high);
    const level = Math.min(1, t / 0.0004) * Math.exp(-t / decay) * Math.min(1, (seconds - t) / 0.02);
    return (high.high * 0.6 + ring.band * 0.7) * level * gain;
  });
}

/** A shaker: a soft swish of band-passed noise. */
function shaker(session, time, gain, pan) {
  const random = session.random;
  const band = new Svf().tune(6800, 1.4);
  session.drums.add(time, 0.12, pan, (t) => {
    band.run(random());
    return band.band * Math.min(1, t / 0.006) * Math.exp(-t / 0.028) * Math.min(1, (0.12 - t) / 0.02) * gain;
  });
}

/** A crash: wide, high-passed noise with a bright band, a quick bloom and a long fade. */
function crash(session, time, gain, seconds = 2.4) {
  const random = session.random;
  const highs = [new Svf().tune(4300, 0.7), new Svf().tune(4500, 0.7)];
  const rings = [new Svf().tune(7200, 1.6), new Svf().tune(8100, 1.6)];
  const first = Math.round(time * SAMPLE_RATE);
  session.fx.addStereo(time, seconds, (t, frame) => {
    const level =
      Math.min(1, t / 0.0015) *
      (0.5 * Math.exp(-t / 0.15) + 0.5 * Math.exp(-t / (seconds * 0.32))) *
      Math.min(1, (seconds - t) / 0.1) *
      gain;
    const sides = [0, 0];
    for (let s = 0; s < 2; s++) {
      highs[s].run(random());
      rings[s].run(highs[s].high);
      sides[s] = (highs[s].high * 0.65 + rings[s].band * 0.5) * level;
    }
    frame.left = sides[0];
    frame.right = sides[1];
    const i = first + Math.round(t * SAMPLE_RATE);
    if (i < LENGTH) {
      session.send(i, frame.left, frame.right, 0.12, 0);
    }
  });
}

/** A noise riser that sweeps up and widens into `end`, with a soft sine sweep under it. */
function riser(session, end, seconds, gain) {
  const random = session.random;
  const bands = [new Svf(), new Svf()];
  let phase = 0;
  session.fx.addStereo(end - seconds, seconds, (t, frame) => {
    const p = t / seconds;
    const frequency = 350 * (9000 / 350) ** p;
    const level = p * p * p * Math.min(1, (seconds - t) / 0.012) * gain;
    phase += (180 * 8 ** p) / SAMPLE_RATE;
    const tone = Math.sin(TAU * phase) * 0.12;
    const width = 0.2 + 0.8 * p;
    const shared = random();
    for (let s = 0; s < 2; s++) {
      bands[s].tune(frequency * (s ? 1.06 : 1), 2.2);
      bands[s].run(shared * (1 - width) + random() * width);
    }
    frame.left = (bands[0].band + tone) * level;
    frame.right = (bands[1].band + tone) * level;
  });
}

/** A reversed cymbal swelling into `end` (it stops dead there, under the hit). */
function swell(session, end, seconds, gain) {
  const random = session.random;
  const highs = [new Svf().tune(3800, 0.7), new Svf().tune(4100, 0.7)];
  session.fx.addStereo(end - seconds, seconds, (t, frame) => {
    const p = t / seconds;
    const level = p ** 4 * Math.min(1, (seconds - t) / 0.006) * Math.min(1, t / 0.01) * gain;
    highs[0].run(random());
    highs[1].run(random());
    frame.left = highs[0].high * level;
    frame.right = highs[1].high * level;
  });
}

/** A noise sweep falling away after a hit. */
function downlifter(session, time, seconds, gain) {
  const random = session.random;
  const bands = [new Svf(), new Svf()];
  session.fx.addStereo(time, seconds, (t, frame) => {
    const p = t / seconds;
    const frequency = 7000 * (250 / 7000) ** p;
    const level = (1 - p) ** 2 * Math.min(1, t / 0.02) * gain;
    for (let s = 0; s < 2; s++) {
      bands[s].tune(frequency * (s ? 1.08 : 1), 1.6);
      bands[s].run(random());
    }
    frame.left = bands[0].band * level;
    frame.right = bands[1].band * level;
  });
}

/** An impact's low end: a sine falling from 85 to 40 Hz with a soft thump of low noise. */
function boom(session, time, gain, seconds = 1.6) {
  const random = session.random;
  const thump = new Svf().tune(160, 0.7);
  const drive = Math.tanh(1.4);
  let phase = 0;
  session.fx.add(time, seconds, 0, (t) => {
    phase += (40 + 45 * Math.exp(-t / 0.2)) / SAMPLE_RATE;
    const body = Math.sin(TAU * phase) * Math.exp(-t / (seconds * 0.33));
    const noise = thump.run(random()) * Math.exp(-t / 0.05) * 1.5;
    return (Math.tanh(1.4 * (body + noise)) / drive) * Math.min(1, t / 0.002) * Math.min(1, (seconds - t) / 0.1) * gain;
  });
}

// ---- Space ----

/**
 * The hall: a feedback delay network of eight lines (23 to 62 ms) mixed by a Hadamard matrix, with a low pass in
 * each line (the highs die first, as in a room), a pre-delay and two all-pass diffusers a side in front. Its input
 * is band-limited (250 Hz to 9 kHz) so the room never muddies the bass or fizzes.
 */
function hallReverb(send, { seconds = 2.1, preDelay = 0.024, dampHz = 5200 } = {}) {
  const out = new Bus();
  const input = { left: Float32Array.from(send.left), right: Float32Array.from(send.right) };
  equalise(input, Biquad.of('highpass', 250), Biquad.of('lowpass', 9000));
  const lengths = [1123, 1381, 1607, 1867, 2131, 2399, 2647, 2953];
  const lines = lengths.map((length) => new Float32Array(length));
  const index = new Int32Array(8);
  const feedback = lengths.map((length) => 10 ** ((-3 * length) / (seconds * SAMPLE_RATE)));
  const damp = Math.exp((-TAU * dampHz) / SAMPLE_RATE);
  const lows = new Float64Array(8);
  const read = new Float64Array(8);
  const mix = new Float64Array(8);
  const pre = Math.round(preDelay * SAMPLE_RATE);
  const diffusers = [
    [142, 379, 107, 277],
    [151, 397, 113, 263],
  ].map((side) => side.map((length) => ({ buffer: new Float32Array(length), index: 0 })));
  const diffuse = (passes, x) => {
    let value = x;
    for (const pass of passes) {
      const delayed = pass.buffer[pass.index];
      const y = delayed - 0.6 * value;
      pass.buffer[pass.index] = value + 0.6 * y;
      pass.index = (pass.index + 1) % pass.buffer.length;
      value = y;
    }
    return value;
  };
  const norm = 1 / Math.sqrt(8);
  for (let i = 0; i < LENGTH; i++) {
    const inLeft = diffuse(diffusers[0], i >= pre ? input.left[i - pre] : 0);
    const inRight = diffuse(diffusers[1], i >= pre ? input.right[i - pre] : 0);
    for (let k = 0; k < 8; k++) {
      const d = lines[k][index[k]];
      read[k] = d;
      lows[k] = d + (lows[k] - d) * damp;
      mix[k] = lows[k] * feedback[k];
    }
    for (let h = 1; h < 8; h *= 2) {
      for (let a = 0; a < 8; a += h * 2) {
        for (let b = a; b < a + h; b++) {
          const x = mix[b];
          const y = mix[b + h];
          mix[b] = x + y;
          mix[b + h] = x - y;
        }
      }
    }
    for (let k = 0; k < 8; k++) {
      lines[k][index[k]] = mix[k] * norm + (k % 2 ? inRight : inLeft) * 0.5;
      index[k] = (index[k] + 1) % lengths[k];
    }
    out.left[i] = (read[0] + read[2] - read[4] + read[6]) * 0.5;
    out.right[i] = (read[1] - read[3] + read[5] + read[7]) * 0.5;
  }
  return out;
}

/**
 * A ping-pong echo on the beat's dotted eighth: the input starts on the left, every repeat crosses to the other side,
 * and the feedback is band-limited (each repeat a little darker and thinner).
 */
function pingPong(send, { time = BEAT * 0.75, feedback = 0.45 } = {}) {
  const out = new Bus();
  const length = Math.round(time * SAMPLE_RATE);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const lowStep = 1 - Math.exp((-TAU * 4200) / SAMPLE_RATE);
  const highStep = 1 - Math.exp((-TAU * 350) / SAMPLE_RATE);
  const state = { lowLeft: 0, highLeft: 0, lowRight: 0, highRight: 0 };
  let index = 0;
  for (let i = 0; i < LENGTH; i++) {
    const fromLeft = left[index];
    const fromRight = right[index];
    state.lowLeft += (fromLeft - state.lowLeft) * lowStep;
    state.highLeft += (state.lowLeft - state.highLeft) * highStep;
    state.lowRight += (fromRight - state.lowRight) * lowStep;
    state.highRight += (state.lowRight - state.highRight) * highStep;
    left[index] = (send.left[i] + send.right[i]) * 0.5 + (state.lowRight - state.highRight) * feedback;
    right[index] = state.lowLeft - state.highLeft;
    index = (index + 1) % length;
    out.left[i] = fromLeft;
    out.right[i] = fromRight;
  }
  return out;
}

// ---- Master ----

/**
 * The 4x oversampled peak of every sample (its own and the in-between values a DAC would draw on either side, by a
 * windowed sinc), for the true-peak limit and its measurement.
 */
function truePeaks(left, right) {
  const taps = 8;
  const kernels = [0.25, 0.5, 0.75].map((fraction) => {
    const kernel = new Float64Array(taps * 2);
    for (let k = -taps + 1; k <= taps; k++) {
      const x = k - fraction;
      const window = 0.5 + 0.5 * Math.cos((Math.PI * x) / (taps + 0.5));
      kernel[k + taps - 1] = (Math.sin(Math.PI * x) / (Math.PI * x)) * window;
    }
    return kernel;
  });
  const peaks = new Float32Array(left.length);
  for (const channel of [left, right]) {
    for (let i = 0; i < channel.length; i++) {
      let peak = Math.abs(channel[i]);
      if (i >= taps - 1 && i + taps < channel.length) {
        for (const kernel of kernels) {
          let sum = 0;
          for (let k = 0; k < kernel.length; k++) {
            sum += channel[i - taps + 1 + k] * kernel[k];
          }
          peak = Math.max(peak, Math.abs(sum));
        }
      }
      // The in-between peak belongs to both its neighbours.
      peaks[i] = Math.max(peaks[i], peak);
      if (i + 1 < channel.length) {
        peaks[i + 1] = Math.max(peaks[i + 1], peak);
      }
    }
  }
  return peaks;
}

/** The highest true peak of a stereo sound, in dBTP. */
export function truePeakDb({ left, right }) {
  return toDb(truePeaks(left, right).reduce((max, value) => Math.max(max, value), 0));
}

/**
 * A look-ahead true-peak limiter: the gain each sample needs, held over the look-ahead, released smoothly, then
 * averaged over the look-ahead, so the gain is already down when a peak arrives and never steps.
 */
function limit(left, right, ceilingDb, { lookahead = 0.003, release = 0.12 } = {}) {
  const ceiling = fromDb(ceilingDb);
  const peaks = truePeaks(left, right);
  const n = left.length;
  const span = Math.round(lookahead * SAMPLE_RATE);
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    need[i] = peaks[i] > ceiling ? ceiling / peaks[i] : 1;
  }
  // The least gain needed from here to the end of the look-ahead (a sliding minimum, by a monotonic queue).
  const held = new Float32Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (tail > head && need[queue[tail - 1]] >= need[i]) {
      tail--;
    }
    queue[tail++] = i;
    while (queue[head] > i + span) {
      head++;
    }
    held[i] = need[queue[head]];
  }
  const releaseStep = 1 - Math.exp(-1 / (release * SAMPLE_RATE));
  let gain = 1;
  let sum = 0;
  const smoothed = new Float32Array(n);
  let deepest = 1;
  for (let i = 0; i < n; i++) {
    gain = held[i] < gain ? held[i] : gain + (held[i] - gain) * releaseStep;
    smoothed[i] = gain;
    sum += gain - (i > span ? smoothed[i - span - 1] : 1);
    const g = (sum + span + 1) / (span + 1);
    deepest = Math.min(deepest, g);
    left[i] *= g;
    right[i] *= g;
  }
  return toDb(deepest);
}

/**
 * The bus compressor (the glue): stereo-linked, an RMS detector over 8 ms, a 2:1 ratio with a soft knee, a slow-ish
 * attack that lets the drums' transients through and a release that breathes with the beat.
 */
function glue(left, right, { thresholdDb = -14, ratio = 2, kneeDb = 6, attack = 0.015, release = 0.18 } = {}) {
  const detector = Math.exp(-1 / (0.008 * SAMPLE_RATE));
  const attackStep = Math.exp(-1 / (attack * SAMPLE_RATE));
  const releaseStep = Math.exp(-1 / (release * SAMPLE_RATE));
  let meanSquare = 0;
  let reduction = 0;
  let deepest = 0;
  for (let i = 0; i < left.length; i++) {
    meanSquare = detector * meanSquare + (1 - detector) * 0.5 * (left[i] * left[i] + right[i] * right[i]);
    const over = 10 * Math.log10(meanSquare + 1e-12) + 3 - thresholdDb;
    const target =
      over <= -kneeDb / 2 ? 0 : over >= kneeDb / 2 ? (1 / ratio - 1) * over : ((1 / ratio - 1) * (over + kneeDb / 2) ** 2) / (2 * kneeDb);
    reduction = target < reduction ? attackStep * reduction + (1 - attackStep) * target : releaseStep * reduction + (1 - releaseStep) * target;
    deepest = Math.min(deepest, reduction);
    const g = fromDb(reduction);
    left[i] *= g;
    right[i] *= g;
  }
  return deepest;
}

/**
 * Loudness by ITU-R BS.1770 / EBU R128: K-weighted, the integrated value gated (-70 LUFS, then -10 LU), the short-term
 * (3 s) values every 100 ms, and the loudness range (10th to 95th percentile of the short-term values gated at -20 LU).
 * `window(from, to)` gives the (ungated) loudness of any span, for the sections.
 */
export function loudness({ left, right }) {
  // The K-weighting's two stages at 48 kHz, as the standard gives them.
  const shelf = new Biquad(1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585);
  const highPass = new Biquad(1, -2, 1, -1.99004745483398, 0.99007225036621);
  const energy = new Float64Array(left.length + 1);
  const weighted = [Float32Array.from(left), Float32Array.from(right)].map((channel) => highPass.apply(shelf.apply(channel)));
  for (let i = 0; i < left.length; i++) {
    energy[i + 1] = energy[i] + weighted[0][i] ** 2 + weighted[1][i] ** 2;
  }
  const level = (from, to) => {
    const a = Math.max(0, Math.round(from * SAMPLE_RATE));
    const b = Math.min(left.length, Math.round(to * SAMPLE_RATE));
    return -0.691 + 10 * Math.log10((energy[b] - energy[a]) / Math.max(1, b - a) + 1e-20);
  };
  const seconds = left.length / SAMPLE_RATE;
  const blocks = [];
  for (let at = 0; at + 0.4 <= seconds + 1e-9; at += 0.1) {
    blocks.push(level(at, at + 0.4));
  }
  const gated = (values, relative) => {
    const loud = values.filter((value) => value > -70);
    const mean = -0.691 + 10 * Math.log10(loud.reduce((sum, value) => sum + 10 ** ((value + 0.691) / 10), 0) / loud.length);
    return values.filter((value) => value > -70 && value > mean + relative);
  };
  const kept = gated(blocks, -10);
  const integrated = -0.691 + 10 * Math.log10(kept.reduce((sum, value) => sum + 10 ** ((value + 0.691) / 10), 0) / kept.length);
  const shortTerm = [];
  for (let at = 0; at + 3 <= seconds + 1e-9; at += 0.1) {
    shortTerm.push(level(at, at + 3));
  }
  const ranged = gated(shortTerm, -20).sort((a, b) => a - b);
  const percentile = (p) => ranged[Math.min(ranged.length - 1, Math.round(p * (ranged.length - 1)))];
  return { integrated, range: percentile(0.95) - percentile(0.1), shortTerm, window: level };
}

// ---- The song ----

/** The chords: the bass's root (the sub; the mid bass plays it an octave up) and the pad's voicing. */
const CHORDS = {
  am: { root: 33, pad: [57, 60, 64, 69], wide: [57, 60, 64, 69, 72] },
  f: { root: 29, pad: [57, 60, 65, 69], wide: [57, 60, 65, 69, 72] },
  c: { root: 36, pad: [55, 60, 64, 67], wide: [55, 60, 64, 67, 72] },
  g: { root: 31, pad: [55, 59, 62, 67], wide: [55, 59, 62, 67, 71] },
  gsus: { root: 31, pad: [55, 60, 62, 67], wide: [55, 60, 62, 67, 72] },
};

/** The harmony, by beat: A minor's vi-IV-I-V in the loop, IV-V into C for the delivery, IV-I-vi-V for the lift. */
const HARMONY = [
  [0, 'am'],
  [4, 'f'],
  [6, 'g'],
  [8, 'am'],
  [12, 'f'],
  [16, 'c'],
  [20, 'g'],
  [24, 'f'],
  [28, 'gsus'],
  [30, 'g'],
  [32, 'c'],
  [36, 'f'],
  [40, 'c'],
  [44, 'am'],
  [48, 'g'],
  [52, 'am'],
  [53, 'f'],
  [54, 'g'],
  [56, 'c'],
];
const chordAt = (b) => CHORDS[HARMONY.findLast(([from]) => from <= b + 1e-9)[1]];

/**
 * The hook, in sixteenths over two bars: E G A G E D (3-3-4-2-2-2, a pentatonic line that sits on every chord of the
 * song), answered home (E D C) or open (E G D, on the dominant). [position, note, length].
 */
const HOOK = [
  [0, 76, 3],
  [3, 79, 3],
  [6, 81, 4],
  [10, 79, 2],
  [12, 76, 2],
  [14, 74, 2],
];
const HOME = [
  [16, 76, 3],
  [19, 74, 3],
  [22, 72, 9],
];
const OPEN = [
  [16, 76, 3],
  [19, 79, 3],
  [22, 74, 9],
];

/** A phrase's notes from beat `from`, transposed by `shift`: [{ time, length, note }]. */
const phrase = (from, steps, shift = 0) =>
  steps.map(([position, note, length]) => ({
    time: beat(from) + position * SIXTEENTH,
    length: length * SIXTEENTH - 0.012,
    note: note + shift,
  }));

/** The arpeggio's walk over a chord's four pad notes, a sixteenth each. */
const ARP = [0, 1, 2, 3, 2, 1, 3, 2];

/**
 * The music: exactly DURATION seconds of 48 kHz stereo, the same every time. `stems` also returns the buses before
 * the mix (for the runner's analysis).
 */
export function music({ stems = false } = {}) {
  const session = new Session();
  const { random } = session;
  const at = beat;

  // ---- Cold open (beats 0-8): a kick behind a wall, a pulsing bass, a pad whose filter opens, a riser ----
  for (let b = 0; b < 7; b++) {
    kick(session, at(b), 0.16 + 0.04 * b, { muffle: 110 * 4 ** (b / 6), pump: 0.45 });
  }
  for (const [from, to] of [
    [0, 4],
    [4, 6],
    [6, 7.75],
  ]) {
    const chord = chordAt(from);
    sawStack(session, session.pads, at(from), at(to) - at(from), chord.pad, {
      gain: 0.22,
      attack: from === 0 ? 1.2 : 0.03,
      release: from === 6 ? 0.05 : 0.12,
      detune: 0.15,
      // The filter opens across the open: 280 Hz at the first beat, 3.2 kHz into the drop.
      cutoff: (time) => 280 * (3200 / 280) ** ((time / at(8)) ** 1.6),
      hall: 0.35,
    });
  }
  for (let eighth = 0; eighth < 15; eighth++) {
    const b = eighth / 2;
    midBass(session, at(b), BEAT / 2 - 0.05, chordAt(b).root + 12, 0.1 + 0.1 * (b / 8), {
      cutoff: 160 + 260 * (b / 8),
      open: 400 + 600 * (b / 8),
    });
  }
  for (let s = 20; s < 31; s++) {
    shaker(session, at(s / 4), 0.06 + 0.16 * ((s - 20) / 11), s % 2 ? 0.3 : -0.3);
  }
  // The build: snares in eighths, then sixteenths, louder and brighter, and a riser, stopping a sixteenth short.
  for (const b of [5, 5.5, 6, 6.25, 6.5, 6.75, 7, 7.25, 7.5]) {
    snare(session, at(b), 0.06 + 0.22 * ((b - 5) / 2.5), { hall: 0.3 });
  }
  riser(session, at(7.75), at(3.75), 0.4);

  // ---- The drop (beat 8) ----
  crash(session, at(8), 0.5, 2.6);
  boom(session, at(8), 0.55, 1.4);
  downlifter(session, at(8), at(3), 0.12);

  // ---- Drums of the loop, the world and the lift ----
  const grooves = [
    [8, 32],
    [36, 52],
  ];
  const inGroove = (b) => grooves.some(([from, to]) => b >= from && b < to);
  const thunder = (b) => b >= 28 && b < 30; // The thunder's pocket: no kick, no snare.
  for (let b = 8; b < 52; b++) {
    if (!inGroove(b) || thunder(b)) {
      continue;
    }
    kick(session, at(b), b >= 36 ? 0.95 : b >= 24 ? 0.85 : 0.76);
    if (b % 4 === 1 || b % 4 === 3) {
      snare(session, at(b), b >= 36 ? 0.36 : b >= 24 ? 0.3 : 0.26);
      clap(session, at(b), b >= 36 ? 0.5 : b >= 24 ? 0.4 : 0.34);
    }
  }
  for (let s = 8 * 4; s < 52 * 4; s++) {
    const b = s / 4;
    if (!inGroove(b)) {
      continue;
    }
    const position = s % 16;
    const lift = b >= 36 ? 1.15 : b >= 24 ? 1 : 0.95;
    const jitter = 1 + random() * 0.15;
    if (position % 4 === 2) {
      // The offbeat: closed in the loop, open (the house "tss") in the world and the lift.
      const open = b >= 24 || (position === 14 && Math.floor(b / 4) % 2 === 1);
      hat(session, at(b), (open ? 0.15 : 0.2) * lift * jitter, open ? { decay: 0.11, pan: 0.15, tone: 7000 } : { pan: 0.2 });
    } else {
      hat(session, at(b), (position % 4 === 0 ? 0.08 : 0.1) * lift * jitter, { decay: 0.018 + random() * 0.006, pan: 0.25 });
    }
    if (b >= 24 && position % 2 === 1) {
      shaker(session, at(b), 0.09 * jitter, position % 4 === 1 ? -0.35 : -0.15);
    }
    // Ghost snares on the last sixteenth of each half bar, every other bar.
    if ((position === 7 || position === 15) && Math.floor(b / 4) % 2 === 1 && !thunder(b)) {
      snare(session, at(b), 0.06, { hall: 0.1 });
    }
  }
  // Fills: into the world, into the lift's second half, and the roll into the finale.
  for (const b of [23, 23.25, 23.5, 23.75]) {
    snare(session, at(b), 0.16 + 0.22 * (b - 23), { hall: 0.3 });
  }
  for (const b of [43.5, 43.75]) {
    snare(session, at(b), 0.2, { hall: 0.25 });
  }
  for (const b of [50, 50.5, 51, 51.25, 51.5, 51.625]) {
    snare(session, at(b), 0.16 + 0.24 * ((b - 50) / 1.625), { hall: 0.3 });
  }
  crash(session, at(24), 0.32, 2.2);
  riser(session, at(52), at(4), 0.42);

  // ---- The loop (beats 8-24) and the world (24-32): pads, bass, the hook small, then the arpeggio ----
  for (let b = 8; b < 32; b += 2) {
    const chord = chordAt(b);
    const span = HARMONY.find(([from]) => from > b)[0];
    if (HARMONY.some(([from]) => from === b) || b === 8) {
      sawStack(session, session.pads, at(b), at(span) - at(b) - 0.02, chord.pad, {
        gain: b >= 24 ? 0.32 : 0.24,
        attack: 0.015,
        release: 0.1,
        // The loop opens slowly from 2.4 to 3.8 kHz; the world brighter still.
        cutoff: (time) => (b >= 24 ? 4400 : 2400 + 1400 * ((time - at(8)) / at(16))),
        hall: 0.22,
      });
    }
  }
  for (let bar = 2; bar < 8; bar++) {
    const b = bar * 4;
    sub(session, at(b), BAR - 0.03, chordAt(b).root, bar >= 6 ? 0.3 : 0.26);
    for (const [position, up] of [
      [2, 0],
      [6, 0],
      [10, 0],
      [14, 0],
      [15, bar % 2 ? 12 : -1],
      [7, bar % 2 ? -1 : 12],
    ]) {
      if (up >= 0) {
        const at16 = b + position / 4;
        midBass(session, at(at16), up ? SIXTEENTH - 0.02 : BEAT / 2 - 0.06, chordAt(at16).root + 12 + up, (up ? 0.22 : 0.32) * (bar >= 6 ? 1 : 0.85));
      }
    }
  }
  // The hook's first, small appearance: a bell, quiet, with the echo (bars 4-5, over C then G).
  for (const note of phrase(16, [...HOOK, ...OPEN])) {
    bell(session, session.lead, note.time, note.note, { gain: 0.12, pan: 0.1, decay: 0.55, seconds: 1.3, hall: 0.3, echo: 0.42 });
  }
  // The world's arpeggio: the chord a sixteenth at a time, an octave up, side to side.
  for (let s = 24 * 4; s < 32 * 4; s++) {
    const b = s / 4;
    const notes = chordAt(b).pad;
    pluck(session, session.lead, at(b), notes[ARP[s % 8]] + 12, {
      gain: 0.12 + 0.03 * (s % 4 === 0),
      pan: s % 2 ? 0.45 : -0.45,
      hall: 0.18,
      echo: 0.18,
    });
  }
  swell(session, at(32), at(1), 0.12);

  // ---- The delivery (beats 32-36): a quiet C major pedal under the air brakes and the game's C-E-G chime ----
  sawStack(session, session.pads, at(32), at(4) - 0.1, [60, 64, 67], {
    gain: 0.22,
    voices: 5,
    attack: 0.12,
    release: 0.15,
    cutoff: () => 1500,
    hall: 0.4,
  });
  sub(session, at(32), at(4) - 0.08, 36, 0.17, { attack: 0.05 });
  midBass(session, at(32), at(4) - 0.1, 48, 0.07, { cutoff: 260, open: 300, decay: 0.3 });
  for (let b = 34; b < 36; b += 0.5) {
    hat(session, at(b + 0.25), 0.07 + 0.05 * (b - 34), { pan: 0.2 });
  }
  for (const b of [35, 35.25, 35.5, 35.75]) {
    snare(session, at(b), 0.08 + 0.14 * (b - 35), { hall: 0.35 });
  }
  riser(session, at(36), at(2), 0.24);

  // ---- The lift (beats 36-52): the full chorus, the hook on the lead ----
  crash(session, at(36), 0.5, 2.6);
  boom(session, at(36), 0.4, 1.2);
  crash(session, at(44), 0.36, 2.2);
  for (let b = 36; b < 52; b += 4) {
    const chord = chordAt(b);
    sawStack(session, session.pads, at(b), BAR - 0.02, chord.wide, {
      gain: 0.36,
      attack: 0.01,
      release: 0.1,
      detune: 0.18,
      width: 0.95,
      cutoff: (time, t) => 4200 + 2600 * Math.exp(-t / 0.35),
      hall: 0.2,
    });
    sub(session, at(b), BAR - 0.03, chord.root, 0.32);
    // A rolling bass between the kicks: three sixteenths after each, the offbeat accented, an octave pop at the end.
    for (let position = 0; position < 16; position++) {
      if (position % 4 !== 0) {
        const up = position === 14 ? 12 : 0;
        midBass(session, at(b + position / 4), SIXTEENTH - 0.015, chord.root + 12 + up, position % 4 === 2 ? 0.33 : 0.22, {
          cutoff: 380,
          open: 1500,
          decay: 0.05,
        });
      }
    }
  }
  const lift = [...phrase(36, [...HOOK, ...HOME]), ...phrase(44, [...HOOK, ...OPEN])];
  lead(session, session.lead, lift, { gain: 0.3, hall: 0.24, echo: 0.26 });
  for (const note of lift) {
    bell(session, session.lead, note.time, note.note + 12, { gain: 0.05, pan: -0.15, decay: 0.4, seconds: 1, hall: 0.2, echo: 0.3 });
  }
  for (let s = 36 * 4; s < 52 * 4; s++) {
    const b = s / 4;
    pluck(session, session.lead, at(b), chordAt(b).pad[ARP[s % 8]] + 24, {
      gain: 0.04,
      pan: s % 2 ? 0.6 : -0.6,
      bright: 3000,
      hall: 0.15,
      echo: 0.1,
    });
  }

  // ---- The finale (beats 52-56): three hits (Am, F, G), then a breath into the brand ----
  HITS.finale.forEach((b, index) => {
    const chord = chordAt(b);
    const strength = 0.85 + 0.08 * index;
    kick(session, at(b), strength);
    snare(session, at(b), 0.34 * strength, { hall: 0.35 });
    clap(session, at(b), 0.5 * strength, { hall: 0.4 });
    crash(session, at(b), 0.32 * strength, 1.6);
    boom(session, at(b), 0.45 * strength, 0.9);
    sawStack(session, session.pads, at(b), 0.12, [...chord.wide, chord.wide.at(-1) + 12], {
      gain: 0.5 * strength,
      attack: 0.002,
      decay: 0.22,
      sustain: 0,
      release: 0.35,
      detune: 0.2,
      width: 1,
      cutoff: (time, t) => 1400 + 7000 * Math.exp(-t / 0.12),
      hall: 0.45,
      echo: 0.15,
    });
    sub(session, at(b), 0.32, chord.root, 0.32);
    midBass(session, at(b), 0.3, chord.root + 12, 0.3, { cutoff: 300, open: 1600, decay: 0.08 });
  });
  swell(session, at(56), at(1), 0.2);

  // ---- The brand (beats 56-64): one impact, a held C chord, the hook once more, home ----
  kick(session, at(56), 1);
  boom(session, at(56), 0.45, 2.6);
  crash(session, at(56), 0.4, 3);
  clap(session, at(56), 0.4, { hall: 0.5 });
  sawStack(session, session.pads, at(56), 0.15, [48, 55, 60, 64, 67, 72, 76], {
    gain: 0.6,
    attack: 0.002,
    decay: 0.35,
    sustain: 0,
    release: 0.5,
    detune: 0.2,
    width: 1,
    cutoff: (time, t) => 1500 + 7000 * Math.exp(-t / 0.15),
    hall: 0.5,
  });
  const brandEnd = DURATION - at(56) - 0.75;
  sawStack(session, session.pads, at(56), brandEnd, [55, 60, 62, 64, 67, 74], {
    gain: 0.15,
    attack: 0.05,
    release: 0.6,
    detune: 0.2,
    width: 1,
    // The held chord darkens as it fades, so the end is soft.
    cutoff: (time, t) => 1100 + 3400 * Math.exp(-t / 1.4),
    decay: 1.6,
    sustain: 0.35,
    hall: 0.3,
  });
  sub(session, at(56), brandEnd - 0.4, 36, 0.16, { release: 0.6 });
  const signature = phrase(57, [...HOOK, [16, 72, 6]]);
  lead(session, session.lead, signature, { gain: 0.17, cutoff: 1600, open: 2200, hall: 0.35, echo: 0.22 });
  for (const note of signature) {
    bell(session, session.lead, note.time, note.note, {
      gain: 0.1,
      pan: 0.1,
      decay: note.note === 72 ? 0.5 : 0.6,
      seconds: Math.min(1.3, DURATION - 0.2 - note.time),
      hall: 0.3,
      echo: note.note === 72 ? 0.12 : 0.3,
    });
  }

  return mixdown(session, stems);
}

/**
 * The mix: the sidechain pump on the music, the pockets for the horn and the thunder, the echo into the hall, the
 * buses' EQ, the master EQ, the glue, the level, the true-peak limit and the ends.
 */
function mixdown(session, stems) {
  const { drums, pads, bass, lead, fx } = session;
  // Each bus's own EQ: the pads and the lead stay out of the bass's room.
  equalise(pads, Biquad.of('highpass', 230, 0.6));
  equalise(lead, Biquad.of('highpass', 280, 0.6));
  equalise(bass, Biquad.of('lowpass', 2500, 0.7));

  const echo = pingPong(session.echo);
  for (let i = 0; i < LENGTH; i++) {
    session.hall.left[i] += echo.left[i] * 0.3;
    session.hall.right[i] += echo.right[i] * 0.3;
  }
  // Less send into the hall at the very end, so its tail has died by the last frame.
  for (let i = Math.round((DURATION - 1.6) * SAMPLE_RATE); i < LENGTH; i++) {
    const fade = clamp01((DURATION - 0.6 - i / SAMPLE_RATE) / 1);
    session.hall.left[i] *= fade;
    session.hall.right[i] *= fade;
  }
  const hall = hallReverb(session.hall);
  equalise(hall, Biquad.of('highpass', 200, 0.7));

  // The pump: every kick ducks the music, quick down (5 ms) and a curved recovery over about a third of a second.
  const pump = new Float32Array(LENGTH);
  for (const [time, depth] of session.kicks) {
    const first = Math.round(time * SAMPLE_RATE);
    const last = Math.min(LENGTH, first + Math.round(0.36 * SAMPLE_RATE));
    for (let i = first; i < last; i++) {
      const t = (i - first) / SAMPLE_RATE;
      const shape = t < 0.005 ? t / 0.005 : (1 - (t - 0.005) / 0.355) ** 2;
      pump[i] = Math.max(pump[i], shape * depth);
    }
  }

  const left = new Float32Array(LENGTH);
  const right = new Float32Array(LENGTH);
  for (let i = 0; i < LENGTH; i++) {
    const t = i / SAMPLE_RATE;
    const p = pump[i];
    // The horn's pocket (the middle drops about 8 dB) and the thunder's (the low end steps aside).
    const horn = pocket(t, beat(2.75), beat(3), beat(5), beat(5.6));
    const storm = pocket(t, beat(27.75), beat(28), beat(29.25), beat(30));
    const padGain = (1 - 0.6 * p) * (1 - 0.6 * horn) * (1 - 0.45 * storm);
    const bassGain = (1 - 0.8 * p) * (1 - 0.5 * horn) * (1 - 0.8 * storm);
    const leadGain = 1 - 0.25 * p;
    const roomGain = (1 - 0.35 * p) * (1 - 0.4 * horn);
    left[i] = drums.left[i] + fx.left[i] + pads.left[i] * padGain + bass.left[i] * bassGain + (lead.left[i] + echo.left[i]) * leadGain + hall.left[i] * roomGain;
    right[i] = drums.right[i] + fx.right[i] + pads.right[i] * padGain + bass.right[i] * bassGain + (lead.right[i] + echo.right[i]) * leadGain + hall.right[i] * roomGain;
  }

  // The master: nothing under 35 Hz (24 dB an octave), a little less low-mid box, a little presence and air.
  const master = { left, right };
  equalise(
    master,
    Biquad.of('highpass', 35, 0.541),
    Biquad.of('highpass', 35, 1.307),
    Biquad.of('peak', 320, 0.9, -1.5),
    Biquad.of('peak', 3200, 0.8, 1.5),
    Biquad.of('highshelf', 9000, 0.7, 1.5),
  );
  // The ride: each section a little quieter the less the timeline's energy (8 dB for all of it), so the open builds,
  // the delivery dips and the brand settles while the lift is the loudest; 60 ms crossfades on the downbeats.
  const rideDb = (t) => {
    let level = 0;
    SECTIONS.forEach((section, index) => {
      const from = beat(section.from);
      const weight = index === 0 ? 1 : clamp01((t - from + 0.03) / 0.06);
      level += weight * (RIDE_DB * (section.energy - 1) - level);
    });
    return level;
  };
  for (let i = 0; i < LENGTH; i += 64) {
    const g = fromDb(rideDb(i / SAMPLE_RATE));
    for (let j = i; j < Math.min(LENGTH, i + 64); j++) {
      left[j] *= g;
      right[j] *= g;
    }
  }
  // Into the glue at a known level (the lift's RMS at -15 dBFS), then to about -14 LUFS, then the limit.
  const liftStart = Math.round(beat(36) * SAMPLE_RATE);
  const liftEnd = Math.round(beat(52) * SAMPLE_RATE);
  let energy = 0;
  for (let i = liftStart; i < liftEnd; i++) {
    energy += 0.5 * (left[i] * left[i] + right[i] * right[i]);
  }
  scale(master, fromDb(-15) / Math.sqrt(energy / (liftEnd - liftStart)));
  const glued = glue(left, right);
  scale(master, fromDb(TARGET_LUFS - loudness(master).integrated));
  const limited = limit(left, right, CEILING_DB);

  // The ends: a 5 ms fade in, and the last 0.4 s fades out under the dying chord.
  for (let i = 0; i < LENGTH; i++) {
    const t = i / SAMPLE_RATE;
    const g = Math.min(1, t / 0.005) * Math.cos((Math.PI / 2) * clamp01((t - (DURATION - 0.4)) / 0.4)) ** 2;
    left[i] *= g;
    right[i] *= g;
  }
  const result = { left, right };
  if (stems) {
    result.stems = { drums, pads, bass, lead, fx, echo, hall, pump };
    result.reductions = { glueDb: glued, limiterDb: limited };
  }
  return result;
}

/** The loudness the music is rendered at (before the cut's own normalisation), and its true-peak ceiling. */
const TARGET_LUFS = -14;
const CEILING_DB = -1.8;
/** How much quieter a section of no energy would be than one flat out (the ride). */
const RIDE_DB = 8;

function scale({ left, right }, gain) {
  for (let i = 0; i < left.length; i++) {
    left[i] *= gain;
    right[i] *= gain;
  }
}

/** 24-bit PCM WAV bytes of the stereo `sound` (clamped, never renormalised: the level is the mix's). */
export function wav({ left, right }) {
  const frames = left.length;
  const bytes = Buffer.alloc(44 + frames * 6);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(36 + frames * 6, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(SAMPLE_RATE, 24);
  bytes.writeUInt32LE(SAMPLE_RATE * 6, 28);
  bytes.writeUInt16LE(6, 32);
  bytes.writeUInt16LE(24, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(frames * 6, 40);
  const full = 8388607;
  for (let i = 0; i < frames; i++) {
    bytes.writeIntLE(Math.round(Math.max(-1, Math.min(1, left[i])) * full), 44 + i * 6, 3);
    bytes.writeIntLE(Math.round(Math.max(-1, Math.min(1, right[i])) * full), 47 + i * 6, 3);
  }
  return bytes;
}
