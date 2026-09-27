import { describe, expect, it } from 'vitest';
import type { DepotDefinition, RestAreaDefinition } from '../../../../src/data/definitions/MapDefinition';
import { isInsideBay } from '../../../../src/domain/missions/loadingBay';
import { HOME_START_ID, LEFT_START_ID, nearestDepotCity, startPlaces } from '../../../../src/domain/world/startPlaces';
import { vehicleFixture } from '../../../support/contentFixtures';

const body = vehicleFixture().body;

function depot(id: string, cityId: string, x: number, z: number, headingDegrees: number): DepotDefinition {
  return {
    id,
    cityId,
    yard: { x, z, headingDegrees, lengthMeters: 44, widthMeters: 26 },
    bay: { x, z, headingDegrees, lengthMeters: 16, widthMeters: 4.6 },
  };
}

const world = {
  spawn: { x: 10, z: -40, heading: 0 },
  depots: [depot('depot_a', 'city_a', 0, 0, 0), depot('depot_b', 'city_b', 2000, 0, 90)],
  restAreas: [
    { id: 'rest_area', lot: { x: 1500, z: 300, headingDegrees: 90, lengthMeters: 90, widthMeters: 34 } },
  ] satisfies RestAreaDefinition[],
};

describe('startPlaces', () => {
  it('starts a new company at the map’s own start, near its home city, then offers each depot and rest area', () => {
    const places = startPlaces(world, body, null);

    expect(places.map((place) => [place.id, place.kind, place.cityId])).toEqual([
      [HOME_START_ID, 'home', 'city_a'],
      ['depot_a', 'depot', 'city_a'],
      ['depot_b', 'depot', 'city_b'],
      ['rest_area', 'restArea', 'city_b'],
    ]);
    expect(places[0]).toMatchObject(world.spawn);
  });

  it('continues where the truck was left, first', () => {
    const left = { x: 1900, z: 50, heading: 7.5 };

    const places = startPlaces(world, body, left);

    expect(places[0]).toEqual({ id: LEFT_START_ID, kind: 'left', cityId: 'city_b', ...left });
    expect(places.slice(1).map((place) => place.id)).toEqual(['depot_a', 'depot_b', 'rest_area']);
  });

  it('parks the truck squarely in each depot’s bay and each rest area’s lot, facing along it', () => {
    const [, first, second, rest] = startPlaces(world, body, null);

    expect(isInsideBay(world.depots[0]!.bay, first!, body)).toBe(true);
    expect(isInsideBay(world.depots[1]!.bay, second!, body)).toBe(true);
    expect(isInsideBay(world.restAreas[0]!.lot, rest!, body)).toBe(true);
    expect(first!.heading).toBeCloseTo(0, 12);
    expect(second!.heading).toBeCloseTo(Math.PI / 2, 12);
  });

  it('names the city of the nearest depot, and none without depots', () => {
    expect(nearestDepotCity(world.depots, 900, 0)).toBe('city_a');
    expect(nearestDepotCity(world.depots, 1100, 0)).toBe('city_b');
    expect(nearestDepotCity([], 0, 0)).toBeNull();
    expect(startPlaces({ ...world, depots: [] }, body, null)[0]!.cityId).toBeNull();
  });
});
