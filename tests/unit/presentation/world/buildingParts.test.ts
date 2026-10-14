import { Box3, Color, Vector3, type BufferAttribute, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../../../../src/core/random/SeededRandom';
import type { BuildingObstacle } from '../../../../src/domain/world/DrivingWorld';
import {
  chimneyStackGeometry,
  flatRoofGeometry,
  formGeometry,
  frontDoorGeometry,
  gableRoofGeometry,
  hipRoofGeometry,
  loadingDoorsGeometry,
  plinthGeometry,
  roofStyleOf,
  rooftopGeometry,
  shopfrontGeometry,
} from '../../../../src/presentation/world/buildingParts';
import { BUILDING_SIDES, type BuildingSide } from '../../../../src/domain/world/DrivingWorld';

const house: BuildingObstacle = { minX: 10, maxX: 22, minZ: -30, maxZ: -22, heightMeters: 7 };
const warehouse: BuildingObstacle = { minX: -40, maxX: -10, minZ: 5, maxZ: 29, heightMeters: 11 };

function bounds(geometry: BufferGeometry): Box3 {
  return new Box3().setFromBufferAttribute(geometry.getAttribute('position') as BufferAttribute);
}

/** Every triangle's normal (from its winding) points away from `centre`. */
function facesOutward(geometry: BufferGeometry, centre: Vector3): boolean {
  const position = geometry.getAttribute('position');
  const [a, b, c] = [new Vector3(), new Vector3(), new Vector3()];
  for (let i = 0; i < position.count; i += 3) {
    a.fromBufferAttribute(position, i);
    b.fromBufferAttribute(position, i + 1);
    c.fromBufferAttribute(position, i + 2);
    const normal = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
    const middle = new Vector3().add(a).add(b).add(c).divideScalar(3).sub(centre);
    if (normal.dot(middle) <= 0) {
      return false;
    }
  }
  return true;
}

describe('building parts', () => {
  it('roofs a house with a hip in clay tiles: over its walls, rising to a ridge, every slope facing out', () => {
    const roof = hipRoofGeometry(house, 2.5, new Color(0xffffff));
    const box = bounds(roof);

    // The eaves overhang the walls; the ridge stands the rise above them.
    expect(box.min.x).toBeLessThan(house.minX);
    expect(box.max.z).toBeGreaterThan(house.maxZ);
    expect(box.min.y).toBeCloseTo(house.heightMeters, 6);
    expect(box.max.y).toBeCloseTo(house.heightMeters + 2.5, 6);
    // Four slopes: two along the ridge (two triangles each), two hip ends.
    expect(roof.getAttribute('position').count).toBe(6 * 3);
    expect(facesOutward(roof, new Vector3(16, house.heightMeters, -26))).toBe(true);
    // Tiles run along the eaves and up the slope, from 0 at the eaves.
    const uv = roof.getAttribute('uv');
    const vs = Array.from({ length: uv.count }, (_, i) => uv.getY(i));
    expect(Math.min(...vs)).toBeCloseTo(0, 6);
    expect(Math.max(...vs)).toBeGreaterThan(1);
  });

  it('roofs a large shed with a shallow metal gable whose ends are walls', () => {
    const roof = gableRoofGeometry(warehouse, 2, new Color(0xeeddcc));
    const box = bounds(roof);

    expect(box.max.y).toBeCloseTo(warehouse.heightMeters + 2, 6);
    expect(facesOutward(roof, new Vector3(-25, warehouse.heightMeters, 17))).toBe(true);
    expect(roof.getAttribute('uv')).toBeUndefined();
    expect(roof.getAttribute('color')).toBeDefined();
  });

  it('sets a flat roof behind a parapet, stone at every foot, and plant on the roof, all on the building', () => {
    const random = new SeededRandom(5);
    for (const building of [house, warehouse]) {
      const parts = [...flatRoofGeometry(building), ...plinthGeometry(building), ...rooftopGeometry(building, random, 0.5)];
      for (const part of parts) {
        // One layout for the merged details mesh: flat, coloured, lit.
        expect(part.index).toBeNull();
        expect(Object.keys(part.attributes).sort()).toEqual(['color', 'normal', 'position']);
        const box = bounds(part);
        expect(box.min.x).toBeGreaterThan(building.minX - 1);
        expect(box.max.x).toBeLessThan(building.maxX + 1);
        expect(box.min.z).toBeGreaterThan(building.minZ - 1);
        expect(box.max.z).toBeLessThan(building.maxZ + 1);
      }
      const onTop = rooftopGeometry(building, new SeededRandom(9), 0.5);
      expect(onTop.length).toBeGreaterThan(2);
      for (const part of onTop) {
        expect(bounds(part).min.y).toBeGreaterThanOrEqual(building.heightMeters - 0.01);
      }
    }
  });

  it('roofs small buildings mostly with tiled hips and large ones flat or with a gable, the same every time', () => {
    const styles = (building: BuildingObstacle): string[] => {
      const random = new SeededRandom(311);
      return Array.from({ length: 200 }, () => roofStyleOf(building, random));
    };
    const small = styles(house);
    const large = styles(warehouse);

    expect(small.filter((style) => style === 'hip').length).toBeGreaterThan(100);
    expect(small).not.toContain('gable');
    expect(large).not.toContain('hip');
    expect(large).toContain('gable');
    expect(styles(house)).toEqual(small);
  });
});

describe('formGeometry', () => {
  const box = (form: BuildingObstacle['form'], heightMeters: number): BuildingObstacle => ({
    minX: 100,
    maxX: 110,
    minZ: -5,
    maxZ: 5,
    heightMeters,
    ...(form === undefined ? {} : { form }),
  });

  it('draws nothing for a block, which keeps its walls and roof', () => {
    expect(formGeometry(box(undefined, 8))).toEqual([]);
  });

  it('stands a silo, a chimney and a headframe in their boxes, as tall as they are, in colour', () => {
    for (const form of ['silo', 'chimney', 'headframe'] as const) {
      const shape = box(form, 30);
      const parts = formGeometry(shape);
      expect(parts.length, form).toBeGreaterThan(3);
      const all = new Box3();
      for (const part of parts) {
        // The details' merged mesh: positions, normals and colours, no uv.
        expect(part.getAttribute('color'), form).toBeDefined();
        expect(part.getAttribute('uv'), form).toBeUndefined();
        all.union(bounds(part));
      }
      expect(all.min.y, form).toBeGreaterThanOrEqual(-1e-6);
      expect(all.max.y, form).toBeGreaterThan(shape.heightMeters - 1);
      expect(all.max.y, form).toBeLessThan(shape.heightMeters + 1);
      // Within its box, but for the headframe's struts raking back to the ground and the base a little proud.
      const reach = form === 'headframe' ? 6 : 1;
      expect(all.min.x, form).toBeGreaterThan(shape.minX - reach);
      expect(all.max.x, form).toBeLessThan(shape.maxX + 1);
      expect(all.min.z, form).toBeGreaterThan(shape.minZ - 1);
      expect(all.max.z, form).toBeLessThan(shape.maxZ + 1);
    }
  });
});

describe('the fronts: shops, loading doors and doors', () => {
  const block: BuildingObstacle = { minX: 100, maxX: 120, minZ: -15, maxZ: 15, heightMeters: 10 };

  /** How far `parts` stand out past `side`'s wall (negative: behind it), and how far along it they reach. */
  function placed(parts: readonly BufferGeometry[], side: BuildingSide): { out: [number, number]; along: [number, number] } {
    const all = new Box3();
    for (const part of parts) all.union(bounds(part));
    const outward = (box: Box3): [number, number] => {
      switch (side) {
        case '-x':
          return [block.minX - box.max.x, block.minX - box.min.x];
        case '+x':
          return [box.min.x - block.maxX, box.max.x - block.maxX];
        case '-z':
          return [block.minZ - box.max.z, block.minZ - box.min.z];
        case '+z':
          return [box.min.z - block.maxZ, box.max.z - block.maxZ];
      }
    };
    const along: [number, number] = side === '-x' || side === '+x' ? [all.min.z, all.max.z] : [all.min.x, all.max.x];
    return { out: outward(all), along };
  }

  it('puts every front against the side it faces, outside the walls, and within the wall\'s length', () => {
    for (const side of BUILDING_SIDES) {
      const wall = side === '-x' || side === '+x' ? [block.minZ, block.maxZ] : [block.minX, block.maxX];
      for (const [name, parts] of [
        ['shops', shopfrontGeometry(block, side, new SeededRandom(1))],
        ['loading doors', loadingDoorsGeometry(block, side)],
        ['door', frontDoorGeometry(block, side, new SeededRandom(2))],
      ] as const) {
        expect(parts.length, `${name} ${side}`).toBeGreaterThan(0);
        const { out, along } = placed(parts, side);
        // From the wall's face out (a little play for the awnings' tilt), no deeper than a canopy.
        expect(out[0], `${name} ${side}`).toBeGreaterThan(-0.01);
        expect(out[1], `${name} ${side}`).toBeLessThan(2.2);
        expect(along[0], `${name} ${side}`).toBeGreaterThan(wall[0]! - 1.2);
        expect(along[1], `${name} ${side}`).toBeLessThan(wall[1]! + 1.2);
        for (const part of parts) {
          expect(part.getAttribute('color')).toBeDefined();
          expect(part.getAttribute('uv')).toBeUndefined();
        }
      }
    }
  });

  it('lines a long front with several shops, and keeps them on the ground floor', () => {
    const long: BuildingObstacle = { minX: 0, maxX: 36, minZ: 0, maxZ: 12, heightMeters: 9 };
    const parts = shopfrontGeometry(long, '+z', new SeededRandom(3));
    const all = new Box3();
    for (const part of parts) all.union(bounds(part));
    expect(all.max.y).toBeLessThan(3.5);
    // Four shops of about 9 m: four fascias at the same height.
    const fascias = parts.filter((part) => Math.abs(bounds(part).min.y - 2.7) < 1e-6);
    expect(fascias).toHaveLength(4);
  });

  it('gives a building too low for a loading door none', () => {
    expect(loadingDoorsGeometry({ ...block, heightMeters: 3.5 }, '+x')).toEqual([]);
  });

  it('stands a chimney over the roof\'s ridge, through the roof', () => {
    const rise = 2.5;
    const [stack, cap] = chimneyStackGeometry(block, rise, new SeededRandom(4));
    const shaft = bounds(stack!);
    expect(shaft.min.y).toBeLessThan(block.heightMeters);
    expect(bounds(cap!).max.y).toBeGreaterThan(block.heightMeters + rise);
    // On the ridge: across the narrower way, in the middle.
    expect((shaft.min.x + shaft.max.x) / 2).toBeCloseTo(110, 6);
  });
});
