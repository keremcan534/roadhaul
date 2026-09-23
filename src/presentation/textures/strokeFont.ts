import { blendPixel, type PixelImage, type Rgb } from './pixelImage';

type Point = readonly [x: number, y: number];

interface Glyph {
  /** Advance width in units of the cap height. */
  readonly width: number;
  /** Polylines in a box 0..width × 0..1 (y up). */
  readonly strokes: readonly (readonly Point[])[];
}

/** Points on an elliptical arc, angles in degrees counter-clockwise from +x. */
function arc(cx: number, cy: number, rx: number, ry: number, fromDegrees: number, toDegrees: number): Point[] {
  const steps = Math.max(4, Math.ceil(Math.abs(toDegrees - fromDegrees) / 10));
  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = ((fromDegrees + ((toDegrees - fromDegrees) * i) / steps) * Math.PI) / 180;
    points.push([cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]);
  }
  return points;
}

/**
 * A tiny geometric stroke font: just the letters the game's own logos need.
 * Unknown characters render as a space.
 */
const GLYPHS: Readonly<Record<string, Glyph>> = {
  A: {
    width: 0.66,
    strokes: [
      [
        [0, 0],
        [0.33, 1],
        [0.66, 0],
      ],
      [
        [0.14, 0.36],
        [0.52, 0.36],
      ],
    ],
  },
  D: { width: 0.6, strokes: [[[0, 0], [0, 1], [0.24, 1], ...arc(0.24, 0.5, 0.36, 0.5, 90, -90), [0, 0]]] },
  H: {
    width: 0.6,
    strokes: [
      [
        [0, 0],
        [0, 1],
      ],
      [
        [0.6, 0],
        [0.6, 1],
      ],
      [
        [0, 0.52],
        [0.6, 0.52],
      ],
    ],
  },
  L: {
    width: 0.5,
    strokes: [
      [
        [0, 1],
        [0, 0],
        [0.5, 0],
      ],
    ],
  },
  O: { width: 0.7, strokes: [arc(0.35, 0.5, 0.35, 0.5, 0, 360)] },
  R: {
    width: 0.6,
    strokes: [
      [[0, 0], [0, 1], [0.3, 1], ...arc(0.3, 0.75, 0.27, 0.25, 90, -90), [0, 0.5]],
      [
        [0.3, 0.5],
        [0.6, 0],
      ],
    ],
  },
  U: { width: 0.6, strokes: [[[0, 1], [0, 0.32], ...arc(0.3, 0.32, 0.3, 0.32, 180, 360), [0.6, 1]]] },
};

const SPACE_WIDTH = 0.45;

export interface TextStyle {
  /** Cap height in pixels. */
  readonly height: number;
  /** Stroke thickness as a fraction of the cap height. */
  readonly weight: number;
  /** Extra space between letters, fraction of the cap height. */
  readonly spacing: number;
  /** Italic shear: x shifts by `slant × y`. */
  readonly slant: number;
  readonly color: Rgb;
}

/** Width of `text` in pixels when drawn with `style`. */
export function measureText(text: string, style: TextStyle): number {
  let width = 0;
  for (const character of text) {
    width += ((GLYPHS[character]?.width ?? SPACE_WIDTH) + style.spacing) * style.height;
  }
  return Math.max(0, width - style.spacing * style.height) + style.height * style.weight;
}

/**
 * Draws `text` with its baseline-left corner at (x, y) in pixels (y up), as
 * anti-aliased round strokes. Only pixels near each glyph are visited.
 */
export function drawText(image: PixelImage, text: string, x: number, y: number, style: TextStyle): void {
  const radius = (style.weight * style.height) / 2;
  let penX = x + radius;
  for (const character of text) {
    const glyph = GLYPHS[character];
    if (glyph !== undefined) {
      const segments: [number, number, number, number][] = [];
      for (const stroke of glyph.strokes) {
        for (let i = 0; i + 1 < stroke.length; i++) {
          const [ax, ay] = stroke[i]!;
          const [bx, by] = stroke[i + 1]!;
          segments.push([
            penX + (ax + style.slant * ay) * style.height,
            y + ay * style.height,
            penX + (bx + style.slant * by) * style.height,
            y + by * style.height,
          ]);
        }
      }
      drawSegments(image, segments, radius, style.color);
    }
    penX += ((glyph?.width ?? SPACE_WIDTH) + style.spacing) * style.height;
  }
}

function drawSegments(image: PixelImage, segments: readonly [number, number, number, number][], radius: number, color: Rgb): void {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [ax, ay, bx, by] of segments) {
    minX = Math.min(minX, ax, bx);
    minY = Math.min(minY, ay, by);
    maxX = Math.max(maxX, ax, bx);
    maxY = Math.max(maxY, ay, by);
  }
  for (let py = Math.floor(minY - radius - 1); py <= Math.ceil(maxY + radius + 1); py++) {
    for (let px = Math.floor(minX - radius - 1); px <= Math.ceil(maxX + radius + 1); px++) {
      const cx = px + 0.5;
      const cy = py + 0.5;
      let nearest = Infinity;
      for (const [ax, ay, bx, by] of segments) {
        nearest = Math.min(nearest, distanceToSegment(cx, cy, ax, ay, bx, by));
      }
      // One pixel of anti-aliasing at the stroke edge.
      blendPixel(image, px, py, color, radius - nearest + 0.5);
    }
  }
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}
