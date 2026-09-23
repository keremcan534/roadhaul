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
});
