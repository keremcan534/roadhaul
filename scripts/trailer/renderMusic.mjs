// Renders the trailer's music (music.mjs) to store-video/music/music.wav and prints what it measures: the loudness
// (integrated, range), the peaks, each section's level and stereo width, the DC, and how long the render took.
//
//   node scripts/trailer/renderMusic.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CUES, SAMPLE_RATE, loudness, music, truePeakDb, wav } from './music.mjs';
import { DURATION, SECTIONS, beat } from './timeline.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = join(root, 'store-video', 'music');

const started = performance.now();
const sound = music({ stems: true });
const seconds = (performance.now() - started) / 1000;
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'music.wav'), wav(sound));

const { left, right } = sound;
const db = (value) => (20 * Math.log10(Math.max(value, 1e-12))).toFixed(1);
const span = (from, to) => [Math.round(from * SAMPLE_RATE), Math.min(left.length, Math.round(to * SAMPLE_RATE))];

/** RMS, peak, L/R correlation and side-to-mid ratio of a span of the music. */
function stats(from, to, channels = sound) {
  const [a, b] = span(from, to);
  let sum = 0;
  let peak = 0;
  let lr = 0;
  let ll = 0;
  let rr = 0;
  let mid = 0;
  let side = 0;
  for (let i = a; i < b; i++) {
    const l = channels.left[i];
    const r = channels.right[i];
    sum += 0.5 * (l * l + r * r);
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
    lr += l * r;
    ll += l * l;
    rr += r * r;
    mid += ((l + r) / 2) ** 2;
    side += ((l - r) / 2) ** 2;
  }
  return {
    rms: Math.sqrt(sum / Math.max(1, b - a)),
    peak,
    correlation: lr / Math.sqrt(ll * rr + 1e-20),
    width: Math.sqrt(side / (mid + 1e-20)),
  };
}

const measured = loudness(sound);
console.log(`Rendered ${DURATION.toFixed(3)} s (${left.length} frames at ${SAMPLE_RATE} Hz) in ${seconds.toFixed(1)} s -> ${join(out, 'music.wav')}`);
console.log(
  `Integrated ${measured.integrated.toFixed(1)} LUFS, range ${measured.range.toFixed(1)} LU, true peak ${truePeakDb(sound).toFixed(2)} dBTP, ` +
    `sample peak ${db(stats(0, DURATION).peak)} dBFS; glue ${sound.reductions.glueDb.toFixed(1)} dB, limiter ${sound.reductions.limiterDb.toFixed(1)} dB at most`,
);
const dc = [left, right].map((channel) => channel.reduce((sum, value) => sum + value, 0) / channel.length);
console.log(`DC ${dc.map((value) => value.toExponential(1)).join(' / ')}; last 10 ms peak ${db(stats(DURATION - 0.01, DURATION).peak)} dBFS`);

console.log('\nsection   beats   time            RMS dBFS  LUFS   peak   corr  side/mid | drums  pads  bass  lead   fx  hall (RMS dBFS)');
SECTIONS.forEach((section, index) => {
  const to = SECTIONS[index + 1]?.from ?? 64;
  const [from, end] = [beat(section.from), beat(to)];
  const s = stats(from, end);
  const stems = ['drums', 'pads', 'bass', 'lead', 'fx', 'hall'].map((name) => db(stats(from, end, sound.stems[name]).rms).padStart(5));
  console.log(
    `${section.id.padEnd(9)} ${`${section.from}-${to}`.padEnd(7)} ${`${from.toFixed(2)}-${end.toFixed(2)} s`.padEnd(15)} ${db(s.rms).padStart(8)}  ` +
      `${measured.window(from, end).toFixed(1).padStart(5)}  ${db(s.peak).padStart(5)}  ${s.correlation.toFixed(2)}  ${s.width.toFixed(2).padStart(8)} | ${stems.join(' ')}`,
  );
});

// Short-term loudness every second, for the arc.
const arc = [];
for (let t = 0; t + 1 <= DURATION + 1e-9; t += 1) {
  arc.push(measured.window(t, t + 1).toFixed(0));
}
console.log(`\nLoudness each second (LUFS): ${arc.join(' ')}`);
console.log(
  `Pockets (RMS dBFS): horn ${db(stats(CUES.horn, CUES.horn + 1).rms)} (the open after it ${db(stats(beat(6), beat(8)).rms)}), ` +
    `thunder ${db(stats(...CUES.thunder).rms)} (the world around it ${db(stats(beat(24), beat(28)).rms)})`,
);
console.log(`Cues: ${JSON.stringify(CUES)}`);
