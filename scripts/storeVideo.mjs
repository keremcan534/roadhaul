// The Google Play listing's promo video: 32 seconds, 1920 × 1080 at 30 FPS, in English. The footage is the game
// itself (scripts/video/shoot.mjs): clips of the truck on the road, shot frame by frame from the production build
// in headless Chromium, and stills of its panels at a phone's size. A page draws the cut over them, the words and
// the brand moving on a 120 BPM beat (scripts/video/promo.js, timeline.mjs), and the soundtrack is synthesised to
// the same beat (scripts/video/soundtrack.mjs). Original throughout (spec §85): the game's own world and brand,
// Oswald (SIL OFL) for the words, no samples.
//
//   npm run build && node scripts/storeVideo.mjs [--fresh]
//
// writes store-video/roadhaul-promo.mp4 (H.264 and AAC, streaming loudness), with the footage kept in store-video/
// for the next cut: a clip is shot again only when its entry in CLIPS changes, the stills with --fresh. Needs
// ffmpeg (with libx264) on the PATH, or its path in FFMPEG. Drawn in software, shooting takes an hour or so on
// four cores and the cut a few minutes. Google Play takes the video as a YouTube link: docs/RELEASE.md.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { ROOT, serveBuild } from './storeKit.mjs';
import { cut } from './video/cut.mjs';
import { CLIPS, STILLS, shootClip, shootStills } from './video/shoot.mjs';
import { soundtrack, wav } from './video/soundtrack.mjs';

const OUT = join(ROOT, 'store-video');
const PORT = 4181;
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
/** Browsers shooting at once: each draws in software on several threads. */
const WORKERS = 2;
const fresh = process.argv.includes('--fresh');

function ffmpeg(args, input) {
  const result = spawnSync(FFMPEG, ['-hide_banner', '-y', ...args], { input, encoding: 'utf8', maxBuffer: 1 << 26 });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`ffmpeg failed: ${result.error?.message ?? result.stderr.slice(-2000)}`);
  }
  return result.stderr;
}

/** The clips and the stills, shot by WORKERS browsers at once; what is already shot is kept. */
async function shoot(baseUrl) {
  const stillsDir = join(OUT, 'stills');
  const record = join(stillsDir, 'stills.json');
  const haveStills = !fresh && existsSync(record) && STILLS.every((name) => existsSync(join(stillsDir, `${name}.png`)));
  const jobs = [
    ...(haveStills ? [] : [{ name: 'stills', run: (browser) => shootStills(browser, baseUrl, stillsDir) }]),
    ...CLIPS.map((clip) => ({ name: `clip ${clip.id}`, run: (browser) => shootClip(browser, baseUrl, clip, join(OUT, 'clips')) })),
  ];
  const worker = async () => {
    const browser = await chromium.launch();
    try {
      for (let job = jobs.shift(); job !== undefined; job = jobs.shift()) {
        const started = Date.now();
        const shot = await job.run(browser);
        console.log(`${job.name}: ${shot === false ? 'kept' : `shot in ${Math.round((Date.now() - started) / 1000)} s`}`);
      }
    } finally {
      await browser.close();
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, worker));
  return JSON.parse(readFileSync(record, 'utf8'));
}

/** The soundtrack at streaming loudness (-14 LUFS, peaks under -1.5 dBTP): ffmpeg's loudnorm, measured first. */
function score() {
  const raw = join(OUT, 'soundtrack-raw.wav');
  const file = join(OUT, 'soundtrack.wav');
  writeFileSync(raw, wav(soundtrack()));
  const target = 'I=-14:TP=-1.5:LRA=11';
  const report = ffmpeg(['-i', raw, '-af', `loudnorm=${target}:print_format=json`, '-f', 'null', '-']);
  const measured = JSON.parse(report.slice(report.lastIndexOf('{'), report.lastIndexOf('}') + 1));
  const pass = `loudnorm=${target}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true`;
  ffmpeg(['-i', raw, '-af', `${pass},aresample=48000`, '-c:a', 'pcm_s16le', file]);
  return file;
}

if (spawnSync(FFMPEG, ['-version']).status !== 0) {
  console.error('No ffmpeg: install it (with libx264), or set FFMPEG to its path.');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });
const stop = await serveBuild(PORT);
let notes;
try {
  notes = await shoot(`http://127.0.0.1:${PORT}/`);
} finally {
  stop();
}
const sound = score();
const browser = await chromium.launch();
try {
  const file = join(OUT, 'roadhaul-promo.mp4');
  await cut(browser, { ffmpeg: FFMPEG, dir: OUT, notes, sound, file });
  console.log(`Video: ${file}`);
} finally {
  await browser.close();
}
