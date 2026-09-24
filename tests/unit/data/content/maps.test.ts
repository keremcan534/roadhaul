import { describe, expect, it } from 'vitest';
import { MAPS } from '../../../../src/data/content/maps';
import { VEHICLES } from '../../../../src/data/content/vehicles';
import {
  rectangleContains,
  rectangleCorners,
  ROAD_KINDS,
  type RectangleDefinition,
} from '../../../../src/data/definitions/MapDefinition';
import { DrivingWorld } from '../../../../src/domain/world/DrivingWorld';
import { createRouteGuidance } from '../../../../src/domain/world/roadRoute';
import { ASPHALT } from '../../../../src/domain/world/Surface';

/** Checks the shipped maps with the real road geometry: things a field-by-field validator cannot see. */
describe.each(MAPS)('map $id', (map) => {
  const world = new DrivingWorld(map);
  const onRoad = (x: number, z: number): boolean => world.roads.some((road) => road.contains(x, z));
  /** Meters of road along the rectangle's most paved edge. */
  const pavedAlongLongestEdge = (rectangle: RectangleDefinition): number => {
    const corners = rectangleCorners(rectangle);
    const pavedEdges = corners.map(([ax, az], index) => {
      const [bx, bz] = corners[(index + 1) % corners.length]!;
      const length = Math.hypot(bx - ax, bz - az);
      let paved = 0;
      for (let along = 0.25; along < length; along += 0.5) {
        paved += onRoad(ax + ((bx - ax) * along) / length, az + ((bz - az) * along) / length) ? 0.5 : 0;
      }
      return paved;
    });
    return Math.max(...pavedEdges);
  };

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

  it('joins all its roads into one network', () => {
    expect(world.network.componentCount).toBe(1);
  });

  it('keeps its cities a few minutes\' drive apart: 2.5 to 5 km from depot to depot by road', () => {
    const route = createRouteGuidance();
    for (const from of map.depots) {
      for (const to of map.depots.filter((depot) => depot !== from)) {
        world.network.guide(from.bay.x, from.bay.z, to.bay.x, to.bay.z, route);
        expect(route.distanceMeters, `${from.id} to ${to.id}`).toBeGreaterThan(2500);
        expect(route.distanceMeters, `${from.id} to ${to.id}`).toBeLessThan(5000);
      }
    }
  });

  it('names each city with a depot on the roads into it, beside the road and facing the traffic coming in', () => {
    const signedCities = new Set(world.citySigns.map((sign) => sign.cityId));
    for (const depot of map.depots) {
      expect(signedCities, depot.cityId).toContain(depot.cityId);
    }
    for (const sign of world.citySigns) {
      expect(world.surfaceAt(sign.x, sign.z)).not.toBe(ASPHALT);
      const edges = world.roads.map((road) => road.distanceTo(sign.x, sign.z) - road.widthMeters / 2);
      expect(Math.min(...edges)).toBeGreaterThan(4.4);
      expect(Math.min(...edges)).toBeLessThan(4.9);
      // A board on a straight stretch, clear of junctions, faces straight along the road.
      const road = world.roads[edges.indexOf(Math.min(...edges))]!;
      const sample = road.nearestSampleIndex(sign.x, sign.z);
      const next = road.stepIndex(sample, 1);
      const alongX = road.x(next) - road.x(sample);
      const alongZ = road.z(next) - road.z(sample);
      const facing = (Math.sin(sign.heading) * alongX + Math.cos(sign.heading) * alongZ) / Math.hypot(alongX, alongZ);
      expect(Math.abs(facing)).toBeGreaterThan(0.98);
      for (const junction of world.network.junctions) {
        expect(Math.hypot(sign.x - junction.x, sign.z - junction.z)).toBeGreaterThan(40);
      }
    }
  });

  it('keeps its fields off the roads, yards, lots and buildings, and apart', () => {
    /** Points round a rectangle's edge, every 2 m. */
    const rim = (rectangle: RectangleDefinition): [number, number][] => {
      const corners = rectangleCorners(rectangle);
      return corners.flatMap(([ax, az], index) => {
        const [bx, bz] = corners[(index + 1) % corners.length]!;
        const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 2);
        return Array.from({ length: steps }, (_, step): [number, number] => [
          ax + ((bx - ax) * step) / steps,
          az + ((bz - az) * step) / steps,
        ]);
      });
    };
    /** How far (x, z) lies from the rectangle: 0 inside it. */
    const distanceToArea = (area: RectangleDefinition, x: number, z: number): number => {
      const heading = (area.headingDegrees * Math.PI) / 180;
      const along = (x - area.x) * Math.sin(heading) + (z - area.z) * Math.cos(heading);
      const across = (x - area.x) * Math.cos(heading) - (z - area.z) * Math.sin(heading);
      return Math.hypot(
        Math.max(0, Math.abs(along) - area.lengthMeters / 2),
        Math.max(0, Math.abs(across) - area.widthMeters / 2),
      );
    };
    for (const field of world.fields) {
      const name = `${field.crop} field at ${Math.round(field.area.x)}, ${Math.round(field.area.z)}`;
      // The road's centreline samples lie 4 m apart: between two of them it comes at most a few centimetres closer.
      let roadClearance = Infinity;
      for (const road of world.roads) {
        for (let i = 0; i < road.pointCount; i++) {
          roadClearance = Math.min(roadClearance, distanceToArea(field.area, road.x(i), road.z(i)) - road.widthMeters / 2);
        }
      }
      expect(roadClearance, name).toBeGreaterThan(8);
      const edge = rim(field.area);
      let buildingClearance = Infinity;
      for (const [x, z] of edge) {
        for (const building of world.buildings) {
          const dx = x - Math.max(building.minX, Math.min(x, building.maxX));
          const dz = z - Math.max(building.minZ, Math.min(z, building.maxZ));
          buildingClearance = Math.min(buildingClearance, Math.hypot(dx, dz));
        }
      }
      expect(buildingClearance, name).toBeGreaterThan(5);
      const others = world.fields.filter((candidate) => candidate !== field);
      expect(edge.some(([x, z]) => others.some((other) => rectangleContains(other.area, x, z))), name).toBe(false);
      for (const area of [...map.depots.map((depot) => depot.yard), ...map.restAreas.map((restArea) => restArea.lot)]) {
        expect(edge.some(([x, z]) => rectangleContains(area, x, z, 5)), name).toBe(false);
      }
    }
  });

  it('stands its wind turbines well clear of the roads, buildings and each other', () => {
    for (const turbine of map.windTurbines) {
      for (const road of world.roads) {
        expect(road.distanceTo(turbine.x, turbine.z) - road.widthMeters / 2).toBeGreaterThan(60);
      }
      for (const building of world.buildings) {
        expect(Math.hypot(turbine.x - (building.minX + building.maxX) / 2, turbine.z - (building.minZ + building.maxZ) / 2)).toBeGreaterThan(80);
      }
      for (const other of map.windTurbines.filter((candidate) => candidate !== turbine)) {
        expect(Math.hypot(turbine.x - other.x, turbine.z - other.z)).toBeGreaterThan(150);
      }
      for (const field of world.fields) {
        expect(rectangleContains(field.area, turbine.x, turbine.z, 10)).toBe(false);
      }
    }
  });

  it('keeps its roads, buildings, yards and lots on land, and ends the harbour road at the quay', () => {
    if (world.sea === null) {
      return;
    }
    for (const road of world.roads) {
      for (let i = 0; i < road.pointCount; i++) {
        expect(world.isWater(road.x(i), road.z(i), road.widthMeters / 2 + 10), road.id).toBe(false);
      }
    }
    for (const building of map.buildings) {
      expect(world.isWater(building.x - building.widthMeters / 2, building.z, 5)).toBe(false);
    }
    for (const rectangle of [...map.depots.map((depot) => depot.yard), ...map.restAreas.map((area) => area.lot)]) {
      for (const [x, z] of rectangleCorners(rectangle)) {
        expect(world.isWater(x, z, 10)).toBe(false);
      }
    }
    // Some road reaches the quay: trucks can drive to the harbour.
    expect(world.turningCircles.some((circle) => world.isOnQuay(circle.x, circle.z, circle.radiusMeters))).toBe(true);
    // The boats lie off the quay or the shore; the cranes over the water's edge.
    expect(world.sea.boats.length).toBeGreaterThan(0);
    expect(world.sea.cranes.every((crane) => world.isOnQuay(crane.x, crane.z))).toBe(true);
  });

  it('has every kind of road (spec §20)', () => {
    expect(new Set(map.roads.map((road) => road.kind))).toEqual(new Set(ROAD_KINDS));
  });

  describe.each(map.restAreas)('rest area $id', (restArea) => {
    it('opens onto a road along one long side of its lot', () => {
      expect(pavedAlongLongestEdge(restArea.lot)).toBeGreaterThanOrEqual(restArea.lot.lengthMeters - 1);
    });

    it('has room for the biggest truck to pull in and out', () => {
      const longest = Math.max(...VEHICLES.map((vehicle) => vehicle.body.lengthMeters));
      expect(restArea.lot.lengthMeters).toBeGreaterThanOrEqual(longest * 5);
      expect(restArea.lot.widthMeters).toBeGreaterThanOrEqual(longest * 2.5);
    });

    it('keeps buildings and trees off the lot', () => {
      for (const building of world.buildings) {
        for (const [x, z] of [
          [building.minX, building.minZ],
          [building.maxX, building.maxZ],
          [(building.minX + building.maxX) / 2, (building.minZ + building.maxZ) / 2],
        ] as const) {
          expect(rectangleContains(restArea.lot, x, z, 0.5)).toBe(false);
        }
      }
      for (const tree of world.trees) {
        expect(rectangleContains(restArea.lot, tree.x, tree.z, 5)).toBe(false);
      }
    });

    it('is paved', () => {
      expect(world.surfaceAt(restArea.lot.x, restArea.lot.z)).toBe(ASPHALT);
    });
  });

  describe.each(map.depots)('depot $id', (depot) => {
    it('opens onto the road along one whole side of its yard', () => {
      expect(pavedAlongLongestEdge(depot.yard)).toBeGreaterThanOrEqual(depot.yard.lengthMeters - 1);
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
