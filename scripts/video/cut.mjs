// The store video's cut (scripts/storeVideo.mjs): a page draws each frame over the footage (promo.js, on
// timeline.mjs's beat), and ffmpeg encodes the frames with the soundtrack.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AMBER, ASPHALT, BRAND_CSS, FONT_FACES, ROOT } from '../storeKit.mjs';
import { CLIPS, FPS } from './shoot.mjs';
import * as timeline from './timeline.mjs';

/** The page that draws the cut: the stage's layers, the brand's drawings, the words' styles and promo.js. */
export function promoPage(notes) {
  const clips = Object.fromEntries(CLIPS.map((clip) => [clip.id, Math.round(clip.seconds * FPS)]));
  const data = { timeline: { ...timeline }, clips, stills: notes };
  const script = readFileSync(join(ROOT, 'scripts/video/promo.js'), 'utf8');
  const wordmark = notes.brand.word.replace('<svg', '<svg id="end-word"');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${FONT_FACES}</style><style>
html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#000}
#stage{position:relative;width:1920px;height:1080px;overflow:hidden;background:${ASPHALT};font-family:Oswald,sans-serif}
.layer,#footage,#backdrop,#shade,#copy,#phones{position:absolute;inset:0}
#footage,#backdrop{display:none;transform-origin:50% 50%}
#footage img,#backdrop img{display:block;width:100%;height:100%;object-fit:cover}
#map{position:absolute;left:0;top:0;display:none;width:1830px;height:824px;transform-origin:0 0}
#map img{display:block;width:1830px;height:824px}
.roadline{position:absolute;left:0;width:1920px;height:8px;display:none;transform-origin:0 50%;
  background:repeating-linear-gradient(90deg,${AMBER} 0 110px,transparent 110px 180px);filter:drop-shadow(0 0 10px rgba(242,163,58,.7))}
#phones{perspective:2400px}
.phone{position:absolute;left:0;top:0;display:none;padding:26px;border-radius:70px;transform-style:preserve-3d;
  background:linear-gradient(150deg,#34373e,#101114 38%,#08090b);
  box-shadow:0 70px 160px rgba(0,0,0,.62),inset 0 0 0 3px rgba(255,255,255,.08),0 0 0 2px rgba(0,0,0,.85)}
.phone::before{content:'';position:absolute;left:9px;top:50%;width:12px;height:12px;margin-top:-6px;border-radius:50%;background:#1d2026}
.phone__screen{position:relative;width:1830px;height:824px;border-radius:46px;overflow:hidden;background:#000}
.phone__screen img{position:absolute;inset:0;width:100%;height:100%}
.phone__next{opacity:0}
.tap{position:absolute;display:none;width:0;height:0}
.tap__ring{position:absolute;left:0;top:0;width:170px;height:170px;border-radius:50%;border:9px solid #fff;box-shadow:0 0 34px rgba(0,0,0,.35)}
.tap__dot{position:absolute;left:0;top:0;width:120px;height:120px;border-radius:50%;background:rgba(255,255,255,.6);box-shadow:0 0 0 8px rgba(255,255,255,.25),0 8px 30px rgba(0,0,0,.3)}
.words{position:absolute;color:#fff;text-transform:uppercase;text-shadow:0 6px 30px rgba(10,6,14,.5),0 2px 4px rgba(0,0,0,.25)}
.words__bar{width:76px;height:8px;border-radius:4px;background:${AMBER};transform-origin:0 50%;margin:0 0 20px 6px}
.words__kicker{font:500 34px/1.2 Oswald,sans-serif;letter-spacing:.24em;color:rgba(255,248,240,.94);margin:0 0 8px 6px}
.words__line{font:700 150px/1 Oswald,sans-serif;letter-spacing:.005em;overflow:hidden;white-space:nowrap;padding:0 .08em .02em 0}
.words__letter{display:inline-block}
.is-accent{color:${AMBER}}
.at-top{left:110px;top:84px}
.at-left{left:110px;top:330px}
.at-left.is-paid{top:190px}
.at-centre{left:0;right:0;top:370px;text-align:center}
.at-centre .words__bar{margin:0 auto 20px}
.at-centre .words__kicker{margin:0 0 8px}
.at-world{left:110px;bottom:236px}
.is-world{left:110px;bottom:104px}
.is-world .words__line{font-size:128px}
.at-map{left:110px;top:330px}
.at-finale{left:110px}
.at-finale .words__line{font-size:196px;line-height:1.02}
.is-finale-0{top:120px}.is-finale-1{top:340px}.is-finale-2{top:560px}
#world-line{position:absolute;left:116px;bottom:58px;display:none;font:500 30px/1 Oswald,sans-serif;letter-spacing:.22em;
  text-transform:uppercase;color:rgba(255,248,240,.88);text-shadow:0 3px 14px rgba(0,0,0,.5)}
#counter{position:absolute;left:104px;top:640px;display:none;transform-origin:0 50%;color:${AMBER};font:700 200px/1 Oswald,sans-serif;
  text-shadow:0 10px 44px rgba(0,0,0,.45)}
#counter small{display:block;margin:4px 0 0 10px;font:500 36px/1 Oswald,sans-serif;letter-spacing:.3em;color:rgba(255,248,240,.92)}
#wipe{position:absolute;top:-25%;bottom:-25%;left:-15%;width:130%;display:none;
  background:linear-gradient(90deg,#d9862a,${AMBER} 30%,#ffc977 50%,${AMBER} 70%,#d9862a)}
#flash{background:#fff;opacity:0}
#grain{opacity:.075;mix-blend-mode:overlay;background-size:512px 512px}
#vignette{background:radial-gradient(125% 105% at 50% 50%,rgba(0,0,0,0) 58%,rgba(0,0,0,.38) 100%)}
#end{display:none}
#end-lockup{position:absolute;left:0;right:0;top:300px;display:flex;justify-content:center;align-items:center;gap:44px}
#end-tile{width:176px;height:176px}
#end-word{width:780px;height:auto;color:#fff;--rh-accent:${AMBER};overflow:visible}
#end-motto{position:absolute;left:0;right:0;top:500px;text-align:center;text-indent:.55em;font:500 32px/1 Oswald,sans-serif;
  letter-spacing:.55em;color:rgba(255,248,240,.88);text-transform:uppercase}
#end-tagline{position:absolute;left:0;right:0;top:584px;text-align:center;font:700 70px/1 Oswald,sans-serif;color:#fff;
  text-transform:uppercase;letter-spacing:.02em}
#end-pill-row{position:absolute;left:0;right:0;top:722px;display:flex;justify-content:center}
#end-pill{padding:16px 50px 18px;border-radius:999px;background:${AMBER};color:${ASPHALT};font:700 46px/1 Oswald,sans-serif;
  letter-spacing:.08em;text-transform:uppercase;box-shadow:0 14px 44px rgba(242,163,58,.38)}
#end-small{position:absolute;left:0;right:0;top:846px;text-align:center;font:500 32px/1 Oswald,sans-serif;letter-spacing:.14em;
  color:rgba(255,248,240,.9);text-transform:uppercase}
${BRAND_CSS}
</style></head><body>
<svg width="0" height="0" style="position:absolute"><filter id="whip" x="-10%" width="120%"><feGaussianBlur stdDeviation="0 0"/></filter></svg>
<div id="stage">
  <div id="footage"><img alt=""></div>
  <div id="backdrop"><img alt=""></div>
  <div id="map"><img alt=""></div>
  <div id="line-top" class="roadline"></div><div id="line-bottom" class="roadline"></div>
  <div id="shade"></div>
  <div id="phones"></div>
  <div id="copy"></div>
  <div id="world-line">Day and night · Rain and snow · Four seasons</div>
  <div id="counter"><span id="counter-value">+0</span><small>credits</small></div>
  <div id="end" class="layer">
    <div id="end-lockup"><div id="end-tile" class="tile">${notes.brand.mark}</div>${wordmark}</div>
    <div id="end-motto">Drive · Deliver · Grow</div>
    <div id="end-tagline">Build your own trucking company</div>
    <div id="end-pill-row"><div id="end-pill">Free on Android</div></div>
    <div id="end-small">Plays offline · 10 languages</div>
  </div>
  <div id="wipe"></div>
  <div id="flash" class="layer"></div>
  <div id="vignette" class="layer"></div>
  <div id="grain" class="layer"></div>
</div>
<script>window.PROMO = ${JSON.stringify(data)};</script>
<script>${script}</script>
</body></html>`;
}

/** Draws the cut frame by frame into ffmpeg, with the soundtrack, as `file`. */
export async function cut(browser, { ffmpeg, dir, notes, sound, file }) {
  const page = join(dir, 'promo.html');
  writeFileSync(page, promoPage(notes));
  const tab = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  tab.setDefaultTimeout(120_000);
  const problems = [];
  tab.on('pageerror', (error) => problems.push(error.message));
  await tab.goto(pathToFileURL(page).href);
  await tab.evaluate(() => document.fonts.ready);
  // prettier-ignore
  const encoder = spawn(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-i', sound,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart',
    file,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const finished = new Promise((resolve, reject) =>
    encoder.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg stopped (${code})`)))),
  );
  const frames = Math.round(timeline.DURATION * FPS);
  for (let frame = 0; frame < frames; frame++) {
    await tab.evaluate((t) => window.renderAt(t), frame / FPS);
    if (problems.length > 0) {
      throw new Error(`The cut's page failed: ${problems.join('; ')}`);
    }
    const jpeg = await tab.screenshot({ type: 'jpeg', quality: 95 });
    if (!encoder.stdin.write(jpeg)) {
      await new Promise((resolve) => encoder.stdin.once('drain', resolve));
    }
    if (frame % 60 === 0) {
      console.log(`Cut: ${frame / FPS} s of ${timeline.DURATION}`);
    }
  }
  encoder.stdin.end();
  await finished;
  await tab.close();
}

