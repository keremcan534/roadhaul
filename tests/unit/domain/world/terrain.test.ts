import { describe, expect, it } from 'vitest';
import { FLAT_TERRAIN, gradeAt, TerrainGrid } from '../../../../src/domain/world/terrain';

describe('the terrain', () => {
  it('is flat at 0 everywhere on a map without hills, and has no grade', () => {
    expect(FLAT_TERRAIN.flat).toBe(true);
    expect(FLAT_TERRAIN.heightAt(123, -456)).toBe(0);
    expect(gradeAt(FLAT_TERRAIN, 1, 2, 0.5)).toBe(0);
  });

  it('keeps heights on a grid, exact at its vertices and linear between them', () => {
    const plane = new TerrainGrid(100, 10, (x, z) => 0.05 * x + 0.02 * z + 3);

    expect(plane.columns).toBe(21);
    expect(plane.heightAt(-100, -100)).toBeCloseTo(3 - 5 - 2, 5);
    expect(plane.heightAt(30, 40)).toBeCloseTo(3 + 1.5 + 0.8, 5);
    // A plane is linear: bilinear sampling returns it between vertices too.
    expect(plane.heightAt(33.3, -47.7)).toBeCloseTo(3 + 0.05 * 33.3 - 0.02 * 47.7, 4);
    // Past the edge, the edge's height.
    expect(plane.heightAt(500, 0)).toBeCloseTo(plane.heightAt(100, 0), 5);
  });

  it('gives the rise per meter along a heading: uphill positive, across the slope none', () => {
    const plane = new TerrainGrid(100, 10, (x) => 0.08 * x);

    expect(gradeAt(plane, 0, 0, Math.PI / 2)).toBeCloseTo(0.08, 5); // Along +x.
    expect(gradeAt(plane, 0, 0, -Math.PI / 2)).toBeCloseTo(-0.08, 5);
    expect(gradeAt(plane, 0, 0, 0)).toBeCloseTo(0, 5); // Along +z, across the slope.
  });

  it('refuses a grid without a size', () => {
    expect(() => new TerrainGrid(0, 10)).toThrow(RangeError);
    expect(() => new TerrainGrid(100, 0)).toThrow(RangeError);
  });
});
