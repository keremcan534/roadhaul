import { describe, expect, it } from 'vitest';
import { createForest } from '../../../../src/domain/world/forests';
import { createForestFloorMask } from '../../../../src/presentation/world/forestFloor';
import type { GroundMask } from '../../../../src/presentation/world/groundMask';

const wood = createForest({
  id: 'test_wood',
  kind: 'mixed',
  outline: [
    [0, 0],
    [200, 0],
    [200, 120],
    [0, 120],
  ],
});

/** The mask at world (x, z) as the GPU filters it (bilinear, clamped to its edges), 0..1. */
function sample(mask: GroundMask, x: number, z: number): number {
  const { data, width, height } = mask.texture.image as { data: Uint8Array; width: number; height: number };
  const u = (x - mask.frame.x) * mask.frame.z * width - 0.5;
  const v = (z - mask.frame.y) * mask.frame.w * height - 0.5;
  const column = Math.floor(u);
  const row = Math.floor(v);
  const across = u - column;
  const along = v - row;
  const at = (c: number, r: number): number =>
    data[Math.min(height - 1, Math.max(0, r)) * width + Math.min(width - 1, Math.max(0, c))]! / 255;
  return (
    (at(column, row) * (1 - across) + at(column + 1, row) * across) * (1 - along) +
    (at(column, row + 1) * (1 - across) + at(column + 1, row + 1) * across) * along
  );
}

describe('createForestFloorMask', () => {
  it('lays the forest floor under the trees, fading out just past the edge', () => {
    const mask = createForestFloorMask([wood])!;
    expect(sample(mask, 100, 60)).toBeGreaterThan(0.99);
    expect(sample(mask, 20, 60)).toBeGreaterThan(0.99);
    // At the edge, half shaded or so; a little way out, bare.
    expect(sample(mask, 0, 60)).toBeGreaterThan(0.2);
    expect(sample(mask, 0, 60)).toBeLessThan(0.7);
    expect(sample(mask, -20, 60)).toBe(0);
    expect(sample(mask, 100, 150)).toBe(0);
    // Off the texture, nothing.
    expect(sample(mask, 1000, 1000)).toBe(0);
    expect(mask.texture.image.width % 4).toBe(0);
    mask.texture.dispose();
  });

  it('is null without forests', () => {
    expect(createForestFloorMask([])).toBeNull();
  });
});
