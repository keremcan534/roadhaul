import { Box3, Color, Vector3, type BufferAttribute, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../../../../src/core/random/SeededRandom';
import type { BuildingObstacle } from '../../../../src/domain/world/DrivingWorld';
import {
  flatRoofGeometry,
  gableRoofGeometry,
  hipRoofGeometry,
  plinthGeometry,
  roofStyleOf,
  rooftopGeometry,
} from '../../../../src/presentation/world/buildingParts';

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
