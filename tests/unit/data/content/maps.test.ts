import { describe, expect, it } from 'vitest';
import { MAPS } from '../../../../src/data/content/maps';
import { DrivingWorld } from '../../../../src/domain/world/DrivingWorld';
import { ASPHALT } from '../../../../src/domain/world/Surface';

/** Checks the shipped maps with the real road geometry: things a field-by-field validator cannot see. */
describe.each(MAPS)('map $id', (map) => {
  const world = new DrivingWorld(map);

  it('starts the truck on the road, facing along it', () => {
    expect(world.surfaceAt(world.spawn.x, world.spawn.z)).toBe(ASPHALT);
    for (const ahead of [10, 20, 30]) {
      const x = world.spawn.x + Math.sin(world.spawn.heading) * ahead;
      const z = world.spawn.z + Math.cos(world.spawn.heading) * ahead;
      expect(world.surfaceAt(x, z), `${ahead} m ahead of the spawn`).toBe(ASPHALT);
    }
  });

  it('keeps buildings off the road', () => {
    for (const building of world.buildings) {
      for (const road of world.roads) {
        let closest = Infinity;
        for (let i = 0; i < road.pointCount; i++) {
          const dx = road.x(i) - Math.max(building.minX, Math.min(road.x(i), building.maxX));
          const dz = road.z(i) - Math.max(building.minZ, Math.min(road.z(i), building.maxZ));
          closest = Math.min(closest, Math.hypot(dx, dz));
        }
        expect(closest).toBeGreaterThan(road.widthMeters / 2 + 5);
      }
    }
  });

  it('has a road long enough for a proper test drive', () => {
    const total = world.roads.reduce((sum, road) => sum + road.lengthMeters, 0);

    expect(total).toBeGreaterThan(2000);
    expect(total).toBeLessThan(4000);
  });
});
