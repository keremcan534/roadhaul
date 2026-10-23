// The engine's loops (src/presentation/audio/engine/diesel-<rpm>.ogg) from one recording of a diesel idling.
//
//   FFMPEG=<ffmpeg> node scripts/engineLoops.mjs <recording.wav> [--from <s>] [--to <s>] [--preview <dir>]
//
// The recording: "Diesel Truck Idling Front" by ibirdfilm, https://freesound.org/people/ibirdfilm/sounds/128160/
// (CC0). It is not kept in the repository: download it and run this again to remake the loops.
//
// How: the engine's firing pulses are found in the recording (marks one firing apart), and each loop lays those
// pulses, in the order they were recorded, one after another at the firing rate of the loop's engine speed. Each
// pulse keeps its own sound, so the engine stays as big as it was recorded while its revs rise, as a real engine's
// do; a recording simply played faster would shrink toward a toy's. A little of the speed-up is kept as a speed-up
// (REVS_IN_PITCH), because a faster engine does sound a little brighter. The pulses overlap-add with weights that
// favour the newest, and the loop wraps round, so it plays seamlessly.
//
// --preview writes each loop as a WAV there too, to listen to.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const RATE = 48000;
/** The loops: engine speeds, rpm (src/presentation/audio/engineLoops.ts plays them). */
const LOOP_RPMS = [650, 900, 1250, 1750, 2450];
/** The recording's engine idles at this speed, rpm: the first loop's. */
const RECORDED_RPM = LOOP_RPMS[0];
const LOOP_SECONDS = 6;
/** How much of a loop's rise in revs (as an exponent of the ratio) also raises its pitch. */
const REVS_IN_PITCH = 0.3;
/** Each pulse's weight fades in this long before its mark, and dies away with this time constant after it (shares of a period). */
const LEAD_IN = 0.15;
const DECAY = 0.6;
/** The loops are all lifted by one gain, the idle's to this RMS level, dBFS (the game sets how loud they play). */
const LOOP_RMS_DB = -18;
/** Firing rates the search considers, Hz. */
const MIN_FIRING_HZ = 15;
const MAX_FIRING_HZ = 90;
const OUT_DIR = new URL('../src/presentation/audio/engine/', import.meta.url);

const args = process.argv.slice(2);
const source = args[0];
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at < 0 ? fallback : args[at + 1];
};
if (!source) {
  throw new Error('usage: node scripts/engineLoops.mjs <recording.wav> [--from <s>] [--to <s>] [--preview <dir>]');
}
const from = Number(option('--from', '0'));
const to = option('--to', null);
const preview = option('--preview', null);

const recording = decode(source, from, to === null ? null : Number(to));
const period = firingPeriod(recording);
const marks = pulseMarks(recording, period);
console.log(
  `${(recording.length / RATE).toFixed(1)} s, firing every ${((period / RATE) * 1000).toFixed(1)} ms ` +
    `(${(RATE / period).toFixed(1)} Hz), ${marks.length} pulses`,
);

mkdirSync(OUT_DIR, { recursive: true });
if (preview) {
  mkdirSync(preview, { recursive: true });
}
const loops = LOOP_RPMS.map((rpm) => makeLoop(recording, marks, rpm / RECORDED_RPM));
const lift = 10 ** (LOOP_RMS_DB / 20) / rms(loops[0]);
loops.forEach((loop, index) => {
  let peak = 0;
  for (let i = 0; i < loop.length; i++) {
    loop[i] *= lift;
    peak = Math.max(peak, Math.abs(loop[i]));
  }
  if (peak >= 1) {
    throw new Error(`loop ${LOOP_RPMS[index]} clips (peak ${peak.toFixed(2)}): lower LOOP_RMS_DB`);
  }
  const name = `diesel-${LOOP_RPMS[index]}`;
  encode(loop, new URL(`${name}.ogg`, OUT_DIR));
  if (preview) {
    writeFileSync(join(preview, `${name}.wav`), wav(loop));
  }
  console.log(`${name}: ${(20 * Math.log10(rms(loop))).toFixed(1)} dBFS RMS, peak ${(20 * Math.log10(peak)).toFixed(1)} dBFS`);
});

/** The recording as mono samples at RATE, its DC taken out. */
function decode(file, start, end) {
  const range = ['-ss', String(start), ...(end === null ? [] : ['-to', String(end)])];
  const raw = execFileSync(FFMPEG, ['-v', 'error', ...range, '-i', file, '-ac', '1', '-ar', String(RATE), '-af', 'highpass=f=20', '-f', 'f32le', '-'], {
    maxBuffer: 1 << 30,
  });
  return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
}

/** The pulses' outline: the sound rectified and smoothed (a one-pole low-pass at `hz`). */
function envelope(x, hz) {
  const a = Math.exp((-2 * Math.PI * hz) / RATE);
  const y = new Float32Array(x.length);
  let s = 0;
  for (let i = 0; i < x.length; i++) {
    s = (1 - a) * Math.abs(x[i]) + a * s;
    y[i] = s;
  }
  return y;
}

/** Samples between firings: the strongest repeat of the outline among the firing rates an engine idles at. */
function firingPeriod(x) {
  const env = envelope(x, 200);
  let mean = 0;
  for (const v of env) mean += v;
  mean /= env.length;
  const span = Math.min(env.length - Math.ceil(RATE / MIN_FIRING_HZ), RATE * 8);
  let best = 0;
  let bestLag = 0;
  for (let lag = Math.floor(RATE / MAX_FIRING_HZ); lag <= Math.ceil(RATE / MIN_FIRING_HZ); lag++) {
    let s = 0;
    for (let i = 0; i < span; i++) s += (env[i] - mean) * (env[i + lag] - mean);
    if (s > best) {
      best = s;
      bestLag = lag;
    }
  }
  // A whole engine cycle repeats too, at a multiple: take the shortest lag nearly as strong as the best.
  for (let divisor = 6; divisor >= 2; divisor--) {
    const lag = Math.round(bestLag / divisor);
    if (lag < RATE / MAX_FIRING_HZ) continue;
    let s = 0;
    for (let i = 0; i < span; i++) s += (env[i] - mean) * (env[i + lag] - mean);
    if (s > 0.8 * best) return lag;
  }
  return bestLag;
}

/** Where each firing pulse peaks: from the strongest in the first period on, the outline's peak a period (±25%) after the last. */
function pulseMarks(x, period) {
  const env = envelope(x, 400);
  const marks = [];
  let at = argmax(env, 0, period);
  let local = period;
  while (at + 2 * period < env.length) {
    marks.push(at);
    const next = argmax(env, at + Math.round(0.75 * local), at + Math.round(1.25 * local));
    local = 0.8 * local + 0.2 * (next - at);
    at = next;
  }
  return marks;
}

function argmax(values, from, to) {
  let best = from;
  for (let i = from; i < to; i++) if (values[i] > values[best]) best = i;
  return best;
}

/**
 * A loop LOOP_SECONDS long of the engine `ratio` times as fast as recorded: the recording's pulses in order, one
 * a firing, each read REVS_IN_PITCH of the way faster, overlap-added with weights that rise just before each mark
 * and die away after it, normalised by the weights' sum, wrapping round at the end.
 */
function makeLoop(x, marks, ratio) {
  const length = LOOP_SECONDS * RATE;
  const pitch = ratio ** REVS_IN_PITCH;
  const pulses = Math.round(length / (averagePeriod(marks) / ratio));
  if (pulses + 2 > marks.length) {
    throw new Error(`${ratio.toFixed(2)}× needs ${pulses} pulses; the recording has ${marks.length}`);
  }
  // The pulses keep the recording's own rhythm, its small unevenness, squeezed to fit the loop exactly.
  const scale = length / (marks[pulses] - marks[0]);
  const sum = new Float64Array(length);
  const weights = new Float64Array(length);
  for (let p = 0; p < pulses; p++) {
    const mark = marks[p];
    const centre = (mark - marks[0]) * scale;
    const outPeriod = (marks[p + 1] - mark) * scale;
    const lead = LEAD_IN * outPeriod;
    const tau = DECAY * outPeriod;
    // Each pulse is heard until its weight is a fiftieth of the newest's.
    const reach = Math.ceil(outPeriod + tau * Math.log(50));
    for (let k = -Math.ceil(lead); k <= reach; k++) {
      const t = Math.round(centre) + k;
      const weight = k < 0 ? 0.5 - 0.5 * Math.cos((Math.PI * (k + lead)) / lead) : Math.exp(-k / tau);
      if (weight <= 0) continue;
      const read = mark + k * pitch;
      const i = Math.floor(read);
      if (i < 0 || i + 1 >= x.length) continue;
      const sample = x[i] + (x[i + 1] - x[i]) * (read - i);
      const at = ((t % length) + length) % length;
      sum[at] += weight * sample;
      weights[at] += weight;
    }
  }
  const loop = new Float32Array(length);
  for (let i = 0; i < length; i++) loop[i] = weights[i] > 0 ? sum[i] / weights[i] : 0;
  return loop;
}

function averagePeriod(marks) {
  return (marks.at(-1) - marks[0]) / (marks.length - 1);
}

function rms(x) {
  let s = 0;
  for (const v of x) s += v * v;
  return Math.sqrt(s / x.length);
}

/** Ogg Opus, mono: small, and decoded to the sample by browsers, so the loop's end meets its start. */
function encode(samples, file) {
  execFileSync(
    FFMPEG,
    ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(RATE), '-ac', '1', '-i', '-', '-c:a', 'libopus', '-b:a', '64k', '-application', 'audio', file.pathname.replace(/^\/([A-Za-z]:)/, '$1')],
    { input: Buffer.from(samples.buffer) },
  );
}

/** 16-bit PCM WAV. */
function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
