import { describe, expect, it } from 'vitest';
import type { PixelRect } from '../../../../src/presentation/textures/drawing';
import type { PixelImage } from '../../../../src/presentation/textures/pixelImage';
import {
  PROP_ATLAS,
  PROP_ATLAS_HEIGHT,
  PROP_ATLAS_WIDTH,
  SPEED_LIMIT_FACES,
  pavingImage,
  propAtlasImage,
} from '../../../../src/presentation/textures/propImages';

function pixel(image: PixelImage, x: number, y: number): number[] {
  const i = (Math.round(y) * image.width + Math.round(x)) * 4;
  return [...image.data.subarray(i, i + 4)];
}

/** The atlas's pictures by name, the posters numbered. */
const rects: [string, PixelRect][] = Object.entries(PROP_ATLAS).flatMap(([name, value]) =>
  Array.isArray(value) ? value.map((rect, index): [string, PixelRect] => [`${name}${index}`, rect]) : [[name, value as PixelRect]],
);

/** How many different colours a picture has (to 4 bits a channel): a poster has many, a swatch one. */
function colours(image: PixelImage, rect: PixelRect): number {
  const seen = new Set<number>();
  for (let y = rect.y; y < rect.y + rect.height; y += 2) {
    for (let x = rect.x; x < rect.x + rect.width; x += 2) {
      const [r, g, b] = pixel(image, x, y);
      seen.add(((r! >> 4) << 8) | ((g! >> 4) << 4) | (b! >> 4));
    }
  }
  return seen.size;
}

describe('propImages', () => {
  const image = propAtlasImage();

  it('lays its pictures out without overlaps, within the atlas', () => {
    expect(image.width).toBe(PROP_ATLAS_WIDTH);
    expect(image.height).toBe(PROP_ATLAS_HEIGHT);
    for (const [name, rect] of rects) {
      expect(rect.x, name).toBeGreaterThanOrEqual(0);
      expect(rect.y, name).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width, name).toBeLessThanOrEqual(PROP_ATLAS_WIDTH);
      expect(rect.y + rect.height, name).toBeLessThanOrEqual(PROP_ATLAS_HEIGHT);
      for (const [other, second] of rects) {
        if (other !== name) {
          const apart =
            rect.x + rect.width <= second.x || second.x + second.width <= rect.x || rect.y + rect.height <= second.y || second.y + second.height <= rect.y;
          expect(apart, `${name} and ${other}`).toBe(true);
        }
      }
    }
    expect(Object.keys(SPEED_LIMIT_FACES).map(Number)).toEqual([50, 70, 90]);
  });

  it('paints four different posters, speed limits in a red ring, and a white swatch', () => {
    for (const [index, poster] of PROP_ATLAS.posters.entries()) {
      expect(colours(image, poster), `poster ${index}`).toBeGreaterThan(20);
    }
    const middles = PROP_ATLAS.posters.map((poster) => pixel(image, poster.x + 40, poster.y + poster.height - 10));
    expect(new Set(middles.map((colour) => colour.join())).size).toBe(4);
    for (const face of Object.values(SPEED_LIMIT_FACES)) {
      // The ring, and white between it and the number.
      const [r, g, b] = pixel(image, face.x + face.width / 2, face.y + face.height / 2 + 55);
      expect(r).toBeGreaterThan(180);
      expect(g).toBeLessThan(60);
      expect(b).toBeLessThan(60);
      expect(pixel(image, face.x + face.width / 2 - 40, face.y + face.height / 2)).toEqual([246, 246, 242, 255]);
    }
    const { plain } = PROP_ATLAS;
    expect(colours(image, plain)).toBe(1);
    expect(pixel(image, plain.x + 5, plain.y + 5)).toEqual([255, 255, 255, 255]);
  });

  it('draws the same atlas every time', () => {
    const again = propAtlasImage();
    let same = true;
    for (let i = 0; i < image.data.length && same; i += 97) {
      same = image.data[i] === again.data[i];
    }
    expect(same).toBe(true);
  });

  it('paves in flagstones that tile: the left edge meets the right, the bottom the top', () => {
    const paving = pavingImage(64);
    const size = paving.width;
    const luminance = (x: number, y: number): number => {
      const [r, g, b] = pixel(paving, x, y);
      return (r! + g! + b!) / 3;
    };

    expect(paving.height).toBe(size);
    // Joints are dark lines on every row's bottom and at each stone's left edge.
    expect(luminance(size / 4, 0)).toBeLessThan(100);
    expect(luminance(size / 4, 8)).toBeGreaterThan(130);
    let seams = 0;
    for (let y = 0; y < size; y++) {
      // Across the wrap from the last column to the first, the stone goes on (or a joint starts on the first).
      seams += Math.abs(luminance(size - 1, y) - luminance(0, y)) > 60 && luminance(0, y) > 100 ? 1 : 0;
    }
    expect(seams).toBe(0);
  });
});
