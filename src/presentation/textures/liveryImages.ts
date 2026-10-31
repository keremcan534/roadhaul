import { SeededRandom } from '../../core/random/SeededRandom';
import { smoothstep } from '../../core/math/scalar';
import type { LiveryPattern } from '../../data/definitions/LiveryDefinition';
import { line, polygon } from './drawing';
import { fractalNoise } from './noise';
import { blendPixel, createImage, fillRect, mixRgb, shade, type PixelImage, type Rgb } from './pixelImage';
import { drawText, measureText } from './strokeFont';

/** What the trailers say without the company's own text. */
export const DEFAULT_TRAILER_TEXT = 'ROADHAUL';

const WHITE_BODY: Rgb = [242, 242, 238];
const INK: Rgb = [44, 52, 64];
const LIGHT_INK: Rgb = [244, 246, 250];

/**
 * A cargo box's side in one of the designs (LiveryDefinition), `width` ×
 * `height` pixels, y up, in the truck's colour (`accent`) with `text`
 * lettered across its middle (in dark ink on the light designs, white on
 * the dark ones). Made once per truck: not per frame.
 */
export function liveryImage(
  accent: Rgb,
  pattern: LiveryPattern,
  text = DEFAULT_TRAILER_TEXT,
  width = 1024,
  height = 512,
): PixelImage {
  const draw = PATTERNS[pattern];
  const image = createImage(width, height, draw.dark ? [22, 24, 30] : WHITE_BODY);
  // The panels first: the design is painted over them, in its own colours.
  if (!draw.dark) {
    seamsAndGrime(image);
  }
  draw.paint(image, accent);
  letter(image, text, draw.dark ? LIGHT_INK : INK, draw.textAt ?? 0.42);
  return image;
}

/** A design's small picture for the garage: its look in the truck's colour, without seams or lettering. */
export function liveryThumbnail(accent: Rgb, pattern: LiveryPattern, width = 192, height = 96): PixelImage {
  const draw = PATTERNS[pattern];
  const image = createImage(width, height, draw.dark ? [22, 24, 30] : WHITE_BODY);
  draw.paint(image, accent);
  return image;
}

interface PatternDrawing {
  /** A dark body: white lettering, no grime. */
  readonly dark?: boolean;
  /** Where the lettering's foot stands, a share of the height. */
  readonly textAt?: number;
  readonly paint: (image: PixelImage, accent: Rgb) => void;
}

/** Panel seams and a little road grime toward the bottom. */
function seamsAndGrime(image: PixelImage): void {
  const { width, height } = image;
  for (let panel = 1; panel < 6; panel++) {
    fillRect(image, (panel * width) / 6 - 1, 0, (panel * width) / 6 + 1, height, [206, 206, 202], 0.6);
  }
  shade(image, (x, y) => 0.9 + 0.1 * smoothstep(0, 0.35, y / height) + 0.03 * fractalNoise(x / width, y / height, 8, 2, 5));
}

/** `text` across the middle, as large as fits. */
function letter(image: PixelImage, text: string, color: Rgb, at: number): void {
  const { width, height } = image;
  let style = { height: height * 0.2, weight: 0.17, spacing: 0.12, slant: 0.16, color };
  const measured = measureText(text, style);
  if (measured > width * 0.8) {
    style = { ...style, height: (style.height * width * 0.8) / measured };
  }
  drawText(image, text, (width - measureText(text, style)) / 2, height * at, style);
}

const darker = (color: Rgb, by: number): Rgb => mixRgb(color, [0, 0, 0], by);
const lighter = (color: Rgb, by: number): Rgb => mixRgb(color, [255, 255, 255], by);

/** Each pixel of `image` painted by `colour(u, v)` (0..1 across and up), blended by its coverage. */
function paintEach(image: PixelImage, colour: (u: number, v: number) => Rgb | null, coverage = 1): void {
  const { width, height } = image;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = colour((x + 0.5) / width, (y + 0.5) / height);
      if (c !== null) {
        blendPixel(image, x, y, c, coverage);
      }
    }
  }
}

/** A five-pointed star centred on (cx, cy), `radius` to its points. */
function star(image: PixelImage, cx: number, cy: number, radius: number, color: Rgb, alpha = 255): void {
  for (let i = 0; i < 5; i++) {
    const a0 = (Math.PI / 2) + (i * 2 * Math.PI) / 5;
    const a1 = a0 + Math.PI / 5;
    const a2 = a0 - Math.PI / 5;
    polygon(
      image,
      [
        [cx, cy],
        [cx + Math.cos(a2) * radius * 0.4, cy + Math.sin(a2) * radius * 0.4],
        [cx + Math.cos(a0) * radius, cy + Math.sin(a0) * radius],
        [cx + Math.cos(a1) * radius * 0.4, cy + Math.sin(a1) * radius * 0.4],
      ],
      color,
      alpha,
    );
  }
}

const PATTERNS: Readonly<Record<LiveryPattern, PatternDrawing>> = {
  // The RoadHaul livery: a broad band with a thin dark line above, rising into a chevron at each end.
  classic: {
    paint: (image, accent) => {
      const { width, height } = image;
      fillRect(image, 0, height * 0.08, width, height * 0.22, accent);
      fillRect(image, 0, height * 0.245, width, height * 0.27, INK);
      for (let y = Math.floor(height * 0.08); y < height * 0.62; y++) {
        const rise = ((y - height * 0.08) / (height * 0.54)) * width * 0.08;
        for (let x = 0; x < width * 0.06; x++) {
          blendPixel(image, Math.floor(width * 0.02 + rise + x), y, accent, 1);
          blendPixel(image, Math.floor(width * 0.98 - rise - x), y, accent, 1);
        }
      }
    },
  },
  // Two racing stripes the whole length, pinstriped, speed lines streaming off the front.
  speed: {
    textAt: 0.4,
    paint: (image, accent) => {
      const { width, height } = image;
      fillRect(image, 0, height * 0.12, width, height * 0.3, accent);
      fillRect(image, 0, height * 0.74, width, height * 0.86, accent);
      for (const y of [0.1, 0.32, 0.72, 0.88]) {
        fillRect(image, 0, height * y, width, height * y + 4, INK);
      }
      const random = new SeededRandom(17);
      for (let i = 0; i < 12; i++) {
        const y = height * (0.35 + (i / 12) * 0.36);
        const x0 = width * (0.01 + random.next() * 0.04);
        const length = width * (0.05 + random.next() * 0.14);
        line(image, x0, y, x0 + length, y, 2 + random.next() * 2, mixRgb(accent, WHITE_BODY, 0.35), 255);
      }
    },
  },
  // Chevrons marching along the lower half, fading toward the rear.
  chevrons: {
    textAt: 0.62,
    paint: (image, accent) => {
      const { width, height } = image;
      const step = height * 0.32;
      for (let i = 0; i * step < width + step; i++) {
        const x = i * step;
        const fade = 1 - (0.6 * x) / width;
        const tip = x + step * 0.55;
        const colour = mixRgb(WHITE_BODY, accent, fade);
        // Each chevron two arms, each a convex strip meeting at its tip.
        const [low, middle, high] = [height * 0.06, height * 0.31, height * 0.56];
        polygon(image, [[x, low], [x + step * 0.3, low], [tip, middle], [tip - step * 0.3, middle]], colour, 255);
        polygon(image, [[tip - step * 0.3, middle], [tip, middle], [x + step * 0.3, high], [x, high]], colour, 255);
      }
      fillRect(image, 0, height * 0.58, width, height * 0.6, INK);
    },
  },
  // A chequered band along the foot, the colour above it.
  checker: {
    paint: (image, accent) => {
      const { width, height } = image;
      const cell = height * 0.075;
      for (let row = 0; row < 3; row++) {
        for (let column = 0; column * cell < width; column++) {
          if ((row + column) % 2 === 0) {
            fillRect(image, column * cell, height * 0.06 + row * cell, (column + 1) * cell, height * 0.06 + (row + 1) * cell, INK);
          }
        }
      }
      fillRect(image, 0, height * 0.06 + 3 * cell, width, height * 0.06 + 3 * cell + height * 0.08, accent);
      fillRect(image, 0, height * 0.86, width, height * 0.92, accent);
    },
  },
  // Three swelling waves in shades of the colour.
  waves: {
    textAt: 0.56,
    paint: (image, accent) => {
      const bands: readonly [Rgb, number, number][] = [
        [lighter(accent, 0.45), 0.42, 0.0],
        [accent, 0.3, 1.3],
        [darker(accent, 0.35), 0.18, 2.4],
      ];
      for (const [colour, level, phase] of bands) {
        paintEach(image, (u, v) => (v < level + 0.06 * Math.sin(u * Math.PI * 4 + phase) + 0.03 * Math.sin(u * Math.PI * 9 + phase * 2) ? colour : null));
      }
    },
  },
  // A sunset across the whole side: the colour high, warm orange low, bands of the sky above the horizon.
  sunset: {
    dark: true,
    textAt: 0.58,
    paint: (image, accent) => {
      paintEach(image, (u, v) => {
        const sky = v > 0.45 ? mixRgb([255, 140, 60], darker(accent, 0.15), smoothstep(0.45, 1, v)) : mixRgb([60, 20, 50], [255, 120, 70], v / 0.45);
        // The sun's stripes, low and to the front.
        const du = (u - 0.25) * 2;
        const dv = v - 0.46;
        const inSun = du * du + dv * dv * 9 < 0.09 && !(v < 0.46 && Math.floor(v * 60) % 3 === 0);
        return inSun ? [255, 214, 120] : sky;
      });
    },
  },
  // A honeycomb outline, thickest toward the front.
  hexagon: {
    paint: (image, accent) => {
      const { width, height } = image;
      const size = height * 0.11;
      const h = Math.sqrt(3) * size;
      for (let row = -1; row * h < height + h; row++) {
        for (let column = -1; column * size * 1.5 < width + size; column++) {
          const cx = column * size * 1.5;
          const cy = row * h + (column % 2 === 0 ? 0 : h / 2);
          const thickness = 2 + 7 * (1 - cx / width);
          const tint = mixRgb(accent, WHITE_BODY, 0.55 * (cx / width));
          for (let i = 0; i < 6; i++) {
            const a0 = (i * Math.PI) / 3;
            const a1 = ((i + 1) * Math.PI) / 3;
            line(image, cx + Math.cos(a0) * size * 0.92, cy + Math.sin(a0) * size * 0.92, cx + Math.cos(a1) * size * 0.92, cy + Math.sin(a1) * size * 0.92, thickness, tint, 255);
          }
        }
      }
    },
  },
  // A night sky of stars in the colour, scattered over deep blue.
  stars: {
    dark: true,
    paint: (image, accent) => {
      const { width, height } = image;
      paintEach(image, (_u, v) => mixRgb([12, 18, 44], [30, 44, 96], v));
      const random = new SeededRandom(29);
      for (let i = 0; i < 260; i++) {
        blendPixel(image, Math.floor(random.next() * width), Math.floor(random.next() * height), [230, 236, 255], 0.5 + random.next() * 0.5);
      }
      for (let i = 0; i < 26; i++) {
        star(image, random.next() * width, random.next() * height, height * (0.03 + random.next() * 0.07), lighter(accent, random.next() * 0.4));
      }
    },
  },
  // Camouflage: four tones of the colour in soft blots.
  camo: {
    paint: (image, accent) => {
      const tones: readonly Rgb[] = [lighter(mixRgb(accent, [120, 120, 80], 0.4), 0.15), mixRgb(accent, [90, 96, 60], 0.45), darker(accent, 0.35), darker(mixRgb(accent, [40, 40, 30], 0.5), 0.4)];
      paintEach(image, (u, v) => {
        const n = fractalNoise(u * 2, v, 6, 3, 41);
        const m = fractalNoise(u * 2 + 3.1, v + 1.7, 9, 2, 43);
        return n < 0.42 ? tones[0]! : n < 0.52 ? tones[1]! : m < 0.45 ? tones[2]! : tones[3]!;
      });
    },
  },
  // Lightning bolts flashing across a storm in the colour.
  lightning: {
    dark: true,
    paint: (image, accent) => {
      const { width, height } = image;
      paintEach(image, (u, v) => mixRgb(darker(accent, 0.75), darker(accent, 0.35), fractalNoise(u * 2, v, 5, 3, 13)));
      const random = new SeededRandom(7);
      for (let bolt = 0; bolt < 4; bolt++) {
        let x = width * (0.12 + bolt * 0.24 + random.next() * 0.06);
        let y = height;
        while (y > 0) {
          const nx = x + (random.next() - 0.5) * width * 0.08;
          const ny = y - height * (0.08 + random.next() * 0.1);
          line(image, x, y, nx, ny, 14, lighter(accent, 0.3), 255);
          line(image, x, y, nx, ny, 5, [255, 252, 220], 255);
          x = nx;
          y = ny;
        }
      }
    },
  },
  // A galaxy: a nebula in the colour and violet, stars and their glow.
  galaxy: {
    dark: true,
    paint: (image, accent) => {
      const { width, height } = image;
      paintEach(image, (u, v) => {
        const n = fractalNoise(u * 2, v, 4, 4, 91);
        const m = fractalNoise(u * 2 + 5, v + 2, 6, 3, 93);
        const nebula = mixRgb(mixRgb([8, 6, 20], accent, smoothstep(0.45, 0.8, n) * 0.85), [140, 60, 200], smoothstep(0.55, 0.85, m) * 0.6);
        return nebula;
      });
      const random = new SeededRandom(97);
      for (let i = 0; i < 420; i++) {
        blendPixel(image, Math.floor(random.next() * width), Math.floor(random.next() * height), [255, 255, 255], 0.4 + random.next() * 0.6);
      }
      for (let i = 0; i < 8; i++) {
        const x = random.next() * width;
        const y = random.next() * height;
        line(image, x - 10, y, x + 10, y, 2, [255, 255, 255], 255);
        line(image, x, y - 10, x, y + 10, 2, [255, 255, 255], 255);
      }
    },
  },
  // Hot-rod flames licking back from the front over the colour.
  flames: {
    textAt: 0.62,
    paint: (image, accent) => {
      paintEach(image, () => accent);
      paintEach(image, (u, v) => {
        // Tongues: each a wave narrowing to its tip, reaching further back the nearer the middle.
        const reach = 0.22 + 0.4 * Math.abs(Math.sin(v * Math.PI * 3.2 + 0.6)) * (1 - Math.abs(v - 0.42) * 1.4);
        if (u > reach) {
          return null;
        }
        const heat = u / Math.max(reach, 1e-3);
        return mixRgb(mixRgb([255, 236, 120], [255, 140, 30], smoothstep(0.1, 0.55, heat)), [210, 30, 20], smoothstep(0.55, 1, heat));
      });
    },
  },
  // Tiger stripes, tapering and wavering, over the colour.
  tiger: {
    paint: (image, accent) => {
      paintEach(image, () => lighter(accent, 0.05));
      paintEach(image, (u, v) => {
        const wobble = 0.03 * Math.sin(v * 9 + u * 30) + 0.02 * fractalNoise(u * 4, v, 6, 2, 3);
        const stripe = Math.abs(((u * 9 + wobble * 9) % 1) - 0.5);
        const taper = 0.12 + 0.18 * (1 - Math.abs(v - 0.5) * 2);
        return stripe < taper * 0.5 ? [24, 20, 18] : null;
      });
    },
  },
  // Paint splashes and their drips, the colour among bright others.
  splatter: {
    paint: (image, accent) => {
      const { width, height } = image;
      const colours: readonly Rgb[] = [accent, [255, 60, 120], [40, 200, 230], [255, 210, 40], [120, 220, 80]];
      const random = new SeededRandom(53);
      for (let i = 0; i < 34; i++) {
        const colour = colours[i % colours.length]!;
        const cx = random.next() * width;
        const cy = height * (0.15 + random.next() * 0.8);
        const radius = height * (0.03 + random.next() * 0.07);
        for (let blob = 0; blob < 6; blob++) {
          const a = random.next() * Math.PI * 2;
          const r = radius * (0.3 + random.next());
          const bx = cx + Math.cos(a) * r;
          const by = cy + Math.sin(a) * r;
          const br = radius * (0.25 + random.next() * 0.5);
          for (let y = Math.floor(by - br); y <= by + br; y++) {
            for (let x = Math.floor(bx - br); x <= bx + br; x++) {
              const d = Math.sqrt((x - bx) ** 2 + (y - by) ** 2);
              blendPixel(image, x, y, colour, Math.max(0, Math.min(1, br - d)));
            }
          }
        }
        line(image, cx, cy, cx + (random.next() - 0.5) * 6, cy - height * (0.05 + random.next() * 0.15), 4 + random.next() * 4, colour, 255);
      }
    },
  },
  // Neon tubes in the colour, glowing on black.
  neon: {
    dark: true,
    paint: (image, accent) => {
      const { width, height } = image;
      const glow = lighter(accent, 0.15);
      const tube = (ax: number, ay: number, bx: number, by: number): void => {
        line(image, ax, ay, bx, by, 26, darker(glow, 0.65), 255);
        line(image, ax, ay, bx, by, 12, glow, 255);
        line(image, ax, ay, bx, by, 4, [255, 255, 255], 255);
      };
      tube(0, height * 0.18, width, height * 0.18);
      tube(0, height * 0.84, width, height * 0.84);
      for (let i = 0; i < 3; i++) {
        const x = width * (0.04 + i * 0.05);
        tube(x, height * 0.18, x + width * 0.12, height * 0.84);
        const rx = width * (0.96 - i * 0.05);
        tube(rx, height * 0.18, rx - width * 0.12, height * 0.84);
      }
    },
  },
  // A circuit board: traces and pads in the colour on dark green.
  circuit: {
    dark: true,
    paint: (image, accent) => {
      const { width, height } = image;
      paintEach(image, (u, v) => mixRgb([8, 30, 22], [14, 44, 32], fractalNoise(u, v, 12, 1, 7)));
      const random = new SeededRandom(61);
      const trace = lighter(accent, 0.2);
      for (let i = 0; i < 40; i++) {
        let x = random.next() * width;
        let y = random.next() * height;
        for (let leg = 0; leg < 4; leg++) {
          const horizontal = leg % 2 === 0;
          const length = (horizontal ? width * 0.12 : height * 0.2) * (0.3 + random.next());
          const sign = random.next() < 0.5 ? -1 : 1;
          const nx = horizontal ? x + sign * length : x;
          const ny = horizontal ? y : y + sign * length;
          line(image, x, y, nx, ny, 4, trace, 255);
          x = nx;
          y = ny;
        }
        for (let ry = -7; ry <= 7; ry++) {
          for (let rx = -7; rx <= 7; rx++) {
            blendPixel(image, Math.floor(x + rx), Math.floor(y + ry), rx * rx + ry * ry < 30 ? [255, 255, 255] : trace, rx * rx + ry * ry < 49 ? 1 : 0);
          }
        }
      }
    },
  },
  // Synthwave: a striped sun over a glowing grid, under a sky in the colour.
  synthwave: {
    dark: true,
    textAt: 0.72,
    paint: (image, accent) => {
      const { width, height } = image;
      const horizon = 0.42;
      paintEach(image, (u, v) => {
        if (v > horizon) {
          const sky = mixRgb([255, 60, 140], darker(accent, 0.55), smoothstep(horizon, 1, v));
          const du = (u - 0.5) * 2.2;
          const dv = (v - horizon) * 2;
          const inSun = du * du + dv * dv < 0.36 && !(v < 0.62 && Math.floor(v * 40) % 2 === 0);
          return inSun ? mixRgb([255, 230, 90], [255, 80, 120], smoothstep(horizon, 0.8, v)) : sky;
        }
        return [20, 6, 34];
      });
      const grid = lighter(accent, 0.25);
      for (let i = 0; i < 12; i++) {
        const y = height * horizon * (1 - (i / 12) ** 1.6);
        line(image, 0, y, width, y, 3, grid, 255);
      }
      for (let i = -16; i <= 16; i++) {
        line(image, width / 2 + i * width * 0.035, height * horizon, width / 2 + i * width * 0.16, 0, 3, grid, 255);
      }
    },
  },
};
