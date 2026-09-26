import { describe, expect, it } from 'vitest';
import type { RiverDefinition } from '../../../../src/data/definitions/MapDefinition';
import { RiverPath } from '../../../../src/domain/world/RiverPath';
import type { GroundMask } from '../../../../src/presentation/world/groundMask';
import { createChannelMask, riverCourse } from '../../../../src/presentation/world/riverChannel';
import { seaFixture } from '../../../support/contentFixtures';

/** A river 20 m wide flowing south along x = 40, from z = 200 to z = -200, that never reaches the sea. */
const inland: RiverDefinition = {
  id: 'test_river',
  widthMeters: 20,
  points: [
    [40, 200],
    [40, 0],
    [40, -200],
  ],
};
/** One flowing west along z = 30 into the fixture's sea, whose shore runs along x = -180. */
const estuary: RiverDefinition = {
  id: 'estuary',
  widthMeters: 20,
  points: [
    [150, 30],
    [0, 30],
    [-190, 30],
  ],
};

/**
 * The mask at world (x, z) as the GPU filters it (bilinear, clamped to its
 * edges): 0..1, under 0.5 where the ground is cut open.
 */
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

describe('riverCourse', () => {
  it('flows in from far beyond its source and on past its end when it never meets the sea', () => {
    const river = new RiverPath(inland);
    const course = riverCourse(river);
    const [first, last] = [course[0]!, course[course.length - 1]!];

    expect(first.x).toBeCloseTo(40, 6);
    expect(first.z).toBeCloseTo(1100, 6);
    expect(last.z).toBeCloseTo(-1100, 6);
    expect(course.every((point) => point.depth === 1 && point.dz < -0.99)).toBe(true);
    for (let i = 1; i < course.length; i++) {
      expect(course[i]!.along).toBeGreaterThan(course[i - 1]!.along);
    }
    expect(first.along).toBeCloseTo(-900, 6);
  });

  it('ends at its mouth, level with the sea', () => {
    const river = new RiverPath(estuary, seaFixture().shoreline);
    const course = riverCourse(river);
    const last = course[course.length - 1]!;

    expect(last.x).toBeCloseTo(river.x(river.mouthIndex), 9);
    expect(last.x).toBeLessThan(-180);
    expect(last.depth).toBe(0);
  });
});

describe('createChannelMask', () => {
  it('cuts the ground open over the channel, a hair inside its rim, and nowhere else', () => {
    const river = new RiverPath(inland);
    const mask = createChannelMask([river])!;
    const rim = river.openingHalfWidthMeters;

    for (const z of [150, 0, -150]) {
      expect(sample(mask, 40, z), `middle at z = ${z}`).toBeLessThan(0.5);
      // Down the banks, a meter and more inside the rim: cut.
      expect(sample(mask, 40 + rim - 1.5, z)).toBeLessThan(0.5);
      expect(sample(mask, 40 - rim + 1.5, z)).toBeLessThan(0.5);
      // At the rim the ground stays, overlapping the top of the banks.
      expect(sample(mask, 40 + rim - 0.5, z)).toBeGreaterThan(0.5);
      expect(sample(mask, 40 - rim + 0.5, z)).toBeGreaterThan(0.5);
      expect(sample(mask, 40 + rim + 3, z)).toBeGreaterThan(0.5);
    }
    // Off the texture, the ground is whole.
    expect(sample(mask, 900, 0)).toBe(1);
    expect(mask.texture.image.width % 4).toBe(0);
    mask.texture.dispose();
  });

  it('closes the ground over the channel short of its ends on land, where it flows in from off the map', () => {
    const river = new RiverPath(inland);
    const mask = createChannelMask([river])!;
    // The course runs from z = 1100 to z = -1100 (riverCourse); the cut stops 30 m short of each end.
    expect(sample(mask, 40, 1100)).toBeGreaterThan(0.5);
    expect(sample(mask, 40, 1085)).toBeGreaterThan(0.5);
    expect(sample(mask, 40, 1060)).toBeLessThan(0.5);
    expect(sample(mask, 40, -1060)).toBeLessThan(0.5);
    expect(sample(mask, 40, -1085)).toBeGreaterThan(0.5);
  });

  it('runs the cut on into the sea at a river\'s mouth', () => {
    const river = new RiverPath(estuary, seaFixture().shoreline);
    const mask = createChannelMask([river])!;
    const mouth = river.x(river.mouthIndex);

    expect(sample(mask, -170, 30)).toBeLessThan(0.5);
    expect(sample(mask, mouth, 30)).toBeLessThan(0.5);
  });

  it('cuts nothing without rivers', () => {
    expect(createChannelMask([])).toBeNull();
  });
});
