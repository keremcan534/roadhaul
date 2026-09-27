import { describe, expect, it } from 'vitest';
import type { PixelRect } from '../../../../src/presentation/textures/drawing';
import type { PixelImage } from '../../../../src/presentation/textures/pixelImage';
import {
  PROP_ATLAS,
  PROP_ATLAS_HEIGHT,
  PROP_ATLAS_WIDTH,
  SPEED_LIMIT_FACES,
  TRIANGLE_CORNERS,
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

  it('draws the road signs: warning triangles white in a red rim, give way upside down, stop and the chevron', () => {
    const isRed = ([r, g, b]: number[]): boolean => r! > 180 && g! < 60 && b! < 60;
    const isWhite = ([r, g, b]: number[]): boolean => r! > 230 && g! > 230 && b! > 230;
    const isInk = ([r, g, b]: number[]): boolean => r! < 60 && g! < 60 && b! < 60;
    // A triangle's corners, and a point a fifth of the way in from each toward its middle (the rim) and halfway (white).
    const at = (rect: PixelRect, corners: readonly (readonly [number, number])[], toward: number): [number, number][] => {
      const points = corners.map(([u, v]) => [rect.x + u * rect.width, rect.y + v * rect.height] as const);
      const middleX = points.reduce((sum, [x]) => sum + x, 0) / 3;
      const middleY = points.reduce((sum, [, y]) => sum + y, 0) / 3;
      return points.map(([x, y]) => [x + (middleX - x) * toward, y + (middleY - y) * toward]);
    };
    for (const name of ['bend', 'sideRoad', 'crossroads'] as const) {
      const rect = PROP_ATLAS[name];
      for (const [x, y] of at(rect, TRIANGLE_CORNERS, 0.12)) {
        expect(isRed(pixel(image, x, y)), `${name}: rim`).toBe(true);
      }
      for (const [x, y] of at(rect, TRIANGLE_CORNERS, 0.45)) {
        expect(isWhite(pixel(image, x, y)), `${name}: inside`).toBe(true);
      }
      // A black symbol in the middle.
      let ink = 0;
      for (let dy = -20; dy <= 20; dy += 2) {
        for (let dx = -20; dx <= 20; dx += 2) {
          ink += isInk(pixel(image, rect.x + rect.width / 2 + dx, rect.y + rect.height * 0.35 + dy)) ? 1 : 0;
        }
      }
      expect(ink, `${name}: symbol`).toBeGreaterThan(20);
    }
    const upsideDown = TRIANGLE_CORNERS.map(([u, v]) => [u, 1 - v] as const);
    for (const [x, y] of at(PROP_ATLAS.giveWay, upsideDown, 0.45)) {
      expect(isWhite(pixel(image, x, y))).toBe(true);
    }
    const { stop, chevron } = PROP_ATLAS;
    expect(isRed(pixel(image, stop.x + 20, stop.y + stop.height / 2))).toBe(true);
    expect(isWhite(pixel(image, stop.x + 2, stop.y + 2))).toBe(true);
    expect(isRed(pixel(image, chevron.x + 20, chevron.y + 20))).toBe(true);
    // The arrow's tip on the left, halfway up.
    expect(isWhite(pixel(image, chevron.x + chevron.width * 0.3, chevron.y + chevron.height / 2))).toBe(true);
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
