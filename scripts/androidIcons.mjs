// Draws the Android app's launcher icons: a dark box truck on the road, on
// the game's amber. Original art, drawn in code like the game's textures, so
// the app ships no borrowed images (spec §85).
//
//   node scripts/androidIcons.mjs
//
// writes into android/app/src/main/res:
//   mipmap-*/ic_launcher_foreground.png  the adaptive icon's layer (Android 8+),
//                                        on @color/ic_launcher_background
//   mipmap-*/ic_launcher.png             a rounded square, for older launchers
//   mipmap-*/ic_launcher_round.png       a circle, for older launchers
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const RES = join(dirname(fileURLToPath(import.meta.url)), '../android/app/src/main/res');

const AMBER = [0xf2, 0xb2, 0x33];
const INK = [0x1b, 0x24, 0x30];
const SKY = [0x9f, 0xd3, 0xff];
const STEEL = [0xe8, 0xed, 0xf2];

/** Launcher sizes in pixels for each density: legacy icons are 48 dp, adaptive layers 108 dp. */
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

// The truck, in the adaptive layer's 108-unit square. Everything stays inside
// its 33-unit safe circle round (54, 54), which every launcher's mask keeps.
const TRUCK = [
  { color: INK, shape: roundedRect(28, 36, 60, 61, 2) }, // Box.
  { color: AMBER, shape: roundedRect(31, 52, 57, 54.5, 1) }, // Stripe on the box.
  { color: INK, shape: polygon([61, 41], [73, 41], [80, 50], [80, 61], [61, 61]) }, // Cab.
  { color: SKY, shape: polygon([65, 44], [72, 44], [77, 50.5], [65, 50.5]) }, // Windscreen.
  { color: INK, shape: roundedRect(28, 60, 80, 64.5, 1) }, // Chassis.
  { color: INK, shape: circle(37, 66, 6) },
  { color: STEEL, shape: circle(37, 66, 2.4) },
  { color: INK, shape: circle(71, 66, 6) },
  { color: STEEL, shape: circle(71, 66, 2.4) },
  { color: INK, shape: roundedRect(33, 75.5, 43, 78, 1.25) }, // Road markings.
  { color: INK, shape: roundedRect(49, 75.5, 59, 78, 1.25) },
  { color: INK, shape: roundedRect(65, 75.5, 75, 78, 1.25) },
];

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
 * `zoom` shows the middle 108 / zoom units of the truck's square.
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
          let color = background(u, v) ? AMBER : null;
          for (const part of TRUCK) {
            if (part.shape(x, y)) {
              color = part.color;
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
