// The Google Play listing's trailer: 30 seconds at 3840 × 2160 and 30 FPS, one in each of the game's languages
// (and a 1080p copy of each). Everything in it is the game itself (scripts/trailer/shoot.mjs): the production build
// in headless Google Chrome on the machine's GPU, its camera moved through the scenes (cameras.mjs), each frame the
// average of sub-frames, the HUD and the panels as a phone shows them, and the game's own sound under the shots. The
// cut follows a 128 BPM beat (timeline.mjs, edit.mjs), the words are in each language (captions.mjs), and the music
// is synthesised to the same beat (music.mjs). Original throughout (spec §85): the game's own world and brand,
// Oswald (SIL OFL) for the words, no samples. Nothing in it sells: Google Play's rules for a listing's video.
//
//   npm run build && node scripts/storeVideo.mjs [--lang=en,tr] [--fresh]
//
// writes store-video/trailer/roadhaul-trailer-<lang>.mp4 (4K, H.264 and AAC, BT.709, streaming loudness) and
// roadhaul-trailer-<lang>-1080p.mp4, keeping the footage in store-video/trailer/shots for the next cut: a shot is
// taken again only when its entry in edit.mjs changes (or with --fresh). Needs Google Chrome and ffmpeg (with libx264)
// on the PATH, or ffmpeg's path in FFMPEG. On a desktop GPU the shoot takes a few minutes, and each language's cut a
// few more. Google Play takes the video as a YouTube link: docs/RELEASE.md.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { ROOT, brandDrawings, serveBuild } from './storeKit.mjs';
import { wavFile } from './trailer/audio.mjs';
import { LANGUAGES } from './trailer/captions.mjs';
import { cut } from './trailer/cut.mjs';
import { SHOTS, plan, shotFolder } from './trailer/edit.mjs';
import { mix } from './trailer/mix.mjs';
import { music } from './trailer/music.mjs';
import { shootShot } from './trailer/shoot.mjs';

const OUT = join(ROOT, 'store-video/trailer');
const SHOTS_DIR = join(OUT, 'shots');
const PORT = 4181;
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const fresh = process.argv.includes('--fresh');
const langArg = process.argv.find((arg) => arg.startsWith('--lang='));
const languages = langArg ? langArg.slice(7).split(',') : Object.keys(LANGUAGES);

function ffmpeg(args) {
  const result = spawnSync(FFMPEG, ['-hide_banner', '-y', ...args], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`ffmpeg failed: ${result.error?.message ?? result.stderr.slice(-2000)}`);
  }
  return result.stderr;
}

/** A float mix as a 16-bit WAV (dithered), then at streaming loudness (-14 LUFS, true peak under -1.5 dBTP). */
function master(sound, file) {
  const raw = file.replace(/\.wav$/, '-raw.wav');
  const pcm = Buffer.alloc(sound.left.length * 4);
  let seed = 0x52484c;
  const dither = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296 - 0.5;
  };
  for (let i = 0; i < sound.left.length; i++) {
    for (const [channel, value] of [sound.left[i], sound.right[i]].entries()) {
      const sample = Math.round(Math.max(-1, Math.min(1, value)) * 32767 + dither() + dither());
      pcm.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), i * 4 + channel * 2);
    }
  }
  writeFileSync(raw, wavFile(pcm));
  const target = 'I=-14:TP=-1.5:LRA=11';
  const report = ffmpeg(['-i', raw, '-af', `loudnorm=${target}:print_format=json`, '-f', 'null', '-']);
  const measured = JSON.parse(report.slice(report.lastIndexOf('{'), report.lastIndexOf('}') + 1));
  const pass = `loudnorm=${target}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true`;
  ffmpeg(['-i', raw, '-af', `${pass},aresample=48000`, '-c:a', 'pcm_s16le', file]);
  return file;
}

/** The shots each language needs (a shot with the HUD or a panel is taken in each), WORKERS browsers at once. */
async function shoot(baseUrl) {
  const jobs = [];
  for (const shot of SHOTS) {
    for (const lang of shot.localized ? languages : ['en']) {
      const dir = join(SHOTS_DIR, shotFolder(shot.id, shot.localized ? lang : null));
      if (fresh) rmSync(dir, { recursive: true, force: true });
      jobs.push({ shot: { ...shot, id: shotFolder(shot.id, shot.localized ? lang : null) }, lang });
    }
  }
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    for (const job of jobs) {
      const started = Date.now();
      const taken = await shootShot(browser, baseUrl, job.shot, SHOTS_DIR, { lang: job.lang });
      console.log(`${job.shot.id}: ${taken ? `shot in ${Math.round((Date.now() - started) / 1000)} s` : 'kept'}`);
    }
    const brandFile = join(OUT, 'brand.json');
    if (!existsSync(brandFile)) {
      const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
      await page.goto(`${baseUrl}?quality=low`);
      await page.waitForFunction(() => document.documentElement.dataset.gameState === 'mainMenu');
      const { markSvg, wordSvg } = await brandDrawings(page);
      writeFileSync(brandFile, JSON.stringify({ mark: markSvg, word: wordSvg }));
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

if (spawnSync(FFMPEG, ['-version']).status !== 0) {
  console.error('No ffmpeg: install it (with libx264), or set FFMPEG to its path.');
  process.exit(1);
}
mkdirSync(SHOTS_DIR, { recursive: true });
const stop = await serveBuild(PORT);
try {
  await shoot(`http://127.0.0.1:${PORT}/`);
} finally {
  stop();
}
const brandSvg = JSON.parse(readFileSync(join(OUT, 'brand.json'), 'utf8'));
const score = music();
const browser = await chromium.launch({ channel: 'chrome' });
try {
  for (const lang of languages) {
    const cutPlan = plan(lang, SHOTS_DIR);
    const sound = master(mix(score, cutPlan, SHOTS_DIR), join(OUT, `sound-${lang}.wav`));
    const file = join(OUT, `roadhaul-trailer-${lang}.mp4`);
    const small = join(OUT, `roadhaul-trailer-${lang}-1080p.mp4`);
    const started = Date.now();
    await cut(browser, {
      ffmpeg: FFMPEG,
      dir: OUT,
      plan: cutPlan,
      brandSvg,
      lang,
      sound,
      file,
      small,
      onProgress: (frame, frames) => {
        if (frame % 150 === 0) console.log(`${lang}: frame ${frame} of ${frames}`);
      },
    });
    console.log(`${lang}: ${file} (${Math.round((Date.now() - started) / 1000)} s)`);
  }
} finally {
  await browser.close();
}
