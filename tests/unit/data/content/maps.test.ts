import { describe, expect, it } from 'vitest';
import { MAPS } from '../../../../src/data/content/maps';
import { VEHICLES } from '../../../../src/data/content/vehicles';
import { rectangleContains, rectangleCorners } from '../../../../src/data/definitions/MapDefinition';
import { DrivingWorld } from '../../../../src/domain/world/DrivingWorld';
import { ASPHALT } from '../../../../src/domain/world/Surface';

/** Checks the shipped maps with the real road geometry: things a field-by-field validator cannot see. */
describe.each(MAPS)('map $id', (map) => {
  const world = new DrivingWorld(map);
  const onRoad = (x: number, z: number): boolean => world.roads.some((road) => road.contains(x, z));

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

  describe.each(map.depots)('depot $id', (depot) => {
    it('opens onto the road along one whole side of its yard', () => {
      const corners = rectangleCorners(depot.yard);
      // Paved meters along each edge of the yard.
      const pavedEdges = corners.map(([ax, az], index) => {
        const [bx, bz] = corners[(index + 1) % corners.length]!;
        const length = Math.hypot(bx - ax, bz - az);
        let paved = 0;
        for (let along = 0.25; along < length; along += 0.5) {
          paved += onRoad(ax + ((bx - ax) * along) / length, az + ((bz - az) * along) / length) ? 0.5 : 0;
        }
        return paved;
      });

      expect(Math.max(...pavedEdges)).toBeGreaterThanOrEqual(depot.yard.lengthMeters - 1);
    });

    it('sets the bay back from the road, where a parked truck is out of the way', () => {
      for (const [x, z] of rectangleCorners(depot.bay)) {
        for (const road of world.roads) {
          expect(road.distanceTo(x, z)).toBeGreaterThan(road.widthMeters / 2 + 2);
        }
      }
    });

    it('keeps buildings and trees out of the yard', () => {
      // Buildings may stand right at its edge, like a depot office; trees keep their distance.
      for (const building of world.buildings) {
        for (let x = building.minX; x <= building.maxX; x += 0.5) {
          for (let z = building.minZ; z <= building.maxZ; z += 0.5) {
            expect(rectangleContains(depot.yard, x, z, 0.5)).toBe(false);
          }
        }
      }
      for (const tree of world.trees) {
        expect(rectangleContains(depot.yard, tree.x, tree.z, 5)).toBe(false);
      }
    });

    it('has a bay every truck fits in with room to spare', () => {
      for (const vehicle of VEHICLES) {
        expect(depot.bay.lengthMeters, vehicle.id).toBeGreaterThanOrEqual(vehicle.body.lengthMeters + 4);
        expect(depot.bay.widthMeters, vehicle.id).toBeGreaterThanOrEqual(vehicle.body.widthMeters + 1.5);
      }
    });
  });
});
