// The store video's soundtrack, synthesised here (no samples, nothing licensed): a 120 BPM drive in A minor on the
// cut's bars (timeline.mjs), with the picture's sounds on its moments: sweeps of air under the transitions, a tap
// on the phone, the pay's chime, three hits for the finale's words and an impact under the brand.
//
// Returns 48 kHz stereo; storeVideo.mjs has ffmpeg bring it to streaming loudness.
import { BEAT, DURATION, FINALE_WORDS, PAY_COUNT, SCENES, TAPS, WHOOSHES } from './timeline.mjs';

export const SAMPLE_RATE = 48000;
const TAU = Math.PI * 2;
const BAR = BEAT * 4;

/** A seeded noise source (mulberry32), -1..1: the same soundtrack every time. */
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

/** A state-variable filter (Chamberlin, twice oversampled): low, band and high pass from one state. */
function filter() {
  let low = 0;
  let band = 0;
  return (input, cutoffHz, q = 0.7) => {
    const f = 2 * Math.sin((Math.PI * Math.min(cutoffHz, SAMPLE_RATE / 6)) / (SAMPLE_RATE * 2));
    const damping = 1 / q;
    let high = 0;
    for (let pass = 0; pass < 2; pass++) {
      low += f * band;
      high = input - low - damping * band;
      band += f * high;
    }
    return { low, band, high };
  };
}

/** A stereo bus the voices write into. */
class Bus {
  constructor(seconds) {
    this.left = new Float32Array(Math.ceil(seconds * SAMPLE_RATE));
    this.right = new Float32Array(this.left.length);
  }

  /** Writes `render(time since start)` for `seconds` from `start`, panned (-1 left .. 1 right, or a function of time). */
  add(start, seconds, pan, render) {
    const first = Math.max(0, Math.round(start * SAMPLE_RATE));
    const last = Math.min(this.left.length, Math.round((start + seconds) * SAMPLE_RATE));
    for (let i = first; i < last; i++) {
      const t = i / SAMPLE_RATE - start;
      const value = render(t);
      const p = typeof pan === 'function' ? pan(t) : pan;
      this.left[i] += value * Math.cos(((p + 1) * Math.PI) / 4);
      this.right[i] += value * Math.sin(((p + 1) * Math.PI) / 4);
    }
  }
}

const random = noiseSource(0x524f4144);

// ---- Voices ----

function kick(bus, start, gain, muffled = false) {
  let phase = 0;
  const tone = filter();
  bus.add(start, 0.5, 0, (t) => {
    phase += (TAU * (44 + 115 * Math.exp(-t / 0.032))) / SAMPLE_RATE;
    const body = Math.sin(phase) * Math.exp(-t / 0.17) * Math.min(1, t / 0.001);
    const click = random() * Math.exp(-t / 0.0025) * 0.35;
    const out = Math.tanh((body + click) * 1.6) * gain;
    return muffled ? tone(out, 180).low * 1.4 : out;
  });
}

function clap(bus, send, start, gain) {
  const band = filter();
  const render = (t) => {
    const bursts = [0, 0.011, 0.023].reduce((sum, at) => sum + (t >= at ? Math.exp(-(t - at) / 0.005) : 0), 0);
    const tail = t >= 0.023 ? Math.exp(-(t - 0.023) / 0.11) : 0;
    return band(random(), 1400, 1.4).band * (bursts * 0.8 + tail) * gain;
  };
  bus.add(start, 0.4, 0.05, render);
  send.add(start, 0.4, 0, (t) => render(t) * 0.35);
}

function hat(bus, start, gain, open = false) {
  const high = filter();
  const higher = filter();
  const pan = 0.25;
  bus.add(start, open ? 0.35 : 0.08, pan, (t) => {
    const sample = higher(high(random(), 7500).high, 9000).high;
    return sample * Math.exp(-t / (open ? 0.12 : 0.028)) * gain;
  });
}

function bassNote(bus, start, seconds, note, gain) {
  const tone = filter();
  let saw = 0;
  let sub = 0;
  bus.add(start, seconds, 0, (t) => {
    saw = (saw + hz(note) / SAMPLE_RATE) % 1;
    sub = (sub + hz(note - 12) / SAMPLE_RATE) % 1;
    const envelope = Math.min(1, t / 0.004) * (0.75 + 0.25 * Math.exp(-t / 0.06)) * Math.min(1, (seconds - t) / 0.03);
    const bright = tone(saw * 2 - 1, 180 + 1100 * Math.exp(-t / 0.07), 1.1).low;
    return (bright * 0.55 + Math.sin(TAU * sub) * 0.6) * envelope * gain;
  });
}

function padChord(bus, start, seconds, notes, gain) {
  for (const [index, note] of notes.entries()) {
    for (const detune of [-0.07, 0.07]) {
      const tone = filter();
      let phase = random() * 0.5 + 0.5;
      const frequency = hz(note + detune);
      const pan = detune < 0 ? -0.55 + index * 0.1 : 0.55 - index * 0.1;
      bus.add(start, seconds, pan, (t) => {
        phase = (phase + frequency / SAMPLE_RATE) % 1;
        const envelope = Math.min(1, t / 0.45) * Math.min(1, Math.max(0, (seconds - t) / 0.5));
        const cutoff = 900 + 500 * Math.sin(TAU * 0.25 * (start + t));
        return tone(phase * 2 - 1, cutoff, 0.8).low * envelope * gain;
      });
    }
  }
}

function pluck(bus, send, start, note, gain, pan) {
  const tone = filter();
  let phase = 0;
  const render = (t) => {
    phase = (phase + hz(note) / SAMPLE_RATE) % 1;
    const pulse = phase < 0.3 ? 1 : -1;
    return tone(pulse, 500 + 3500 * Math.exp(-t / 0.05), 1.3).low * Math.exp(-t / 0.16) * gain;
  };
  bus.add(start, 0.45, pan, render);
  send.add(start, 0.45, pan, (t) => render(t) * 0.5);
}

function stab(bus, send, start, notes, gain) {
  for (const [index, note] of notes.entries()) {
    const tone = filter();
    let phase = index / notes.length;
    const render = (t) => {
      phase = (phase + hz(note) / SAMPLE_RATE) % 1;
      return tone(phase * 2 - 1, 700 + 4200 * Math.exp(-t / 0.09), 1).low * Math.exp(-t / 0.3) * gain;
    };
    bus.add(start, 0.9, (index - 1) * 0.4, render);
    send.add(start, 0.9, 0, (t) => render(t) * 0.6);
  }
}

function riser(bus, start, seconds, gain) {
  const band = filter();
  bus.add(start, seconds, (t) => Math.sin(TAU * 0.5 * t) * 0.5, (t) => {
    const p = t / seconds;
    return band(random(), 300 * (8000 / 300) ** p, 2).band * p * p * gain;
  });
}

function whoosh(bus, peak, gain) {
  const seconds = 0.55;
  const start = peak - 0.3;
  const band = filter();
  bus.add(start, seconds, (t) => -0.8 + (1.6 * t) / seconds, (t) => {
    const p = t / seconds;
    const cutoff = 450 + 2600 * Math.sin(Math.PI * p) ** 2;
    return band(random(), cutoff, 1.6).band * Math.sin(Math.PI * p) ** 2 * gain;
  });
}

function impact(bus, send, start, gain) {
  let phase = 0;
  const tone = filter();
  const render = (t) => {
    phase += (TAU * (30 + 45 * Math.exp(-t / 0.25))) / SAMPLE_RATE;
    const boom = Math.sin(phase) * Math.exp(-t / 1.1);
    const crash = tone(random(), 1800, 0.7).low * Math.exp(-t / 0.35);
    return Math.tanh((boom * 1.2 + crash * 0.6) * 1.3) * gain;
  };
  bus.add(start, 3, 0, render);
  send.add(start, 3, 0, (t) => render(t) * 0.5);
}

/** A bright, short bell: the pay landing. */
function chime(bus, send, start, note, gain) {
  const partials = [
    [1, 1, 0.9],
    [2.01, 0.45, 0.5],
    [3.02, 0.22, 0.3],
    [4.2, 0.12, 0.18],
  ];
  const render = (t) =>
    partials.reduce((sum, [ratio, level, decay]) => sum + Math.sin(TAU * hz(note) * ratio * t) * level * Math.exp(-t / decay), 0) *
    Math.min(1, t / 0.002) *
    gain;
  bus.add(start, 1.6, 0.15, render);
  send.add(start, 1.6, 0, (t) => render(t) * 0.6);
}

function tap(bus, start, gain) {
  const high = filter();
  bus.add(start, 0.05, 0.2, (t) => (Math.sin(TAU * 2100 * t) * 0.7 + high(random(), 4000).high * 0.4) * Math.exp(-t / 0.009) * gain);
}

/** A small Freeverb: eight combs and four all-passes a side, the right's a little longer. */
function reverb(bus, seconds) {
  const out = new Bus(seconds);
  for (const [input, output, spread] of [
    [bus.left, out.left, 0],
    [bus.right, out.right, 23],
  ]) {
    const scale = SAMPLE_RATE / 44100;
    const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((length) => ({
      buffer: new Float32Array(Math.round((length + spread) * scale)),
      index: 0,
      store: 0,
    }));
    const passes = [556, 441, 341, 225].map((length) => ({ buffer: new Float32Array(Math.round((length + spread) * scale)), index: 0 }));
    for (let i = 0; i < input.length; i++) {
      let sum = 0;
      for (const comb of combs) {
        const delayed = comb.buffer[comb.index];
        comb.store = delayed * 0.6 + comb.store * 0.4;
        comb.buffer[comb.index] = input[i] * 0.015 + comb.store * 0.84;
        comb.index = (comb.index + 1) % comb.buffer.length;
        sum += delayed;
      }
      for (const pass of passes) {
        const delayed = pass.buffer[pass.index];
        pass.buffer[pass.index] = sum + delayed * 0.5;
        pass.index = (pass.index + 1) % pass.buffer.length;
        sum = delayed - sum;
      }
      output[i] = sum;
    }
  }
  return out;
}

// ---- The arrangement ----

/** A minor, a chord a bar: the pad's voicings (smooth from one to the next) and the bass's root. */
const PROGRESSION = [
  { pad: [57, 60, 64], root: 45 }, // Am
  { pad: [57, 60, 65], root: 41 }, // F
  { pad: [55, 60, 64], root: 48 }, // C
  { pad: [55, 59, 62], root: 43 }, // G
];
const chordAt = (time) => PROGRESSION[Math.floor(time / BAR + 1e-6) % PROGRESSION.length];

export function soundtrack() {
  const drums = new Bus(DURATION);
  const music = new Bus(DURATION);
  const effects = new Bus(DURATION);
  const send = new Bus(DURATION);
  const kicks = [];
  const groove = (time) => time >= SCENES.job && time < SCENES.finale;

  for (let beat = 0; beat * BEAT < DURATION - 1e-6; beat++) {
    const time = beat * BEAT;
    const inBar = beat % 4;
    if (time >= BAR && time < SCENES.job) {
      kick(drums, time, 0.8, true); // The intro's kick, heard through a wall.
    }
    if (groove(time)) {
      kick(drums, time, 0.72);
      kicks.push(time);
      if (inBar === 1 || inBar === 3) {
        clap(drums, send, time, 0.55);
      }
      hat(drums, time + BEAT / 2, 0.22, time >= SCENES.garage && inBar === 3);
      hat(drums, time + BEAT / 4, 0.07);
      hat(drums, time + (BEAT * 3) / 4, 0.1);
    }
    if (time >= SCENES.end && time < DURATION - BAR) {
      hat(drums, time + BEAT / 2, 0.12);
    }
  }

  // The pad: every bar but the finale's (stabs there) and the brand's last chord, held.
  for (let bar = 0; bar * BAR < SCENES.finale; bar++) {
    padChord(music, bar * BAR, BAR + 0.3, chordAt(bar * BAR).pad, 0.075);
  }
  padChord(music, SCENES.finale, 4.2, [57, 60, 64], 0.032);
  padChord(music, SCENES.end, DURATION - SCENES.end, [57, 60, 64, 69], 0.05);

  // The bass, in eighths through the groove; its root under the brand.
  for (let eighth = 0; eighth * (BEAT / 2) < DURATION; eighth++) {
    const time = eighth * (BEAT / 2);
    if (groove(time)) {
      bassNote(music, time, BEAT / 2 - 0.02, chordAt(time).root + (eighth % 4 === 3 ? 12 : 0), 0.42);
    }
  }
  bassNote(music, SCENES.end, 4, 45, 0.3);

  // The arpeggio, from the world montage on: the chord's notes up an octave, in sixteenths.
  const shape = [0, 1, 2, 1, 2, 0, 1, 2];
  for (let sixteenth = 0; sixteenth * (BEAT / 4) < SCENES.finale; sixteenth++) {
    const time = sixteenth * (BEAT / 4);
    if (time >= SCENES.world) {
      const notes = chordAt(time).pad;
      pluck(music, send, time, notes[shape[sixteenth % shape.length]] + 12, 0.07, sixteenth % 2 === 0 ? -0.35 : 0.35);
    }
  }

  // Into the drop, and into the brand.
  riser(effects, SCENES.job - 1.5, 1.5, 0.22);
  riser(effects, SCENES.end - 2, 2, 0.28);
  for (const time of WHOOSHES) {
    whoosh(effects, time, 0.3);
  }
  for (const time of [TAPS.job, ...TAPS.paints, TAPS.paint, TAPS.upgrade]) {
    tap(effects, time, 0.35);
  }
  chime(effects, send, PAY_COUNT[1], 88, 0.16);
  chime(effects, send, PAY_COUNT[1] + 0.09, 93, 0.14);
  // The pay counting up: quick soft ticks.
  for (let time = PAY_COUNT[0]; time < PAY_COUNT[1] - 0.02; time += 0.06) {
    tap(effects, time, 0.06);
  }

  // The finale's words: a hit each, the last in the brand's key.
  const stabs = [
    [57, 60, 64],
    [57, 60, 65],
    [55, 59, 62],
  ];
  FINALE_WORDS.forEach((time, index) => {
    kick(drums, time, 1);
    kicks.push(time);
    clap(drums, send, time, 0.5);
    stab(music, send, time, stabs[index], 0.09);
  });
  // A snare roll, faster and louder, into the brand.
  for (let time = SCENES.end - 1.5, gap = BEAT / 2; time < SCENES.end - 0.02; time += gap) {
    const p = (time - (SCENES.end - 1.5)) / 1.5;
    clap(drums, send, time, 0.12 + 0.3 * p);
    gap = p < 0.34 ? BEAT / 2 : p < 0.67 ? BEAT / 4 : BEAT / 8;
  }
  impact(effects, send, SCENES.end, 0.8);
  kick(drums, SCENES.end, 1);
  chime(effects, send, SCENES.end + 0.25, 81, 0.07);
  chime(effects, send, SCENES.end + 0.5, 88, 0.06);

  // The kick ducks the music (sidechain), and the whole ends in a fade.
  const room = reverb(send, DURATION);
  const left = new Float32Array(drums.left.length);
  const right = new Float32Array(drums.left.length);
  for (let i = 0; i < left.length; i++) {
    const time = i / SAMPLE_RATE;
    let duck = 0;
    for (let k = kicks.length - 1; k >= 0; k--) {
      if (kicks[k] <= time) {
        duck = Math.max(duck, Math.exp(-(time - kicks[k]) / 0.13));
        if (time - kicks[k] > 0.6) {
          break;
        }
      }
    }
    const ducked = 1 - 0.55 * duck;
    const fade = Math.min(1, (DURATION - time) / 1.2);
    left[i] = Math.tanh((drums.left[i] + ducked * music.left[i] + effects.left[i] + room.left[i]) * 1.05) * fade;
    right[i] = Math.tanh((drums.right[i] + ducked * music.right[i] + effects.right[i] + room.right[i]) * 1.05) * fade;
  }
  return { left, right };
}

/** 16-bit PCM WAV bytes of the stereo `sound`. */
export function wav({ left, right }) {
  const peak = Math.max(1e-9, ...[left, right].map((channel) => channel.reduce((max, value) => Math.max(max, Math.abs(value)), 0)));
  const gain = 0.89 / peak;
  const bytes = Buffer.alloc(44 + left.length * 4);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(36 + left.length * 4, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(SAMPLE_RATE, 24);
  bytes.writeUInt32LE(SAMPLE_RATE * 4, 28);
  bytes.writeUInt16LE(4, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(left.length * 4, 40);
  for (let i = 0; i < left.length; i++) {
    bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[i] * gain)) * 32767), 44 + i * 4);
    bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i] * gain)) * 32767), 46 + i * 4);
  }
  return bytes;
}
