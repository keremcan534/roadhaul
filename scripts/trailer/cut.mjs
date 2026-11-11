// The trailer's cut: a page draws each frame over the footage (compose.js), 3840 × 2160 from a layout of 1920 ×
// 1080, and ffmpeg encodes the frames with the sound: H.264 High in BT.709 for YouTube, and a 1080p copy.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AMBER, BRAND_CSS, FONT_FACES, ROOT } from '../storeKit.mjs';

const SCALE = 2;

/** The page that draws the cut: its layers, the words' styles, the brand's drawings and compose.js. */
export function trailerPage({ plan, brandSvg, lang }) {
  const script = readFileSync(join(ROOT, 'scripts/trailer/compose.js'), 'utf8');
  const word = brandSvg.word.replace('<svg', '<svg id="brand-word"');
  const tagline = plan.tagline.join(' ').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>${FONT_FACES}</style><style>
html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#000}
#stage{position:relative;width:1920px;height:1080px;overflow:hidden;background:#000;font-family:Oswald,sans-serif}
.layer,.clip{position:absolute;inset:0}
.clip{display:none;transform-origin:50% 50%}
.clip img{display:block;width:100%;height:100%;object-fit:cover}
#shade{background:radial-gradient(130% 95% at 0% 100%,rgba(10,7,12,.6) 0%,rgba(10,7,12,.3) 38%,rgba(10,7,12,0) 66%);opacity:0}
.caption{position:absolute;display:none;color:#fff;text-transform:uppercase;--size:124px;
  text-shadow:0 6px 30px rgba(10,6,14,.55),0 2px 5px rgba(0,0,0,.35)}
.caption__bar{width:84px;height:9px;border-radius:5px;background:${AMBER};transform-origin:0 50%;margin:0 0 22px 6px}
.caption__line{font:700 var(--size)/1.04 Oswald,sans-serif;letter-spacing:.01em;overflow:hidden;white-space:nowrap;padding:0 .1em .03em 0}
.caption__word,.caption__letter{display:inline-block}
.is-accent{color:${AMBER}}
.at-lower{left:104px;bottom:92px}
.at-side{left:64px;bottom:84px;--size:112px}
.at-side .caption__bar{margin-left:4px}
.at-finale{left:104px;--size:176px}
.at-finale .caption__bar{display:none}
.at-finale.is-white .caption__line{color:#fff}
.at-finale:not(.is-white) .caption__line{color:${AMBER}}
.is-finale-0{top:150px}.is-finale-1{top:360px}.is-finale-2{top:570px}
#brand-shade{background:radial-gradient(80% 70% at 50% 46%,rgba(8,6,12,.72) 0%,rgba(8,6,12,.35) 60%,rgba(8,6,12,.15) 100%);opacity:0}
#brand{display:none}
#brand-lockup{position:absolute;left:0;right:0;top:350px;display:flex;justify-content:center;align-items:center;gap:40px}
#brand-tile{width:168px;height:168px;border-radius:22%}
#brand-word{width:740px;height:auto;color:#fff;--rh-accent:${AMBER};overflow:visible;filter:drop-shadow(0 6px 22px rgba(0,0,0,.45))}
#brand-tagline{position:absolute;left:0;right:0;top:584px;text-align:center;font:600 58px/1.1 Oswald,sans-serif;color:#fff;
  text-transform:uppercase;text-shadow:0 4px 24px rgba(0,0,0,.6)}
#flash{background:#fff;opacity:0}
#dip,#fade{background:#000;opacity:0}
${BRAND_CSS}
</style></head><body>
<svg width="0" height="0" style="position:absolute"><filter id="whip" x="-20%" width="140%"><feGaussianBlur id="whip-blur" stdDeviation="0 0"/></filter></svg>
<div id="stage">
  <div id="clip-a" class="clip"><img alt=""></div>
  <div id="clip-b" class="clip"><img alt=""></div>
  <div id="shade" class="layer"></div>
  <div id="brand-shade" class="layer"></div>
  <div id="copy" class="layer"></div>
  <div id="brand" class="layer">
    <div id="brand-lockup"><div id="brand-tile" class="tile">${brandSvg.mark}</div>${word}</div>
    <div id="brand-tagline">${tagline}</div>
  </div>
  <div id="flash" class="layer"></div>
  <div id="dip" class="layer"></div>
  <div id="fade" class="layer"></div>
</div>
<script>window.TRAILER = ${JSON.stringify(plan)};</script>
<script>${script}</script>
</body></html>`;
}

/** Draws `plan` frame by frame in `browser` into ffmpeg, with `sound` (a WAV), as `file` (4K) and `small` (1080p). */
export async function cut(browser, { ffmpeg, dir, plan, brandSvg, lang, sound, file, small, onProgress }) {
  const pageFile = join(dir, `trailer-${lang}.html`);
  writeFileSync(pageFile, trailerPage({ plan, brandSvg, lang }));
  const tab = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: SCALE });
  tab.setDefaultTimeout(120_000);
  const problems = [];
  tab.on('pageerror', (error) => problems.push(error.message));
  await tab.goto(pathToFileURL(pageFile).href);
  await tab.evaluate(() => document.fonts.ready);
  // prettier-ignore
  const encoder = spawn(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'image2pipe', '-framerate', String(plan.fps), '-c:v', 'mjpeg', '-i', '-',
    '-i', sound,
    '-filter_complex', '[0:v]scale=in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p,split[big][s];' +
      '[s]scale=1920:1080:flags=lanczos[small]',
    '-map', '[big]', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-maxrate', '60M', '-bufsize', '120M', '-profile:v', 'high', '-level', '5.1',
    '-g', String(plan.fps / 2), '-bf', '2', '-flags', '+cgop',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-c:a', 'aac', '-b:a', '384k', '-ar', '48000', '-shortest', '-movflags', '+faststart', file,
    '-map', '[small]', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-profile:v', 'high', '-g', String(plan.fps / 2), '-bf', '2',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-shortest', '-movflags', '+faststart', small,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const finished = new Promise((resolve, reject) =>
    encoder.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg stopped (${code})`)))),
  );
  const frames = Math.round(plan.duration * plan.fps);
  try {
    for (let frame = 0; frame < frames; frame++) {
      await tab.evaluate((t) => window.renderAt(t), frame / plan.fps);
      if (problems.length > 0) {
        throw new Error(`The cut's page failed: ${problems.join('; ')}`);
      }
      const jpeg = await tab.screenshot({ type: 'jpeg', quality: 98 });
      if (!encoder.stdin.write(jpeg)) {
        await new Promise((resolve) => encoder.stdin.once('drain', resolve));
      }
      onProgress?.(frame, frames);
    }
  } finally {
    encoder.stdin.end();
    await tab.close();
  }
  await finished;
}

/** One frame of the cut at `t` as a JPEG (for reviewing a cut without encoding it). */
export async function still(browser, { dir, plan, brandSvg, lang, t }) {
  const pageFile = join(dir, `trailer-${lang}.html`);
  writeFileSync(pageFile, trailerPage({ plan, brandSvg, lang }));
  const tab = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  try {
    await tab.goto(pathToFileURL(pageFile).href);
    const shots = [];
    for (const time of [].concat(t)) {
      await tab.evaluate((at) => window.renderAt(at), time);
      shots.push(await tab.screenshot({ type: 'jpeg', quality: 90 }));
    }
    return shots;
  } finally {
    await tab.close();
  }
}
