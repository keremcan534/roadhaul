// Draws the Android app's launcher icons: RoadHaul's mark (an R whose leg is
// a road running toward the viewer, src/ui/brand.ts) in asphalt on the
// game's amber. Original art, drawn in code like the game's textures, so the
// app ships no borrowed images (spec §85).
//
//   node scripts/androidIcons.mjs
//
// writes into android/app/src/main/res:
//   mipmap-*/ic_launcher_foreground.png  the adaptive icon's layer (Android 8+),
//                                        on @color/ic_launcher_background
//   mipmap-*/ic_launcher.png             a rounded square, for older launchers
//   mipmap-*/ic_launcher_round.png       a circle, for older launchers
// and fastlane/metadata/android/en-US/images/icon.png: Google Play's 512 px
// listing icon, the plate filling the square (the store rounds its corners).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RES = join(ROOT, 'android/app/src/main/res');
const STORE_ICON = join(ROOT, 'fastlane/metadata/android/en-US/images/icon.png');

const AMBER = [0xf2, 0xa3, 0x3a];
const ASPHALT = [0x16, 0x19, 0x1d];
/** A part painted with this shows the plate under it (the road's dashes, the R's counter). */
const PLATE = 'plate';

/** Launcher sizes in pixels for each density: legacy icons are 48 dp, adaptive layers 108 dp. */
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

// The mark, in its own 100-unit square (src/ui/brand.ts), painted in order.
const MARK = [
  { color: ASPHALT, shape: roundedRect(18, 10, 40.5, 90, 2) }, // The R's stem.
  { color: ASPHALT, shape: (x, y) => (x >= 40 && x <= 56 && y >= 10 && y <= 58) || (x >= 56 && circle(56, 34, 24)(x, y)) }, // Its bowl.
  { color: PLATE, shape: (x, y) => (x >= 40 && x <= 54 && y >= 25 && y <= 43) || (x >= 54 && circle(54, 34, 9)(x, y)) }, // The counter.
  { color: ASPHALT, shape: polygon([42.5, 58], [65, 58], [96, 90], [44.5, 90]) }, // The leg: a road.
  { color: PLATE, shape: polygon([53.99, 60.5], [56.09, 60.5], [58.67, 65], [56.04, 65]) }, // Its centre line.
  { color: PLATE, shape: polygon([57.87, 69], [60.98, 69], [65, 76], [61.06, 76]) },
  { color: PLATE, shape: polygon([63.12, 80.5], [67.59, 80.5], [73.05, 90], [67.45, 90]) },
];
// Where the mark sits in the adaptive layer's 108-unit square: its middle, (57, 50), at the square's, and small
// enough that everything stays inside the 33-unit safe circle round (54, 54) that every launcher's mask keeps.
const MARK_SCALE = 0.6;
const MARK_CENTER = [57, 50];

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

function polygon(...points) {
  return (x, y) => {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i];
      const [xj, yj] = points[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  };
}

/**
 * Renders `size` × `size` pixels, 4 × 4 samples each. `background(u, v)`
 * says whether a point (0..1 across the image) is on the icon's plate;
 * `zoom` shows the middle 108 / zoom units of the adaptive square.
 */
function render(size, background, zoom) {
  const pixels = Buffer.alloc(size * size * 4);
  const samples = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const u = (px + (sx + 0.5) / samples) / size;
          const v = (py + (sy + 0.5) / samples) / size;
          const x = 54 + (u - 0.5) * (108 / zoom);
          const y = 54 + (v - 0.5) * (108 / zoom);
          const markX = MARK_CENTER[0] + (x - 54) / MARK_SCALE;
          const markY = MARK_CENTER[1] + (y - 54) / MARK_SCALE;
          const plate = background(u, v) ? AMBER : null;
          let color = plate;
          for (const part of MARK) {
            if (part.shape(markX, markY)) {
              color = part.color === PLATE ? plate : part.color;
            }
          }
          if (color !== null) {
            r += color[0];
            g += color[1];
            b += color[2];
            a += 1;
          }
        }
      }
      const i = (py * size + px) * 4;
      // Straight (not premultiplied) alpha, as PNG stores it.
      pixels[i] = a > 0 ? Math.round(r / a) : 0;
      pixels[i + 1] = a > 0 ? Math.round(g / a) : 0;
      pixels[i + 2] = a > 0 ? Math.round(b / a) : 0;
      pixels[i + 3] = Math.round((a / (samples * samples)) * 255);
    }
  }
  return encodePng(size, pixels);
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

/** The legacy icons' plates fill all but a 4% margin, like Android's own. */
const MARGIN = 0.04;
const squarePlate = (u, v) => roundedRect(MARGIN, MARGIN, 1 - MARGIN, 1 - MARGIN, 0.2)(u, v);
const roundPlate = (u, v) => circle(0.5, 0.5, 0.5 - MARGIN)(u, v);

for (const [density, scale] of Object.entries(DENSITIES)) {
  const folder = join(RES, `mipmap-${density}`);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'ic_launcher_foreground.png'), render(108 * scale, () => false, 1));
  // A legacy icon shows the middle 72 units of the adaptive square: the part a launcher's mask keeps.
  writeFileSync(join(folder, 'ic_launcher.png'), render(48 * scale, squarePlate, 1.5));
  writeFileSync(join(folder, 'ic_launcher_round.png'), render(48 * scale, roundPlate, 1.5));
}
console.log(`Launcher icons written to ${RES}.`);

// The store's icon shows the same middle 72 units as a legacy one, on a square plate.
mkdirSync(dirname(STORE_ICON), { recursive: true });
writeFileSync(STORE_ICON, render(512, () => true, 1.5));
console.log(`Google Play icon written to ${STORE_ICON}.`);
