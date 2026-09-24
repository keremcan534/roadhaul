import { describe, expect, it } from 'vitest';
import type { RoadDefinition } from '../../../../src/data/definitions/MapDefinition';
import { createRoadPoint, RoadPath } from '../../../../src/domain/world/RoadPath';

const straight: RoadDefinition = {
  id: 'straight',
  kind: 'street',
  widthMeters: 10,
  closed: false,
  controlPoints: [
    [-150, 0],
    [150, 0],
  ],
};

const loop: RoadDefinition = {
  id: 'loop',
  kind: 'street',
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

  it('measures the distance to each straight piece of the centreline, the last one of a loop joining up', () => {
    const path = new RoadPath(straight);
    const closed = new RoadPath(loop);
    const last = closed.segmentCount - 1;
    const midX = (closed.x(last) + closed.x(0)) / 2;
    const midZ = (closed.z(last) + closed.z(0)) / 2;

    // The first piece runs from x = -150 a few meters on: beside it, and past its end.
    expect(path.segmentDistance(0, -149, 3)).toBeCloseTo(3, 9);
    expect(path.segmentDistance(0, -150, -4)).toBeCloseTo(4, 9);
    expect(path.segmentDistance(0, 0, 0)).toBeGreaterThan(100);
    expect(closed.segmentDistance(last, midX, midZ)).toBeCloseTo(0, 9);
    // The closest piece is the distance to the road.
    let closest = Infinity;
    for (let segment = 0; segment < closed.segmentCount; segment++) {
      closest = Math.min(closest, closed.segmentDistance(segment, 37, -93));
    }
    expect(closest).toBe(closed.distanceTo(37, -93));
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

  it('finds the point a distance along an open road, and its direction, stopping at the ends', () => {
    const path = new RoadPath(straight);
    const point = createRoadPoint();

    expect(path.pointAt(0, point)).toMatchObject({ x: -150, z: 0, directionX: 1, directionZ: 0 });
    expect(path.pointAt(123.4, point).x).toBeCloseTo(-26.6, 9);
    expect(path.pointAt(-10, point).x).toBe(-150);
    expect(path.pointAt(path.lengthMeters + 10, point)).toMatchObject({ x: 150, z: 0, directionX: 1 });
  });

  it('goes round a closed road, past its seam', () => {
    const path = new RoadPath(loop);
    const point = createRoadPoint();

    for (const distance of [0, 17, path.lengthMeters / 3, path.lengthMeters - 1]) {
      path.pointAt(distance, point);
      // On the centreline, facing along it: a step ahead is still on the centreline.
      expect(path.distanceTo(point.x, point.z), `${distance} m`).toBeLessThan(0.01);
      expect(Math.hypot(point.directionX, point.directionZ)).toBeCloseTo(1, 9);
      expect(path.distanceTo(point.x + point.directionX * 2, point.z + point.directionZ * 2)).toBeLessThan(0.1);
    }
    const start = { ...path.pointAt(0, point) };
    expect(path.pointAt(path.lengthMeters, point)).toEqual(start);
    expect(path.pointAt(-path.lengthMeters, point)).toEqual(start);
  });
});

