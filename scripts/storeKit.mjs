// What the store's art (storeArt.mjs) and its video (storeVideo.mjs) share: the build served as players get it,
// Oswald for the words, and the brand's colours and lockup.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FONTS = join(ROOT, 'scripts/fonts');

/** Oswald, a variable font (weights 200 to 700), in the parts the captions' languages use. */
export const FONT_FACES = [
  ['Oswald-latin.woff2', 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'],
  ['Oswald-latin-ext.woff2', 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF'],
  ['Oswald-cyrillic.woff2', 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116'],
]
  .map(([file, range]) => {
    const data = readFileSync(join(FONTS, file)).toString('base64');
    return `@font-face{font-family:Oswald;font-weight:200 700;font-display:block;src:url(data:font/woff2;base64,${data}) format('woff2');unicode-range:${range}}`;
  })
  .join('');

export const AMBER = '#f2a33a';
export const ASPHALT = '#16191d';
/** The dusk sky's darkest purple, behind the feature graphic's brand. */
export const DUSK = '#1a1320';

/** The brand: the mark on an amber tile, and the wordmark in white and amber (both drawn by the game, src/ui/brand.ts). */
export function brand(markSvg, wordSvg) {
  return `<div class="brand"><div class="tile">${markSvg}</div>${wordSvg}</div>`;
}

export const BRAND_CSS = `
.brand{display:flex;align-items:center;filter:drop-shadow(0 4px 16px rgba(0,0,0,.45))}
.tile{display:grid;place-items:center;background:${AMBER};border-radius:22%;color:${ASPHALT};--rh-brand-dash:${AMBER}}
/* The mark's middle, (57, 50) of its 100 units, at the tile's. */
.tile svg{width:80%;height:80%;transform:translateX(-7%)}
.brand .wordmark{color:#fff;--rh-accent:${AMBER};height:auto}`;

/** Serves dist/ on `port` as the game's players get it, until the returned function stops it. */
export async function serveBuild(port) {
  if (!existsSync(join(ROOT, 'dist/index.html'))) {
    throw new Error('No build to draw from: run `npm run build` first.');
  }
  const vite = join(ROOT, 'node_modules/vite/bin/vite.js');
  const server = spawn(process.execPath, [vite, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
  });
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/`)).ok) {
        return () => server.kill();
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  server.kill();
  throw new Error(`The build's server did not start on port ${port}.`);
}

/** The brand's drawings as the game draws them on its main menu: the mark, and the wordmark (class `wordmark`). */
export async function brandDrawings(page) {
  const markSvg = await page.locator('.main-menu__mark').evaluate((svg) => svg.outerHTML);
  const wordSvg = await page
    .locator('.main-menu__wordmark')
    .evaluate((svg) => svg.outerHTML.replace('main-menu__wordmark', 'wordmark'));
  return { markSvg, wordSvg };
}
