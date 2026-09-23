/**
 * Procedural images for textures, drawn in plain TypeScript: no canvas, no
 * image files, no DOM. They run the same in the browser and in Node tests,
 * cost nothing to download, and are original by construction.
 *
 * Row 0 is the bottom of the texture (three.js DataTexture, flipY = false),
 * so `y` grows upward like texture `v`.
 */
export interface PixelImage {
  readonly width: number;
  readonly height: number;
  /** RGBA, 8 bits per channel, row by row from the bottom. */
  readonly data: Uint8Array;
}

export type Rgb = readonly [number, number, number];

export function createImage(width: number, height: number, fill: Rgb = [255, 255, 255], alpha = 255): PixelImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = fill[0];
    data[i * 4 + 1] = fill[1];
    data[i * 4 + 2] = fill[2];
    data[i * 4 + 3] = alpha;
  }
  return { width, height, data };
}

/** Writes one pixel, blending `color` over what is there with `coverage` (0..1). */
export function blendPixel(image: PixelImage, x: number, y: number, color: Rgb, coverage: number, alpha = 255): void {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height || coverage <= 0) {
    return;
  }
  const t = Math.min(1, coverage);
  const i = (y * image.width + x) * 4;
  const { data } = image;
  data[i] = Math.round(data[i]! + (color[0] - data[i]!) * t);
  data[i + 1] = Math.round(data[i + 1]! + (color[1] - data[i + 1]!) * t);
  data[i + 2] = Math.round(data[i + 2]! + (color[2] - data[i + 2]!) * t);
  data[i + 3] = Math.round(data[i + 3]! + (alpha - data[i + 3]!) * t);
}

/** Fills an axis-aligned rectangle (pixel units, inclusive start, exclusive end). */
export function fillRect(image: PixelImage, x0: number, y0: number, x1: number, y1: number, color: Rgb, coverage = 1): void {
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(image.height, Math.ceil(y1)); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(image.width, Math.ceil(x1)); x++) {
      blendPixel(image, x, y, color, coverage);
    }
  }
}

/** Multiplies every pixel's colour by `factor(x, y)`: the way noise and shading are applied. */
export function shade(image: PixelImage, factor: (x: number, y: number) => number): void {
  const { data, width, height } = image;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const f = factor(x, y);
      const i = (y * width + x) * 4;
      data[i] = clampByte(data[i]! * f);
      data[i + 1] = clampByte(data[i + 1]! * f);
      data[i + 2] = clampByte(data[i + 2]! * f);
    }
  }
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function clampByte(value: number): number {
  return value <= 0 ? 0 : value >= 255 ? 255 : Math.round(value);
}
