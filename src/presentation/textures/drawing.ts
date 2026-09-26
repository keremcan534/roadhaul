import { clamp } from '../../core/math/scalar';
import { blendPixel, type PixelImage, type Rgb } from './pixelImage';
import { drawText, measureText } from './strokeFont';

/**
 * Anti-aliased shapes for procedural pictures (pixelImage.ts): rectangles,
 * rounded boxes, discs and rings with gradients, strokes and centred text.
 * Each takes the alpha it leaves, so a picture's alpha can be a mask (what
 * glows at night, cabImages.ts) rather than see-through.
 */

/** A rectangle of a picture, in pixels from its bottom-left corner. */
export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function fillRect(image: PixelImage, rect: PixelRect, color: Rgb, alpha: number): void {
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      blendPixel(image, x, y, color, 1, alpha);
    }
  }
}

/** A colour a shader writes into (no array per pixel). */
export type Paint = [number, number, number];

/** Fills `rect` pixel by pixel with the colour `shader(u, v, x, y, out)` writes into `out` (u, v 0..1 across it). */
export function shadeRect(image: PixelImage, rect: PixelRect, shader: (u: number, v: number, x: number, y: number, out: Paint) => void, alpha = 0): void {
  const color: Paint = [0, 0, 0];
  const { data, width } = image;
  for (let y = 0; y < rect.height; y++) {
    for (let x = 0; x < rect.width; x++) {
      shader((x + 0.5) / rect.width, (y + 0.5) / rect.height, x, y, color);
      const i = ((rect.y + y) * width + rect.x + x) * 4;
      data[i] = toByte(color[0]);
      data[i + 1] = toByte(color[1]);
      data[i + 2] = toByte(color[2]);
      data[i + 3] = alpha;
    }
  }
}

function toByte(value: number): number {
  return value <= 0 ? 0 : value >= 255 ? 255 : Math.round(value);
}

/** Sets `out` to `r`, `g`, `b`. */
export function paint(out: Paint, r: number, g: number, b: number): void {
  out[0] = r;
  out[1] = g;
  out[2] = b;
}

/** A rounded rectangle from (x0, y0) to (x1, y1), corners of `radius`. */
export function roundedBox(image: PixelImage, x0: number, y0: number, x1: number, y1: number, radius: number, color: Rgb, alpha: number): void {
  for (let y = Math.floor(y0) - 1; y <= Math.ceil(y1); y++) {
    for (let x = Math.floor(x0) - 1; x <= Math.ceil(x1); x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const dx = Math.max(x0 + radius - px, 0, px - (x1 - radius));
      const dy = Math.max(y0 + radius - py, 0, py - (y1 - radius));
      const outside = Math.sqrt(dx * dx + dy * dy) - radius;
      blendPixel(image, x, y, color, clamp(0.5 - outside, 0, 1), alpha);
    }
  }
}

/**
 * A disc of `radius` round (cx, cy): `from` all over ('flat'), from `from`
 * in the middle to `to` at the rim ('radial'), or lit from above like a
 * metal ring, `from` in the shade to `to` in the light, the light turned by
 * `turn` radians ('lit').
 */
export function disc(
  image: PixelImage,
  cx: number,
  cy: number,
  radius: number,
  from: Rgb,
  alpha: number,
  gradient: 'flat' | 'radial' | 'lit' = 'flat',
  to: Rgb = from,
  turn = 0,
): void {
  const color: Paint = [from[0], from[1], from[2]];
  for (let y = Math.floor(cy - radius) - 1; y <= Math.ceil(cy + radius); y++) {
    for (let x = Math.floor(cx - radius) - 1; x <= Math.ceil(cx + radius); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const coverage = clamp(radius - distance + 0.5, 0, 1);
      if (coverage <= 0) {
        continue;
      }
      if (gradient !== 'flat') {
        const light = gradient === 'radial' ? distance / radius : 0.5 + 0.5 * Math.sin(Math.atan2(dy, dx) + turn);
        const t = light * light;
        color[0] = from[0] + (to[0] - from[0]) * t;
        color[1] = from[1] + (to[1] - from[1]) * t;
        color[2] = from[2] + (to[2] - from[2]) * t;
      }
      blendPixel(image, x, y, color, coverage, alpha);
    }
  }
}

/** A ring between radii `inner` and `outer`, from `fromDegrees` clockwise to `toDegrees` (the whole round when equal). */
export function arcBand(
  image: PixelImage,
  cx: number,
  cy: number,
  inner: number,
  outer: number,
  fromDegrees: number,
  toDegrees: number,
  color: Rgb | ((angle: number) => Rgb),
  alpha: number,
): void {
  const whole = fromDegrees === toDegrees;
  const span = (((fromDegrees - toDegrees) % 360) + 360) % 360;
  for (let y = Math.floor(cy - outer) - 1; y <= Math.ceil(cy + outer); y++) {
    for (let x = Math.floor(cx - outer) - 1; x <= Math.ceil(cx + outer); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const distance = Math.sqrt(dx * dx + dy * dy);
      let coverage = clamp(Math.min(distance - inner + 0.5, outer - distance + 0.5), 0, 1);
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (!whole && coverage > 0) {
        // Degrees clockwise from the start, and a pixel's worth of softening at both ends.
        const along = (((fromDegrees - angle) % 360) + 360) % 360;
        const pixelDegrees = (180 / Math.PI) / Math.max(distance, 1);
        const beyond = along > span ? Math.min(along - span, 360 - along) : -Math.min(along, span - along);
        coverage *= clamp(0.5 - beyond / pixelDegrees, 0, 1);
      }
      if (coverage > 0) {
        blendPixel(image, x, y, typeof color === 'function' ? color(angle) : color, coverage, alpha);
      }
    }
  }
}

/** A straight stroke of `width` pixels from (ax, ay) to (bx, by), with square-ish ends. */
export function line(image: PixelImage, ax: number, ay: number, bx: number, by: number, width: number, color: Rgb, alpha: number): void {
  const half = width / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  for (let y = Math.floor(Math.min(ay, by) - half) - 1; y <= Math.ceil(Math.max(ay, by) + half); y++) {
    for (let x = Math.floor(Math.min(ax, bx) - half) - 1; x <= Math.ceil(Math.max(ax, bx) + half); x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const t = lengthSquared > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / lengthSquared, 0, 1) : 0;
      const ex = px - (ax + dx * t);
      const ey = py - (ay + dy * t);
      const distance = Math.sqrt(ex * ex + ey * ey);
      blendPixel(image, x, y, color, clamp(half - distance + 0.5, 0, 1), alpha);
    }
  }
}

/** `text` centred on (cx, cy), capitals `height` pixels tall. */
export function centredText(image: PixelImage, text: string, cx: number, cy: number, height: number, color: Rgb, alpha: number, weight = 0.14): void {
  const style = { height, weight, spacing: 0.1, slant: 0, color, alpha };
  drawText(image, text, cx - measureText(text, style) / 2, cy - height / 2, style);
}

