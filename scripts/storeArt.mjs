// Draws the Google Play listing's art from the game itself: a scene captured
// from the production build, a screenshot with a caption in each listing's
// language, and the feature graphic. Original art (spec §85): the game's own
// world and brand, and Oswald (scripts/fonts, SIL Open Font License) for the
// captions. The 512 px store icon comes from scripts/androidIcons.mjs.
//
//   npm run build && node scripts/storeArt.mjs
//
// writes into fastlane/metadata/android:
//   <locale>/images/phoneScreenshots/01.jpg  1920 × 1080, the caption in that language
//   en-US/images/featureGraphic.jpg          1024 × 500, the brand on the scene (no words, so every listing shares it)
//
// It serves dist/ on a spare port, drives the game in headless Chromium
// (Playwright, as the end-to-end tests do) and composes the art on a plain
// page. A game drawn in software takes a minute or two.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LISTINGS = join(ROOT, 'fastlane/metadata/android');
const FONTS = join(ROOT, 'scripts/fonts');
const PORT = 4180;

/** The scene: a village street at dusk, the truck parked facing the low sun, no traffic, the clock held. */
const SCENE =
  '?lang=en&quality=high&traffic=0&weather=clear&date=2026-09-20&time=18:25&spawn=-600,-1566,0';

/** Each listing's caption: three short orders (the last one amber) and a line under them. */
const CAPTIONS = {
  'en-US': { lang: 'en', words: ['Drive.', 'Deliver.', 'Grow.'], line: 'Build your own trucking company' },
  'tr-TR': { lang: 'tr', words: ['Sür.', 'Teslim et.', 'Büyü.'], line: 'Kendi nakliye şirketini kur' },
  'de-DE': { lang: 'de', words: ['Fahren.', 'Liefern.', 'Wachsen.'], line: 'Bau deine eigene Spedition auf' },
  'es-ES': { lang: 'es', words: ['Conduce.', 'Entrega.', 'Crece.'], line: 'Crea tu propia empresa de transporte' },
  'fr-FR': { lang: 'fr', words: ['Conduis.', 'Livre.', 'Grandis.'], line: 'Crée ta propre société de transport' },
  'it-IT': { lang: 'it', words: ['Guida.', 'Consegna.', 'Cresci.'], line: 'Crea la tua azienda di trasporti' },
  'pl-PL': { lang: 'pl', words: ['Jedź.', 'Dostarczaj.', 'Rozwijaj się.'], line: 'Zbuduj własną firmę transportową' },
  'pt-BR': { lang: 'pt', words: ['Dirija.', 'Entregue.', 'Cresça.'], line: 'Monte a sua própria transportadora' },
  'ru-RU': { lang: 'ru', words: ['Води.', 'Доставляй.', 'Расти.'], line: 'Создай свою транспортную компанию' },
  id: { lang: 'id', words: ['Mengemudi.', 'Mengantar.', 'Berkembang.'], line: 'Bangun perusahaan truk milikmu sendiri' },
};

/** Oswald, a variable font (weights 200 to 700), in the parts the captions' languages use. */
const FONT_FACES = [
  ['Oswald-latin.woff2', 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'],
  ['Oswald-latin-ext.woff2', 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF'],
  ['Oswald-cyrillic.woff2', 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116'],
]
  .map(([file, range]) => {
    const data = readFileSync(join(FONTS, file)).toString('base64');
    return `@font-face{font-family:Oswald;font-weight:200 700;font-display:block;src:url(data:font/woff2;base64,${data}) format('woff2');unicode-range:${range}}`;
  })
  .join('');

const AMBER = '#f2a33a';
const ASPHALT = '#16191d';
/** The dusk sky's darkest purple, behind the feature graphic's brand. */
const DUSK = '#1a1320';

/** The brand: the mark on an amber tile, and the wordmark in white and amber (both drawn by the game, src/ui/brand.ts). */
function brand(markSvg, wordSvg) {
  return `<div class="brand"><div class="tile">${markSvg}</div>${wordSvg}</div>`;
}

const BRAND_CSS = `
.brand{display:flex;align-items:center;filter:drop-shadow(0 4px 16px rgba(0,0,0,.45))}
.tile{display:grid;place-items:center;background:${AMBER};border-radius:22%;color:${ASPHALT};--rh-brand-dash:${AMBER}}
/* The mark's middle, (57, 50) of its 100 units, at the tile's. */
.tile svg{width:80%;height:80%;transform:translateX(-7%)}
.brand .wordmark{color:#fff;--rh-accent:${AMBER};height:auto}`;

function screenshotPage(shot, markSvg, wordSvg, caption) {
  const [first, second, last] = caption.words.map((word) => word.replace(/&/g, '&amp;').replace(/</g, '&lt;'));
  return `<!doctype html><html lang="${caption.lang}"><head><meta charset="utf-8"><style>${FONT_FACES}</style><style>
html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:${ASPHALT}}
.frame{position:relative;width:1920px;height:1080px;overflow:hidden}
.shot{position:absolute;inset:0;width:1920px;height:1080px}
.shade{position:absolute;inset:0;background:
  linear-gradient(180deg,rgba(18,12,22,.58) 0%,rgba(18,12,22,.34) 18%,rgba(18,12,22,0) 36%),
  linear-gradient(0deg,rgba(10,10,12,.55) 0%,rgba(10,10,12,0) 22%),
  radial-gradient(130% 100% at 50% 50%,rgba(0,0,0,0) 62%,rgba(0,0,0,.28) 100%)}
.copy{position:absolute;left:96px;top:50px;width:1728px}
h1{margin:0;font:700 150px/1.0 Oswald,sans-serif;text-transform:uppercase;letter-spacing:.01em;color:#fff;
  text-shadow:0 6px 30px rgba(20,8,20,.45),0 2px 4px rgba(0,0,0,.25)}
h1 span{white-space:nowrap}
h1 em{font-style:normal;color:${AMBER}}
p{margin:14px 0 0 4px;font:500 52px/1.2 Oswald,sans-serif;letter-spacing:.03em;color:rgba(255,248,240,.94);
  text-shadow:0 3px 18px rgba(20,8,20,.55)}
.bar{display:inline-block;width:64px;height:6px;border-radius:3px;background:${AMBER};margin:0 0 14px 4px}
.frame>.brand{position:absolute;left:96px;bottom:64px;gap:22px}
.frame>.brand .tile{width:84px;height:84px}
.frame>.brand .wordmark{width:${(40 * 310.5) / 42}px}
${BRAND_CSS}
</style></head><body><div class="frame">
<img class="shot" src="data:image/png;base64,${shot}">
<div class="shade"></div>
<div class="copy"><div class="bar"></div><h1><span>${first}</span> <span>${second}</span> <span><em>${last}</em></span></h1><p>${caption.line}</p></div>
${brand(markSvg, wordSvg)}
</div></body></html>`;
}

function featureGraphicPage(shot, markSvg, wordSvg) {
  // The scene fills the right, the truck about two thirds across; the brand stands on a dusk-dark panel at the left.
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:1024px;height:500px;overflow:hidden;background:${DUSK}}
.frame{position:relative;width:1024px;height:500px;overflow:hidden}
.shot{position:absolute;left:180px;top:-148px;width:1152px;height:648px}
.shade{position:absolute;inset:0;background:
  linear-gradient(90deg,${DUSK} 0px,${DUSK} 180px,rgba(26,19,32,.88) 260px,rgba(26,19,32,.45) 380px,rgba(26,19,32,0) 500px),
  radial-gradient(120% 110% at 70% 50%,rgba(0,0,0,0) 60%,rgba(0,0,0,.28) 100%)}
.frame>.brand{position:absolute;left:210px;top:50%;transform:translate(-50%,-50%);flex-direction:column;gap:22px}
.frame>.brand .tile{width:124px;height:124px}
.frame>.brand .wordmark{width:320px}
${BRAND_CSS}
</style></head><body><div class="frame">
<img class="shot" src="data:image/png;base64,${shot}">
<div class="shade"></div>
${brand(markSvg, wordSvg)}
</div></body></html>`;
}

/** Serves dist/ as the game's players get it, until the returned function stops it. */
async function serveBuild() {
  if (!existsSync(join(ROOT, 'dist/index.html'))) {
    throw new Error('No build to draw from: run `npm run build` first.');
  }
  const vite = join(ROOT, 'node_modules/vite/bin/vite.js');
  const server = spawn(process.execPath, [vite, 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
  });
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) {
        return () => server.kill();
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  server.kill();
  throw new Error(`The build's server did not start on port ${PORT}.`);
}

/** Drives the game to the scene and returns it as a PNG (base64), with the brand's drawings from its main menu. */
async function captureScene(browser) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${PORT}/${SCENE}`);
  await page.waitForFunction(() => document.documentElement.dataset.gameState === 'mainMenu', null, { timeout: 180_000 });
  const markSvg = await page.locator('.main-menu__mark').evaluate((svg) => svg.outerHTML);
  const wordSvg = await page
    .locator('.main-menu__wordmark')
    .evaluate((svg) => svg.outerHTML.replace('main-menu__wordmark', 'wordmark'));
  await page.locator('[data-action="new-company"]').click();
  await page.locator('.new-company__input').fill('RoadHaul');
  await page.locator('[data-action="start-company"]').click();
  await page.waitForFunction(() => document.documentElement.dataset.gameState === 'driving', null, { timeout: 180_000 });
  await page.waitForTimeout(6000);
  // Swing the chase camera round to the truck's front quarter, the sun behind it, and hold it there.
  const box = await page.locator('#game-canvas').boundingBox();
  await page.mouse.move(box.width * 0.1, box.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(box.width * 0.9, box.height * 0.47, { steps: 16 });
  await page.waitForTimeout(4000);
  // The scene alone: everything over the canvas hidden.
  await page.evaluate(() => {
    for (const element of document.body.children) {
      if (element.id !== 'game-canvas') element.style.visibility = 'hidden';
    }
  });
  await page.waitForTimeout(2500);
  const shot = (await page.screenshot()).toString('base64');
  await page.mouse.up();
  await page.close();
  return { shot, markSvg, wordSvg };
}

/** Renders `html` at `width` × `height` into a JPEG at `file`, once its fonts are in. */
async function render(browser, html, width, height, file) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async () => {
    // A headline too wide for its lines (long words in some languages) gets smaller until it fits in two.
    const heading = document.querySelector('h1');
    if (heading === null) return;
    let size = 150;
    const fits = () =>
      heading.scrollWidth <= heading.clientWidth + 1 &&
      heading.getBoundingClientRect().height <= size * 2 + 1 &&
      [...heading.children].every((span) => span.getBoundingClientRect().right <= heading.getBoundingClientRect().right + 1);
    while (!fits() && size > 90) {
      size -= 4;
      heading.style.fontSize = `${size}px`;
    }
  });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, await page.screenshot({ type: 'jpeg', quality: 88 }));
  await page.close();
}

const stop = await serveBuild();
const browser = await chromium.launch();
try {
  const { shot, markSvg, wordSvg } = await captureScene(browser);
  for (const [locale, caption] of Object.entries(CAPTIONS)) {
    const file = join(LISTINGS, locale, 'images/phoneScreenshots/01.jpg');
    await render(browser, screenshotPage(shot, markSvg, wordSvg, caption), 1920, 1080, file);
    console.log(`Screenshot: ${file}`);
  }
  const feature = join(LISTINGS, 'en-US/images/featureGraphic.jpg');
  await render(browser, featureGraphicPage(shot, markSvg, wordSvg), 1024, 500, feature);
  console.log(`Feature graphic: ${feature}`);
} finally {
  await browser.close();
  stop();
}
