import { describe, expect, it } from 'vitest';
import type { RoadDefinition } from '../../../../src/data/definitions/MapDefinition';
import { RoadPath } from '../../../../src/domain/world/RoadPath';

const straight: RoadDefinition = {
  id: 'straight',
  widthMeters: 10,
  closed: false,
  controlPoints: [
    [-150, 0],
    [150, 0],
  ],
};

const loop: RoadDefinition = {
  id: 'loop',
  widthMeters: 8,
  closed: true,
  controlPoints: [
    [-100, -100],
    [100, -100],
    [100, 100],
    [-100, 100],
  ],
};

describe('RoadPath', () => {
  it('samples an open two-point road as a straight line from end to end', () => {
    const path = new RoadPath(straight);

    expect(path.lengthMeters).toBeCloseTo(300, 9);
    expect([path.x(0), path.z(0)]).toEqual([-150, 0]);
    expect([path.x(path.pointCount - 1), path.z(path.pointCount - 1)]).toEqual([150, 0]);
    for (let i = 0; i < path.pointCount; i++) {
      expect(path.z(i)).toBe(0);
    }
  });

  it('measures the distance to the centreline and knows its paved width', () => {
    const path = new RoadPath(straight);

    expect(path.distanceTo(10, 7)).toBeCloseTo(7, 9);
    expect(path.distanceTo(160, 0)).toBeCloseTo(10, 9);
    expect(path.contains(0, 4.9)).toBe(true);
    expect(path.contains(0, -5.1)).toBe(false);
  });

  it('passes through every control point of a closed loop and joins up', () => {
    const path = new RoadPath(loop);

    for (const [x, z] of loop.controlPoints) {
      expect(path.distanceTo(x, z)).toBeCloseTo(0, 9);
    }
    expect(path.segmentCount).toBe(path.pointCount);
    const lastGap = Math.hypot(path.x(0) - path.x(path.pointCount - 1), path.z(0) - path.z(path.pointCount - 1));
    expect(lastGap).toBeLessThan(5);
  });

  it('keeps samples close together so the road looks smooth', () => {
    const path = new RoadPath(loop, 4);

    for (let i = 1; i < path.pointCount; i++) {
      expect(Math.hypot(path.x(i) - path.x(i - 1), path.z(i) - path.z(i - 1))).toBeLessThanOrEqual(5);
    }
    expect(path.distances[path.pointCount - 1]).toBeLessThan(path.lengthMeters);
  });

  it('finds the nearest centreline sample', () => {
    const path = new RoadPath(straight);
    const index = path.nearestSampleIndex(20, 30);

    for (let i = 0; i < path.pointCount; i++) {
      expect(Math.hypot(path.x(i) - 20, path.z(i) - 30)).toBeGreaterThanOrEqual(
        Math.hypot(path.x(index) - 20, path.z(index) - 30),
      );
    }
    expect(Math.abs(path.x(index) - 20)).toBeLessThan(3);
  });

  it('measures signed distances along an open road', () => {
    const path = new RoadPath(straight);
    const west = path.nearestSampleIndex(-100, 0);
    const east = path.nearestSampleIndex(100, 0);

    expect(path.distanceAlong(west, east)).toBeCloseTo(path.distances[east]! - path.distances[west]!, 9);
    expect(path.distanceAlong(west, east)).toBeGreaterThan(190);
    expect(path.distanceAlong(east, west)).toBeLessThan(-190);
  });

  it('goes the shorter way round a closed road', () => {
    const path = new RoadPath(loop);
    const start = path.nearestSampleIndex(-100, -100);
    const oneSideOn = path.nearestSampleIndex(100, -100);
    const lastSide = path.nearestSampleIndex(-100, 100);

    // Forward along the first side; backward across the join to the last corner.
    expect(path.distanceAlong(start, oneSideOn)).toBeGreaterThan(150);
    expect(path.distanceAlong(start, lastSide)).toBeLessThan(-150);
    expect(Math.abs(path.distanceAlong(start, lastSide))).toBeLessThan(path.lengthMeters / 2);
  });

  it('steps between samples, wrapping on a loop and stopping at the ends of an open road', () => {
    const open = new RoadPath(straight);
    const closed = new RoadPath(loop);

    expect(open.stepIndex(0, -1)).toBe(0);
    expect(open.stepIndex(open.pointCount - 1, 3)).toBe(open.pointCount - 1);
    expect(open.stepIndex(5, 2)).toBe(7);
    expect(closed.stepIndex(0, -1)).toBe(closed.pointCount - 1);
    expect(closed.stepIndex(closed.pointCount - 1, 2)).toBe(1);
  });
});

