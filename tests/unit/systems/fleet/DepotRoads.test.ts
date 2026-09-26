import { describe, expect, it } from 'vitest';
import { placeAlong, placeOnJob, type JobRoute, type MapPlacement } from '../../../../src/systems/fleet/DepotRoads';
import { newCompany } from '../../../support/game';

/** An L: 100 m north from the origin, then 100 m east. */
const ROUTE: JobRoute = {
  x: new Float64Array([0, 0, 100]),
  z: new Float64Array([0, 100, 100]),
  along: new Float64Array([0, 100, 200]),
  length: 200,
};

describe('DepotRoads', () => {
  it('knows the cities with a depot on the map being driven, the road between them and its way, worked out once', async () => {
    const game = await newCompany();
    const roads = game.depotRoads;
    const market = roads.market()!;
    expect(market.cities.map((city) => city.id)).toEqual(['city_a', 'city_b', 'city_c']);
    const meters = market.distanceMeters('city_a', 'city_b');
    expect(meters).toBeGreaterThan(3000);
    expect(market.distanceMeters('city_a', 'city_b')).toBe(meters);

    const route = roads.route('city_a', 'city_b')!;
    expect(roads.route('city_a', 'city_b')).toBe(route);
    const bay = game.driving.world.depotOf('city_a')!.bay;
    expect([route.x[0], route.z[0]]).toEqual([bay.x, bay.z]);
    // The way follows the road: about as long as the distance by road.
    expect(route.length).toBeGreaterThan(meters * 0.9);
    expect(route.length).toBeLessThan(meters * 1.1);
    expect(roads.route('city_a', 'atlantis')).toBeNull();
  });
});

describe('placeAlong and placeOnJob', () => {
  it('put a marker the given way along a route, facing along it', () => {
    const placement: MapPlacement = { x: 0, z: 0, heading: 0 };
    placeAlong(ROUTE, 50, placement);
    expect(placement).toEqual({ x: 0, z: 50, heading: 0 });
    placeAlong(ROUTE, 150, placement);
    expect(placement).toEqual({ x: 50, z: 100, heading: Math.PI / 2 });
    placeAlong(ROUTE, 500, placement);
    expect(placement).toMatchObject({ x: 100, z: 100 });
  });

  it('keep a truck at the bay while it loads and unloads, and move it evenly between', () => {
    const placement: MapPlacement = { x: 0, z: 0, heading: 0 };
    const job = { durationSeconds: 120 };
    expect(placeOnJob(ROUTE, job, 5, 20, placement)).toBe(false); // Loading: the first 10 s.
    expect(placement).toMatchObject({ x: 0, z: 0 });
    expect(placeOnJob(ROUTE, job, 60, 20, placement)).toBe(true); // Half way through the drive.
    expect(placement).toMatchObject({ x: 0, z: 100 });
    expect(placeOnJob(ROUTE, job, 115, 20, placement)).toBe(false); // Unloading.
    expect(placement).toMatchObject({ x: 100, z: 100 });
  });
});
