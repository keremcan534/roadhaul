import { describe, expect, it } from 'vitest';
import { MAPS } from '../../../../src/data/content/maps';
import type { RoadDefinition } from '../../../../src/data/definitions/MapDefinition';
import { RoadPath } from '../../../../src/domain/world/RoadPath';
import { RIBBON_MAX_SPAN_METERS, RIBBON_TOLERANCE_METERS, ribbonRows } from '../../../../src/presentation/world/roadRibbons';

function road(controlPoints: RoadDefinition['controlPoints'], closed = false): RoadPath {
  return new RoadPath({ id: 'test_road', kind: 'rural', widthMeters: 8, closed, controlPoints });
}

/** How far each sample of `path` lies from the ribbon through `rows` (the chord between the kept rows round it). */
function worstStray(path: RoadPath, rows: readonly number[]): number {
  let worst = 0;
  const count = path.pointCount;
  for (let k = 0; k + 1 < rows.length; k++) {
    const a = rows[k]!;
    const b = rows[k + 1]!;
    const ax = path.x(a % count);
    const az = path.z(a % count);
    const dx = path.x(b % count) - ax;
    const dz = path.z(b % count) - az;
    const lengthSquared = dx * dx + dz * dz;
    for (let row = a + 1; row < b; row++) {
      const px = path.x(row % count) - ax;
      const pz = path.z(row % count) - az;
      const t = Math.max(0, Math.min(1, (px * dx + pz * dz) / lengthSquared));
      worst = Math.max(worst, Math.hypot(px - dx * t, pz - dz * t));
    }
  }
  return worst;
}

describe('ribbonRows', () => {
  it('runs a straight road in long pieces, no longer than the span', () => {
    const straight = road([
      [0, 0],
      [0, 300],
    ]);
    const rows = ribbonRows(straight);
    expect(rows[0]).toBe(0);
    expect(rows.at(-1)).toBe(straight.pointCount - 1);
    expect(rows.length).toBeLessThan(10);
    for (let k = 0; k + 1 < rows.length; k++) {
      expect(straight.distances[rows[k + 1]!]! - straight.distances[rows[k]!]!).toBeLessThanOrEqual(RIBBON_MAX_SPAN_METERS + 1e-9);
    }
  });

  it('keeps enough of a bend for the ribbon to stay within the tolerance, and more where it is tight', () => {
    const gentle = road([
      [0, 0],
      [300, 60],
      [600, 0],
    ]);
    const tight = road([
      [0, 0],
      [60, 60],
      [120, 0],
    ]);
    for (const path of [gentle, tight]) {
      const rows = ribbonRows(path);
      expect(worstStray(path, rows)).toBeLessThanOrEqual(RIBBON_TOLERANCE_METERS + 1e-9);
      expect(rows).toEqual([...rows].sort((a, b) => a - b));
    }
    const perMeter = (path: RoadPath): number => ribbonRows(path).length / path.lengthMeters;
    expect(perMeter(tight)).toBeGreaterThan(perMeter(gentle) * 2);
  });

  it('keeps both samples round every change in what the ribbon keeps', () => {
    const straight = road([
      [0, 0],
      [0, 400],
    ]);
    // A painted line broken between 100 m and 180 m.
    const keep = (i: number): boolean => straight.distances[i]! < 100 || straight.distances[i]! > 180;
    const rows = ribbonRows(straight, RIBBON_TOLERANCE_METERS, RIBBON_MAX_SPAN_METERS, keep);
    for (let i = 0; i + 1 < straight.pointCount; i++) {
      if (keep(i) !== keep(i + 1)) {
        expect(rows).toContain(i);
        expect(rows).toContain(i + 1);
      }
    }
    // So no piece drawn (both its ends kept) runs across the break.
    for (let k = 0; k + 1 < rows.length; k++) {
      if (keep(rows[k]!) && keep(rows[k + 1]!)) {
        for (let i = rows[k]!; i <= rows[k + 1]!; i++) {
          expect(keep(i), `sample ${i}`).toBe(true);
        }
      }
    }
  });

  it('closes a loop: its last row is its first sample again', () => {
    const loop = road(
      [
        [0, 0],
        [200, 0],
        [200, 200],
        [0, 200],
      ],
      true,
    );
    const rows = ribbonRows(loop);
    expect(rows[0]).toBe(0);
    expect(rows.at(-1)).toBe(loop.pointCount);
    expect(worstStray(loop, rows)).toBeLessThanOrEqual(RIBBON_TOLERANCE_METERS + 1e-9);
  });

  it('draws the shipped region\'s roads from under a third of their samples', () => {
    const roads = MAPS[0]!.roads.map((definition) => new RoadPath(definition));
    const samples = roads.reduce((sum, path) => sum + path.pointCount, 0);
    const kept = roads.reduce((sum, path) => sum + ribbonRows(path).length, 0);
    expect(kept).toBeLessThan(samples / 3);
    for (const path of roads) {
      expect(worstStray(path, ribbonRows(path)), path.id).toBeLessThanOrEqual(RIBBON_TOLERANCE_METERS + 1e-9);
    }
  });
});
