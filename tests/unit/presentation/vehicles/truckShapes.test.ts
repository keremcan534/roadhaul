import { Box3, Vector3, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import {
  archedSkirt,
  archLiner,
  extrudeAcross,
  flatPolygon,
  ledge,
  loft,
  roundedOutline,
  tyreGeometry,
} from '../../../../src/presentation/vehicles/truckShapes';

/** Every triangle of `geometry`: its corners, the normal its winding gives, and its vertices' stored normal. */
function triangles(geometry: BufferGeometry): { centre: Vector3; wound: Vector3; stored: Vector3 }[] {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const index = geometry.getIndex()!;
  const corner = (i: number): Vector3 => new Vector3().fromBufferAttribute(position, index.getX(i));
  const found: { centre: Vector3; wound: Vector3; stored: Vector3 }[] = [];
  for (let i = 0; i < index.count; i += 3) {
    const [a, b, c] = [corner(i), corner(i + 1), corner(i + 2)];
    const wound = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
    if (wound.lengthSq() < 1e-14) {
      continue;
    }
    const stored = new Vector3();
    for (let k = 0; k < 3; k++) {
      stored.add(new Vector3().fromBufferAttribute(normal, index.getX(i + k)));
    }
    found.push({ centre: a.add(b).add(c).divideScalar(3), wound: wound.normalize(), stored: stored.normalize() });
  }
  return found;
}

/** Every face is wound the way its normals point. */
function expectConsistent(geometry: BufferGeometry): void {
  for (const { wound, stored } of triangles(geometry)) {
    expect(wound.dot(stored)).toBeGreaterThan(0.5);
  }
}

describe('truckShapes', () => {
  it('outlines a rectangle with rounded corners, the same number of points at any size', () => {
    const big = roundedOutline(1.2, -1, 2, 0.12, 0.05);
    const small = roundedOutline(1.1, -0.9, 1.9, 0.02, 0.01);

    expect(big.length).toBe(small.length);
    for (const [x, z] of big) {
      expect(Math.abs(x)).toBeLessThanOrEqual(1.2 + 1e-9);
      expect(z).toBeGreaterThanOrEqual(-1 - 1e-9);
      expect(z).toBeLessThanOrEqual(2 + 1e-9);
    }
    // The front corners are cut round: nothing at the very corner.
    expect(big.some(([x, z]) => x > 1.19 && z > 1.99)).toBe(false);
  });

  it('lofts walls that face out, round the corners and up the roof edge, under a lid that faces up', () => {
    const rings = [
      { outline: roundedOutline(1.2, -1, 2, 0.12, 0.05), y: 0 },
      { outline: roundedOutline(1.2, -1, 2, 0.12, 0.05), y: 1 },
      { outline: roundedOutline(1.14, -0.94, 1.94, 0.06, 0.02), y: 1.08 },
    ];
    const shell = loft(rings, { top: true });

    expectConsistent(shell);
    for (const { centre, wound } of triangles(shell)) {
      const outward = new Vector3(centre.x, 0, centre.z - 0.5);
      if (centre.y > 1.079) {
        expect(wound.y).toBeGreaterThan(0.99);
      } else {
        expect(wound.dot(outward)).toBeGreaterThan(0);
      }
    }
    expect(new Box3().setFromBufferAttribute(shell.getAttribute('position') as never).max.y).toBeCloseTo(1.08, 6);
  });

  it('lays ledges and flat polygons facing the way asked', () => {
    const outer = roundedOutline(1.2, -1, 2, 0.12, 0.05);
    const inner = roundedOutline(1.17, -0.95, 1.95, 0.1, 0.03);

    for (const { wound } of triangles(ledge(outer, inner, 1))) {
      expect(wound.y).toBeGreaterThan(0.99);
    }
    for (const { wound } of triangles(flatPolygon(outer, 0, -1))) {
      expect(wound.y).toBeLessThan(-0.99);
    }
  });

  it('extrudes a side profile across the truck, every face looking out of it', () => {
    // A fairing: flat on the roof, rising in a curve to the box's height at the back.
    const profile: [number, number][] = [
      [0, 0],
      [0, 0.5],
      ...Array.from({ length: 6 }, (_, i): [number, number] => {
        const angle = ((i + 1) / 7) * (Math.PI / 2);
        return [Math.sin(angle) * 1.5, 0.5 - (1 - Math.cos(angle)) * 0.5];
      }),
      [1.5, 0],
    ];
    const fairing = extrudeAcross(profile, 1.1);

    expectConsistent(fairing);
    const middle = new Vector3(0, 0.2, 0.5);
    for (const { centre, wound } of triangles(fairing)) {
      expect(wound.dot(new Vector3().subVectors(centre, middle))).toBeGreaterThan(0);
    }
  });

  it('cuts a wheel arch out of a side skirt that faces out of either side', () => {
    for (const side of [1, -1] as const) {
      const skirt = archedSkirt(side, 1.2, 1, 5, 0.4, 0.9, 3, 0.46);

      for (const { centre, wound } of triangles(skirt)) {
        expect(wound.x * side).toBeGreaterThan(0.99);
        expect(centre.x).toBeCloseTo(side * 1.2, 6);
        // Nothing over the wheel, inside the arch.
        expect(Math.hypot(centre.z - 3, centre.y - 0.4)).toBeGreaterThan(0.46 - 0.05);
      }
      const bounds = new Box3().setFromBufferAttribute(skirt.getAttribute('position') as never);
      expect(bounds.min.z).toBeCloseTo(1, 6);
      expect(bounds.max.z).toBeCloseTo(5, 6);
      expect(bounds.max.y).toBeCloseTo(0.9, 6);
    }
  });

  it('lines a wheel arch over the wheel, facing the wheel', () => {
    const liner = archLiner(0.8, 1.25, 3, 0.42, 0.46);
    const axle = (point: Vector3): Vector3 => new Vector3(point.x, 0.42, 3);

    expectConsistent(liner);
    for (const { centre, wound } of triangles(liner)) {
      expect(centre.y).toBeGreaterThanOrEqual(0.42 - 1e-6);
      expect(wound.dot(new Vector3().subVectors(axle(centre), centre))).toBeGreaterThan(0);
    }
  });

  it('shapes a tyre round the x axis: the tread outward, rounded shoulders, the rim recessed', () => {
    const tyre = tyreGeometry(0.42, 0.36, 0.3, 0.03);
    const bounds = new Box3().setFromBufferAttribute(tyre.getAttribute('position') as never);

    expect(bounds.max.x).toBeCloseTo(0.18, 6);
    expect(bounds.min.x).toBeCloseTo(-0.18, 6);
    expect(bounds.max.y).toBeCloseTo(0.42, 2);
    expectConsistent(tyre);
    // On the tread every face looks away from the axle.
    for (const { centre, wound } of triangles(tyre)) {
      if (Math.hypot(centre.y, centre.z) > 0.415 && Math.abs(centre.x) < 0.1) {
        expect(wound.dot(new Vector3(0, centre.y, centre.z).normalize())).toBeGreaterThan(0.9);
      }
    }
  });
});
