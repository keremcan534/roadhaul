import { describe, expect, it } from 'vitest';
import {
  CAB_ATLAS,
  CAB_ATLAS_HEIGHT,
  CAB_ATLAS_WIDTH,
  CLUSTER_DIALS,
  CLUSTER_DISPLAY,
  atlasUv,
  cabAtlasImage,
  dialAngle,
  type AtlasRect,
} from '../../../../src/presentation/textures/cabImages';
import type { PixelImage } from '../../../../src/presentation/textures/pixelImage';

function pixel(image: PixelImage, x: number, y: number): number[] {
  const i = (Math.round(y) * image.width + Math.round(x)) * 4;
  return [...image.data.subarray(i, i + 4)];
}

const middle = (rect: AtlasRect): [number, number] => [rect.x + rect.width / 2, rect.y + rect.height / 2];

describe('cabImages', () => {
  const image = cabAtlasImage(2500, 90);

  it('turns a needle from its dial\'s start clockwise to its end, and no further', () => {
    const dial = CLUSTER_DIALS.speedometer;
    expect(dialAngle(dial, dial.min)).toBeCloseTo((dial.startDegrees * Math.PI) / 180, 12);
    expect(dialAngle(dial, dial.max)).toBeCloseTo(((dial.startDegrees - dial.sweepDegrees) * Math.PI) / 180, 12);
    expect(dialAngle(dial, (dial.min + dial.max) / 2)).toBeCloseTo(Math.PI / 2, 12);
    expect(dialAngle(dial, 1000)).toBe(dialAngle(dial, dial.max));
    expect(dialAngle(dial, -5)).toBe(dialAngle(dial, dial.min));
  });

  it('lays its pictures out without overlaps, within the atlas, the dials and the display within the cluster', () => {
    const rects = Object.entries(CAB_ATLAS);
    for (const [name, rect] of rects) {
      expect(rect.x, name).toBeGreaterThanOrEqual(0);
      expect(rect.y, name).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width, name).toBeLessThanOrEqual(CAB_ATLAS_WIDTH);
      expect(rect.y + rect.height, name).toBeLessThanOrEqual(CAB_ATLAS_HEIGHT);
      for (const [other, second] of rects) {
        if (other !== name) {
          const apart =
            rect.x + rect.width <= second.x || second.x + second.width <= rect.x || rect.y + rect.height <= second.y || second.y + second.height <= rect.y;
          expect(apart, `${name} and ${other}`).toBe(true);
        }
      }
    }
    const { cluster } = CAB_ATLAS;
    for (const [name, dial] of Object.entries(CLUSTER_DIALS)) {
      expect(dial.x - dial.radius, name).toBeGreaterThanOrEqual(0);
      expect(dial.x + dial.radius, name).toBeLessThanOrEqual(cluster.width);
      expect(dial.y + dial.radius, name).toBeLessThanOrEqual(cluster.height);
    }
    expect(CLUSTER_DISPLAY.x + CLUSTER_DISPLAY.width).toBeLessThan(CLUSTER_DIALS.speedometer.x - CLUSTER_DIALS.speedometer.radius + 20);
    expect(atlasUv(cluster, 0, 0)).toEqual([0, cluster.y / CAB_ATLAS_HEIGHT]);
    expect(atlasUv(cluster, 1, 1)).toEqual([cluster.width / CAB_ATLAS_WIDTH, 1]);
  });

  it('paints its swatches in one colour each: white, glowing white and the needles\' glowing orange', () => {
    expect(image.width).toBe(CAB_ATLAS_WIDTH);
    expect(image.height).toBe(CAB_ATLAS_HEIGHT);
    expect(pixel(image, ...middle(CAB_ATLAS.plain))).toEqual([255, 255, 255, 0]);
    expect(pixel(image, ...middle(CAB_ATLAS.glow))).toEqual([255, 255, 255, 255]);
    const [red, green, blue, glow] = pixel(image, ...middle(CAB_ATLAS.needle));
    expect(red).toBe(255);
    expect(green!).toBeLessThan(red! / 2);
    expect(blue!).toBeLessThan(green!);
    expect(glow).toBe(255);
  });

  it('marks what glows at night in the alpha: the scales and figures, not the dark faces and the plastic', () => {
    const { cluster } = CAB_ATLAS;
    const tach = CLUSTER_DIALS.tachometer;
    let glowing = 0;
    let dark = 0;
    for (let y = -tach.radius; y <= tach.radius; y++) {
      for (let x = -tach.radius; x <= tach.radius; x++) {
        if (x * x + y * y < tach.radius * tach.radius) {
          const alpha = pixel(image, cluster.x + tach.x + x, cluster.y + tach.y + y)[3]!;
          if (alpha > 128) glowing++;
          else dark++;
        }
      }
    }
    expect(glowing).toBeGreaterThan(800);
    expect(dark).toBeGreaterThan(glowing * 5);
    // The plastic between the dials, and the seats' fabric, do not glow.
    expect(pixel(image, cluster.x + 10, cluster.y + 245)[3]).toBe(0);
    expect(pixel(image, ...middle(CAB_ATLAS.fabric))[3]).toBe(0);
  });

  it('reds the rev counter from the engine\'s governed speed up, and nothing below it', () => {
    const { cluster } = CAB_ATLAS;
    const tach = CLUSTER_DIALS.tachometer;
    const bandAt = (rpm: number): number[] => {
      const angle = dialAngle(tach, rpm);
      return pixel(image, cluster.x + tach.x + Math.cos(angle) * (tach.radius - 3), cluster.y + tach.y + Math.sin(angle) * (tach.radius - 3));
    };
    const red = bandAt(2750);
    expect(red[0]!).toBeGreaterThan(180);
    expect(red[1]!).toBeLessThan(90);
    const below = bandAt(2350);
    expect(below[0]! - below[1]!).toBeLessThan(60);
  });

  it('is the same picture every time for the same truck', () => {
    /** A hash of the pixels (FNV-1a): comparing two million bytes one by one is slow in expect(). */
    const hash = (picture: PixelImage): number => {
      let value = 0x811c9dc5;
      for (const byte of picture.data) {
        value = Math.imul(value ^ byte, 0x01000193);
      }
      return value >>> 0;
    };
    expect(hash(cabAtlasImage(2500, 90))).toBe(hash(image));
    expect(hash(cabAtlasImage(2700, 90))).not.toBe(hash(image));
  });
});
