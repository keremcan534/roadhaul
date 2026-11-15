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

/**
 * Whether a design glows at night (its neon, its traces, its sky): the
 * truck lights its picture as the lamps come on (TruckView.setLamps).
 */
export function liveryGlows(pattern: LiveryPattern): boolean {
  return PATTERNS[pattern].glows === true;
}

/**
 * The design on the cab's lower sides, `width` × `height` pixels: its look
 * without seams or lettering, as on the box (the classic leaves the cab in
 * its paint). Made once per truck.
 */
export function liveryCabImage(accent: Rgb, pattern: LiveryPattern, width = 320, height = 128): PixelImage {
  return liveryThumbnail(accent, pattern, width, height);
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
  /** Its lights glow at night: the picture lights itself (liveryGlows). */
  readonly glows?: boolean;
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

/** A filled disc centred on (cx, cy), its edge anti-aliased. */
function disc(image: PixelImage, cx: number, cy: number, radius: number, color: Rgb): void {
  for (let y = Math.floor(cy - radius - 1); y <= cy + radius + 1; y++) {
    for (let x = Math.floor(cx - radius - 1); x <= cx + radius + 1; x++) {
      const d = Math.sqrt((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2);
      blendPixel(image, x, y, color, Math.max(0, Math.min(1, radius - d + 0.5)));
    }
  }
}

/**
 * A blade sweeping from (u0, v0) to its point at (u1, v1) (shares of the
 * width and height), bowed `bend` (a share of the height) to its left
 * going, swelling from a narrow root to `thickness` (a share of the
 * height) and tapering to its point: drawn as convex slices.
 */
function blade(image: PixelImage, from: readonly [number, number], to: readonly [number, number], bend: number, thickness: number, color: Rgb): void {
  const { width, height } = image;
  const x0 = from[0] * width;
  const y0 = from[1] * height;
  const x1 = to[0] * width;
  const y1 = to[1] * height;
  const length = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2) || 1;
  const nx = -(y1 - y0) / length;
  const ny = (x1 - x0) / length;
  const steps = 28;
  const edge = (t: number, side: number): [number, number] => {
    const bow = Math.sin(Math.PI * t) * bend * height;
    const half = ((thickness * height) / 2) * (1 - t) ** 0.85 * (0.2 + 0.8 * smoothstep(0, 0.22, t));
    return [x0 + (x1 - x0) * t + nx * (bow + side * half), y0 + (y1 - y0) * t + ny * (bow + side * half)];
  };
  for (let i = 0; i < steps; i++) {
    // Each slice reaches a little into the next, so no seam shows between them.
    const a = i / steps;
    const b = Math.min(1, (i + 1.6) / steps);
    polygon(image, [edge(a, 1), edge(b, 1), edge(b, -1), edge(a, -1)], color, 255);
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
    glows: true,
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
    glows: true,
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
    glows: true,
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
  // Carbon fibre: a twill weave catching the light tow by tow, a gloss stripe in the colour pinstriped white.
  carbon: {
    dark: true,
    textAt: 0.44,
    paint: (image, accent) => {
      const { width, height } = image;
      const cell = Math.max(2, height / 40);
      paintEach(image, (u, v) => {
        const across = (u * width) / cell;
        const up = (v * height) / cell;
        const along = (Math.floor(across) + Math.floor(up)) % 4 < 2;
        const sheen = 0.5 + 0.5 * Math.sin((along ? up % 1 : across % 1) * Math.PI);
        const level = along ? 30 + 22 * sheen : 22 + 12 * sheen;
        return [level, level + 2, level + 6];
      });
      const pin: Rgb = [235, 238, 242];
      fillRect(image, 0, height * 0.14, width, height * 0.27, accent);
      fillRect(image, 0, height * 0.115, width, height * 0.13, pin);
      fillRect(image, 0, height * 0.28, width, height * 0.295, pin);
      fillRect(image, 0, height * 0.87, width, height * 0.9, accent);
    },
  },
  // Rally: the front in the colour cut back on a slant, stripes following the cut, a roundel with a star and a
  // chequered strip along the foot.
  rally: {
    textAt: 0.3,
    paint: (image, accent) => {
      const { width, height } = image;
      paintEach(image, (u, v) => {
        const cut = 0.3 + 0.14 * v;
        if (u < cut) {
          return accent;
        }
        for (let i = 0; i < 3; i++) {
          const from = cut + 0.025 + i * 0.04;
          if (u >= from && u < from + 0.02) {
            return i === 1 ? INK : accent;
          }
        }
        return null;
      });
      const cell = height * 0.05;
      for (let row = 0; row < 2; row++) {
        for (let column = 0; column * cell < width; column++) {
          if ((row + column) % 2 === 0) {
            fillRect(image, column * cell, height * 0.04 + row * cell, (column + 1) * cell, height * 0.04 + (row + 1) * cell, INK);
          }
        }
      }
      const cx = width * 0.1;
      const cy = height * 0.74;
      const r = height * 0.15;
      disc(image, cx, cy, r, INK);
      disc(image, cx, cy, r * 0.84, WHITE_BODY);
      star(image, cx, cy, r * 0.7, accent);
    },
  },
  // Pixels: an 8-bit mosaic in shades of the colour, thick at the front and scattering toward the rear, a clear
  // band left for the lettering.
  pixel: {
    textAt: 0.4,
    paint: (image, accent) => {
      const { width, height } = image;
      const cell = height / 12;
      const tones: readonly Rgb[] = [darker(accent, 0.35), accent, lighter(accent, 0.3), lighter(accent, 0.6)];
      const random = new SeededRandom(71);
      for (let row = 0; row * cell < height; row++) {
        const v = ((row + 0.5) * cell) / height;
        for (let column = 0; column * cell < width; column++) {
          const keep = 1.2 - ((column + 0.5) * cell * 1.15) / width - Math.abs(v - 0.5) * 0.3;
          const roll = random.next();
          const tone = tones[Math.floor(random.next() * tones.length)]!;
          if (roll < keep && (v < 0.36 || v > 0.64)) {
            fillRect(image, column * cell + 1, row * cell + 1, (column + 1) * cell - 1, (row + 1) * cell - 1, tone);
          }
        }
      }
    },
  },
  // Tribal: black blades sweeping back from the front along the top and the foot, edged in the colour.
  tribal: {
    textAt: 0.42,
    paint: (image, accent) => {
      const blades: readonly (readonly [readonly [number, number], readonly [number, number], number, number])[] = [
        [[0.0, 0.8], [0.72, 0.94], 0.1, 0.18],
        [[0.0, 0.2], [0.72, 0.06], -0.1, 0.18],
        [[0.28, 0.8], [0.98, 0.7], -0.07, 0.11],
        [[0.28, 0.2], [0.98, 0.3], 0.07, 0.11],
      ];
      for (const [from, to, bend, thickness] of blades) {
        blade(image, from, to, bend, thickness * 1.25, accent);
      }
      for (const [from, to, bend, thickness] of blades) {
        blade(image, from, to, bend, thickness, INK);
      }
    },
  },
  // The northern lights: curtains, green low and violet high, folding over a starry night above dark hills.
  aurora: {
    dark: true,
    glows: true,
    textAt: 0.14,
    paint: (image, accent) => {
      const { width, height } = image;
      const high = mixRgb([170, 70, 240], accent, 0.35);
      paintEach(image, (u, v) => {
        const sky = mixRgb([4, 8, 22], [16, 28, 64], v);
        const foot = 0.42 + 0.08 * Math.sin(u * 7 + 0.4) + 0.04 * Math.sin(u * 17 + 1.3);
        const h = v - foot;
        const body = smoothstep(-0.02, 0.03, h) * Math.exp(-Math.max(h, 0) * 3.4);
        const rays = 0.55 + 0.45 * Math.sin(u * 90 + 3 * Math.sin(u * 13));
        const folds = Math.max(0.15, 0.45 + 0.55 * Math.sin(u * 5 + 1) * Math.sin(u * 2.3));
        const glow = Math.min(1, body * (0.5 + 0.5 * rays) * folds * 1.3);
        return mixRgb(sky, mixRgb([40, 255, 140], high, smoothstep(0.05, 0.4, h)), glow);
      });
      const random = new SeededRandom(83);
      for (let i = 0; i < 300; i++) {
        blendPixel(image, Math.floor(random.next() * width), Math.floor(height * (0.3 + random.next() * 0.7)), [235, 240, 255], 0.35 + random.next() * 0.5);
      }
      paintEach(image, (u, v) => {
        const hills = 0.1 + 0.035 * Math.sin(u * 11 + 2) + 0.02 * Math.sin(u * 29);
        return v < hills ? [6, 10, 18] : null;
      });
    },
  },
  // An eclipse: the corona round the black moon high over a sunset's glow all round the horizon, the stars out.
  eclipse: {
    dark: true,
    glows: true,
    textAt: 0.1,
    paint: (image, accent) => {
      const { width, height } = image;
      paintEach(image, (_u, v) => mixRgb(mixRgb([226, 120, 70], [60, 36, 70], smoothstep(0, 0.22, v)), [10, 12, 30], smoothstep(0.18, 0.6, v)));
      const random = new SeededRandom(89);
      for (let i = 0; i < 220; i++) {
        blendPixel(image, Math.floor(random.next() * width), Math.floor(height * (0.35 + random.next() * 0.65)), [235, 240, 255], 0.3 + random.next() * 0.6);
      }
      const cx = width * 0.5;
      const cy = height * 0.66;
      const r = height * 0.15;
      const ring = lighter(accent, 0.65);
      for (let y = Math.floor(cy - r * 3.5); y <= cy + r * 3.5; y++) {
        for (let x = Math.floor(cx - r * 3.5); x <= cx + r * 3.5; x++) {
          const dx = x + 0.5 - cx;
          const dy = y + 0.5 - cy;
          const d = Math.sqrt(dx * dx + dy * dy) / r;
          if (d < 1) {
            continue;
          }
          const around = Math.atan2(dy, dx);
          const streamers = 0.55 + 0.25 * Math.sin(around * 2 + 0.6) + 0.2 * Math.sin(around * 5 + 1.9) * Math.sin(around * 3);
          const corona = Math.exp(-(d - 1) * (5.5 - 3.2 * streamers)) * (0.45 + 0.55 * streamers);
          blendPixel(image, x, y, ring, Math.min(1, corona * 1.3));
        }
      }
      disc(image, cx, cy, r * 1.04, [255, 120, 150]);
      disc(image, cx, cy, r, [4, 4, 8]);
    },
  },
};
