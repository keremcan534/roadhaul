// Draws the Android app's launcher icons: the game's own starter truck (rh_h1, drawn by TruckView) at dusk, lamps
// on, its windscreen mirroring a blue sky: the Google Play icon's shot, from the same camera. Original art, drawn in
// code from the game's own model, so the app ships no borrowed images (spec §85).
//
//   node scripts/androidIcons.mjs
//
// The truck is drawn by scripts/icon/launcherIcon.ts (a three.js page, served here by Vite) in headless Chrome, in
// software (SwiftShader), once and large; every icon is that picture boxed down. Writes into android/app/src/main/res:
//   mipmap-*/ic_launcher_foreground.png  the adaptive icon's front layer (Android 8+): the truck, its cab inside the
//                                        safe circle that every launcher's mask keeps
//   mipmap-*/ic_launcher_background.png  its back layer: the dusk sky
//   mipmap-*/ic_launcher.png             the two layers on a rounded square, for older launchers
//   mipmap-*/ic_launcher_round.png       the two layers on a circle, for older launchers
// Google Play's 512 px icon is not drawn here: it is the same shot, closer (docs/RELEASE.md).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RES = join(ROOT, 'android/app/src/main/res');
const PORT = 4332;

/** Launcher sizes in pixels for each density: legacy icons are 48 dp, adaptive layers 108 dp. */
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
/** The truck is drawn this many pixels to the layer's unit: every icon's size divides it evenly. */
const PIXELS_PER_UNIT = 24;
const SIZE = 108 * PIXELS_PER_UNIT;
/** The cab reaches this far from the layer's middle, of its 108 units: inside the safe circle (33), with a margin. */
const CAB_RADIUS = 32;
// A legacy icon shows the middle 72 units of the adaptive square: the part a launcher's mask keeps. Its plate fills
// all but a 4% margin, like Android's own.
const LEGACY_REGION = 72 * PIXELS_PER_UNIT;
const LEGACY_LEFT = 18 * PIXELS_PER_UNIT;
const MARGIN = 0.04;

/**
 * The dusk sky behind the truck, as the store icon's scene paints it down its frame (0 at the top, 1 at the
 * bottom): a gradient of these colours, blended as a canvas blends them.
 */
const SKY = [
  [0, [0x1d, 0x2a, 0x5c]],
  [0.5, [0x6b, 0x4f, 0x8f]],
  [0.78, [0xff, 0xb2, 0x5a]],
  [1, [0xff, 0xb2, 0x5a]],
];

/** The sky's colour `t` of the way down the store icon's frame (clamped to it). */
function skyAt(t) {
  const at = Math.min(1, Math.max(0, t));
  for (let i = 1; i < SKY.length; i++) {
    const [stop, color] = SKY[i];
    if (at <= stop) {
      const [previousStop, previous] = SKY[i - 1];
      const k = (at - previousStop) / (stop - previousStop);
      return previous.map((channel, c) => channel + (color[c] - channel) * k);
    }
  }
  return SKY[SKY.length - 1][1];
}

function roundedRect(x0, y0, x1, y1, r) {
  return (x, y) => {
    const dx = Math.max(x0 + r - x, 0, x - (x1 - r));
    const dy = Math.max(y0 + r - y, 0, y - (y1 - r));
    return x >= x0 && x <= x1 && y >= y0 && y <= y1 && dx * dx + dy * dy <= r * r;
  };
}

function circle(cx, cy, r) {
  return (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** Draws the truck's layer: SIZE × SIZE premultiplied RGBA pixels, and where the store icon's frame lies in them. */
async function drawTruck() {
  const server = await createServer({
    configFile: false,
    root: join(ROOT, 'scripts/icon'),
    cacheDir: join(ROOT, 'node_modules/.vite-icon'),
    logLevel: 'warn',
    optimizeDeps: { noDiscovery: true },
    server: { host: '127.0.0.1', port: PORT, strictPort: true, fs: { allow: [ROOT] } },
  });
  await server.listen();
  // Google Chrome (Playwright's own browsers may not be installed), drawing in software: the same pixels whatever the GPU.
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
    page.on('pageerror', (error) => console.error('In the icon page:', error.message));
    await page.goto(`http://127.0.0.1:${PORT}/?size=${SIZE}&cab=${CAB_RADIUS}`);
    await page.waitForFunction(() => window.launcherIcon !== undefined, null, { timeout: 300_000 });
    const picture = await page.evaluate(() => window.launcherIcon);
    return { pixels: new Uint8Array(Buffer.from(picture.pixels, 'base64')), frame: picture.frame };
  } finally {
    await browser.close();
    await server.close();
  }
}

/**
 * The sky behind the layer, row by row (SIZE rows, RGB): the store icon's gradient where its frame lies in the layer,
 * so the horizon's glow stays behind the truck's lamps; above the frame it keeps its top blue, below it the glow.
 */
function skyRows(frame) {
  const rows = new Float32Array(SIZE * 3);
  for (let row = 0; row < SIZE; row++) {
    // The frame's normalized height (1 at its top, -1 at its bottom) of the row's middle.
    const height = frame.y + frame.half * (1 - (2 * (row + 0.5)) / SIZE);
    rows.set(skyAt((1 - height) / 2), row * 3);
  }
  return rows;
}

/**
 * Averages the square `region` pixels wide at (left, top) of a SIZE-wide picture down to `size` pixels; `region` is a
 * multiple of `size`. `pixel(x, y, out)` writes a pixel's premultiplied RGBA (0..255). Returns straight RGBA bytes.
 */
function boxDown(pixel, left, top, region, size) {
  const factor = region / size;
  const samples = factor * factor;
  const out = Buffer.alloc(size * size * 4);
  const sample = [0, 0, 0, 0];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < factor; sy++) {
        for (let sx = 0; sx < factor; sx++) {
          pixel(left + x * factor + sx, top + y * factor + sy, sample);
          r += sample[0];
          g += sample[1];
          b += sample[2];
          a += sample[3];
        }
      }
      const i = (y * size + x) * 4;
      // Straight (not premultiplied) alpha, as PNG stores it.
      out[i] = a > 0 ? Math.round(Math.min(255, (r / a) * 255)) : 0;
      out[i + 1] = a > 0 ? Math.round(Math.min(255, (g / a) * 255)) : 0;
      out[i + 2] = a > 0 ? Math.round(Math.min(255, (b / a) * 255)) : 0;
      out[i + 3] = Math.round(a / samples);
    }
  }
  return out;
}

function encodePng(size, rgba) {
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    rows[y * (size * 4 + 1)] = 0; // Filter: none.
    rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8 bits per channel, RGBA, deflate, no interlace.
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const { pixels: truck, frame } = await drawTruck();
const sky = skyRows(frame);

/** The truck alone. */
const truckPixel = (x, y, out) => {
  const i = (y * SIZE + x) * 4;
  out[0] = truck[i];
  out[1] = truck[i + 1];
  out[2] = truck[i + 2];
  out[3] = truck[i + 3];
};
/** The sky alone. */
const skyPixel = (x, y, out) => {
  out[0] = sky[y * 3];
  out[1] = sky[y * 3 + 1];
  out[2] = sky[y * 3 + 2];
  out[3] = 255;
};
/** The truck on the sky, where `plate(u, v)` (0..1 across the legacy icon) says the icon is; nothing elsewhere. */
const iconPixel = (plate) => (x, y, out) => {
  if (!plate((x + 0.5 - LEGACY_LEFT) / LEGACY_REGION, (y + 0.5 - LEGACY_LEFT) / LEGACY_REGION)) {
    out.fill(0);
    return;
  }
  const i = (y * SIZE + x) * 4;
  const behind = 1 - truck[i + 3] / 255;
  out[0] = truck[i] + sky[y * 3] * behind;
  out[1] = truck[i + 1] + sky[y * 3 + 1] * behind;
  out[2] = truck[i + 2] + sky[y * 3 + 2] * behind;
  out[3] = 255;
};
const squarePlate = roundedRect(MARGIN, MARGIN, 1 - MARGIN, 1 - MARGIN, 0.2);
const roundPlate = circle(0.5, 0.5, 0.5 - MARGIN);

for (const [density, scale] of Object.entries(DENSITIES)) {
  const folder = join(RES, `mipmap-${density}`);
  mkdirSync(folder, { recursive: true });
  const layer = 108 * scale;
  const legacy = 48 * scale;
  writeFileSync(join(folder, 'ic_launcher_foreground.png'), encodePng(layer, boxDown(truckPixel, 0, 0, SIZE, layer)));
  writeFileSync(join(folder, 'ic_launcher_background.png'), encodePng(layer, boxDown(skyPixel, 0, 0, SIZE, layer)));
  writeFileSync(join(folder, 'ic_launcher.png'), encodePng(legacy, boxDown(iconPixel(squarePlate), LEGACY_LEFT, LEGACY_LEFT, LEGACY_REGION, legacy)));
  writeFileSync(join(folder, 'ic_launcher_round.png'), encodePng(legacy, boxDown(iconPixel(roundPlate), LEGACY_LEFT, LEGACY_LEFT, LEGACY_REGION, legacy)));
}
const shown = Math.round((108 / frame.half) * 10) / 10;
console.log(`The cab inside ${CAB_RADIUS} units of the layer's middle (the safe circle: 33); the store icon's frame ${shown} units wide.`);
console.log(`Launcher icons written to ${RES}.`);
