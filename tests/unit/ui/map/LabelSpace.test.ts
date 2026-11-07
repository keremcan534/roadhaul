import { describe, expect, it } from 'vitest';
import { keptInside, LabelSpace } from '../../../../src/ui/map/LabelSpace';

describe('LabelSpace', () => {
  it('keeps a name off one placed before it, and lets one beside it or under it be', () => {
    const space = new LabelSpace(8);
    // "Southmoor", then "Flintwick" starting inside it: left out.
    expect(space.tryTake(100, 50, 170, 64)).toBe(true);
    expect(space.tryTake(160, 50, 220, 64)).toBe(false);
    expect(space.size).toBe(1);
    // Edge to edge, or a line further down: both clear.
    expect(space.tryTake(170, 50, 230, 64)).toBe(true);
    expect(space.tryTake(100, 64, 170, 78)).toBe(true);
    expect(space.isFree(0, 0, 99, 49)).toBe(true);
    expect(space.isFree(120, 60, 130, 70)).toBe(false);
  });

  it('frees every box for the next paint, and past its capacity keeps no more', () => {
    const space = new LabelSpace(2);
    space.take(0, 0, 10, 10);
    space.take(20, 0, 30, 10);
    space.take(40, 0, 50, 10); // Over the capacity: not kept.
    expect(space.size).toBe(2);
    expect(space.isFree(42, 2, 48, 8)).toBe(true);
    space.clear();
    expect(space.size).toBe(0);
    expect(space.isFree(2, 2, 8, 8)).toBe(true);
  });

  it('keeps a label inside the map: moved in from the edge its point is near, in the middle when wider than the map', () => {
    // A ferry 10 px from the left edge, its name 160 px wide on a map 412 px wide.
    expect(keptInside(10, 80, 412)).toBe(80);
    expect(keptInside(400, 80, 412)).toBe(332);
    expect(keptInside(200, 80, 412)).toBe(200);
    expect(keptInside(10, 300, 412)).toBe(206);
  });
});
