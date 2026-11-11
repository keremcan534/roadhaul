import { describe, expect, it } from 'vitest';
import { LIVERY_PATTERNS } from '../../../../src/data/definitions/LiveryDefinition';
import { liveryImage, liveryThumbnail } from '../../../../src/presentation/textures/liveryImages';

/** The mean brightness of an image, 0..255. */
function brightness(data: Uint8ClampedArray | Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
  }
  return sum / (data.length / 4);
}

describe('liveryImage', () => {
  it('draws every design, the same each time, different from each other', () => {
    const seen = new Set<string>();
    for (const pattern of LIVERY_PATTERNS) {
      const image = liveryThumbnail([200, 40, 40], pattern, 96, 48);
      expect(image.data).toEqual(liveryThumbnail([200, 40, 40], pattern, 96, 48).data);
      seen.add(Array.from(image.data).join(','));
    }
    expect(seen.size).toBe(LIVERY_PATTERNS.length);
  });

  it('takes the truck\'s colour', () => {
    for (const pattern of LIVERY_PATTERNS) {
      const red = liveryThumbnail([220, 30, 30], pattern, 96, 48).data;
      const blue = liveryThumbnail([30, 60, 220], pattern, 96, 48).data;
      expect(red, pattern).not.toEqual(blue);
    }
  });

  it('letters the text across the side, a long one shrunk to fit', () => {
    const plain = liveryImage([200, 40, 40], 'speed', 'A', 256, 128);
    const long = liveryImage([200, 40, 40], 'speed', 'KUZEY LOJİSTİK', 256, 128);
    expect(long.data).not.toEqual(plain.data);
    // The dark designs letter in white: brighter than without lettering.
    expect(brightness(liveryImage([30, 60, 220], 'galaxy', 'WWWWWWWW', 256, 128).data)).toBeGreaterThan(
      brightness(liveryThumbnail([30, 60, 220], 'galaxy', 256, 128).data),
    );
  });
});
