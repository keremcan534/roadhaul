import { describe, expect, it } from 'vitest';
import { MAPS } from '../../../../src/data/content/maps';
import { rectangleContains, rectangleCorners, type RectangleDefinition } from '../../../../src/data/definitions/MapDefinition';
import { CONTAINER_METERS } from '../../../../src/domain/world/containerStacks';
import { DrivingWorld, type BuildingObstacle } from '../../../../src/domain/world/DrivingWorld';

const map = MAPS[0]!;
const world = new DrivingWorld(map);
const stacks = world.buildings.filter((box) => box.form === 'containers');

function rectangleOf(box: BuildingObstacle): RectangleDefinition {
  return {
    x: (box.minX + box.maxX) / 2,
    z: (box.minZ + box.maxZ) / 2,
    headingDegrees: 0,
    lengthMeters: box.maxZ - box.minZ,
    widthMeters: box.maxX - box.minX,
  };
}

describe('stackContainers', () => {
  it('stands a stack or two of containers round every depot\'s yard out in the open, close by it', () => {
    // A depot in a town's district has its buildings close round it: no room for containers.
    const inDistrict = (x: number, z: number): boolean =>
      (map.districts ?? []).some(({ area }) => Math.abs(x - area.x) <= area.widthMeters / 2 && Math.abs(z - area.z) <= area.lengthMeters / 2);
    for (const depot of map.depots.filter((candidate) => !inDistrict(candidate.yard.x, candidate.yard.z))) {
      const near = stacks.filter((box) => {
        const middle = rectangleOf(box);
        return Math.hypot(middle.x - depot.yard.x, middle.z - depot.yard.z) < depot.yard.lengthMeters / 2 + 30;
      });
      expect(near.length, depot.id).toBeGreaterThanOrEqual(1);
      expect(near.length, depot.id).toBeLessThanOrEqual(2);
    }
  });

  it('keeps them out of the yards and lots, off the roads, and clear of every other building', () => {
    const yards = [...map.depots.map((depot) => depot.yard), ...map.restAreas.map((area) => area.lot)];
    for (const stack of stacks) {
      const box = rectangleOf(stack);
      for (const yard of yards) {
        expect(rectangleCorners(box).some(([x, z]) => rectangleContains(yard, x, z))).toBe(false);
        expect(rectangleCorners(yard).some(([x, z]) => rectangleContains(box, x, z))).toBe(false);
      }
      for (const road of world.roads) {
        for (let i = 0; i < road.pointCount; i++) {
          const inside = rectangleContains(box, road.x(i), road.z(i), road.widthMeters / 2);
          expect(inside, road.id).toBe(false);
        }
      }
      for (const other of world.buildings) {
        if (other === stack) continue;
        const apart =
          stack.maxX <= other.minX || other.maxX <= stack.minX || stack.maxZ <= other.minZ || other.maxZ <= stack.minZ;
        expect(apart).toBe(true);
      }
    }
  });

  it('stacks two or three containers high, and the same every time from the same map', () => {
    for (const stack of stacks) {
      const tiers = stack.heightMeters / CONTAINER_METERS.height;
      expect([2, 3]).toContain(Math.round(tiers));
    }
    const again = new DrivingWorld(map).buildings.filter((box) => box.form === 'containers');
    expect(again).toEqual(stacks);
  });
});
