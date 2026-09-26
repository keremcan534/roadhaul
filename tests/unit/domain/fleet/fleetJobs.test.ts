import { describe, expect, it } from 'vitest';
import { bodyCanHaul } from '../../../../src/data/definitions/BodyType';
import type { DriverDefinition } from '../../../../src/data/definitions/DriverDefinition';
import { CARGO } from '../../../../src/data/content/cargo';
import { CITIES } from '../../../../src/data/content/cities';
import { VEHICLES } from '../../../../src/data/content/vehicles';
import { fleetJobProfit, fleetJobSeed, planFleetJob, type FleetMarket } from '../../../../src/domain/fleet/fleetJobs';
import { contractReward } from '../../../../src/domain/missions/contractGenerator';
import { cargoFixture, driverFixture } from '../../../support/contentFixtures';

const RULES = { averageSpeedKmh: 45, handlingSeconds: 60, payFactor: 0.75, consumptionScale: 10, fuelPricePerLiter: 12 };
/** The three cities, 3 km apart by road (4 km to and from the third). */
const MARKET: FleetMarket = {
  cities: CITIES,
  cargo: CARGO,
  distanceMeters: (from, to) => (from === 'city_c' || to === 'city_c' ? 4000 : 3000),
};
const BOX_TRUCK = VEHICLES.find((vehicle) => vehicle.id === 'rh_h1')!;

function plan(
  overrides: { seed?: number; fromCityId?: string; toCityId?: string; driver?: DriverDefinition; market?: FleetMarket; truckDamage?: number } = {},
) {
  return planFleetJob({
    market: overrides.market ?? MARKET,
    fromCityId: overrides.fromCityId ?? 'city_a',
    ...(overrides.toCityId === undefined ? {} : { toCityId: overrides.toCityId }),
    truck: BOX_TRUCK,
    truckDamage: overrides.truckDamage ?? 0,
    driver: overrides.driver ?? driverFixture(),
    rules: RULES,
    seed: overrides.seed ?? 1,
  });
}

describe('planFleetJob', () => {
  it('takes a cargo the truck carries from the driver\'s city to another, loaded to 40–90%, the same for the same seed', () => {
    for (let seed = 0; seed < 60; seed++) {
      const job = plan({ seed, fromCityId: 'city_b' })!;
      expect(job.originCityId).toBe('city_b');
      expect(job.destinationCityId).not.toBe('city_b');
      const cargo = CARGO.find((candidate) => candidate.id === job.cargoId)!;
      expect(bodyCanHaul(BOX_TRUCK.bodyType, cargo.requiredBody), job.cargoId).toBe(true);
      expect(job.cargoTons).toBeGreaterThanOrEqual(BOX_TRUCK.maxPayloadTons * 0.4 - 0.25);
      expect(job.cargoTons).toBeLessThanOrEqual(BOX_TRUCK.maxPayloadTons * 0.9 + 0.25);
      expect(job.cargoTons % 0.5).toBe(0);
      expect(plan({ seed, fromCityId: 'city_b' })).toEqual(job);
    }
    const destinations = new Set(Array.from({ length: 40 }, (_, seed) => plan({ seed })!.destinationCityId));
    expect(destinations).toEqual(new Set(['city_b', 'city_c']));
  });

  it('pays a contract of the day\'s pay for the road and load, times the cargo\'s, less the driver\'s share and the diesel', () => {
    const job = plan({ seed: 5 })!;
    const cargo = CARGO.find((candidate) => candidate.id === job.cargoId)!;
    const expected = contractReward(job.distanceMeters, job.cargoTons, 'normal') * RULES.payFactor * cargo.rewardMultiplier;
    expect(Math.abs(job.pay - expected)).toBeLessThanOrEqual(5.01);
    expect(job.pay % 10).toBe(0);
    expect(job.driverShare).toBe(Math.round(job.pay * driverFixture().payShare));
    expect(job.fuelCost).toBeGreaterThan(0);
    expect(fleetJobProfit(job)).toBe(job.pay - job.driverShare - job.fuelCost);
    expect(fleetJobProfit(job)).toBeGreaterThan(job.pay * 0.4);
    // A battered truck burns more.
    expect(plan({ seed: 5, truckDamage: 1 })!.fuelCost).toBeGreaterThan(job.fuelCost);
  });

  it('takes the road at the fleet\'s pace, quicker with a quicker driver, plus the handling at both depots', () => {
    const job = plan({ seed: 2 })!;
    expect(job.durationSeconds).toBeCloseTo(60 + job.distanceMeters / (45 / 3.6), 6);
    const quick = plan({ seed: 2, driver: driverFixture({ speedFactor: 1.25 }) })!;
    expect(quick.distanceMeters).toBe(job.distanceMeters);
    expect(quick.durationSeconds - 60).toBeCloseTo((job.durationSeconds - 60) / 1.25, 6);
  });

  it('damages the truck on about as many contracts as the driver\'s incident chance says', () => {
    const count = (incidentChance: number) =>
      Array.from({ length: 2000 }, (_, jobNumber) => plan({ seed: fleetJobSeed(jobNumber), driver: driverFixture({ incidentChance }) })).filter(
        (job) => job!.incident,
      ).length;
    expect(count(0)).toBe(0);
    expect(count(1)).toBe(2000);
    expect(count(0.1)).toBeGreaterThan(150);
    expect(count(0.1)).toBeLessThan(250);
  });

  it('starts from the first city when the driver\'s has no depot, and has no contract without two cities or a cargo to carry', () => {
    expect(plan({ fromCityId: 'nowhere' })!.originCityId).toBe('city_a');
    expect(plan({ market: { ...MARKET, cities: CITIES.slice(0, 1) } })).toBeNull();
    expect(plan({ market: { ...MARKET, cargo: [cargoFixture({ requiredBody: 'flatbed' })] } })).toBeNull();
  });

  it('goes where it is sent, if that is another city with a depot, and draws the same load for the same seed', () => {
    for (let seed = 0; seed < 20; seed++) {
      const sent = plan({ seed, toCityId: 'city_c' })!;
      expect(sent.destinationCityId).toBe('city_c');
      const free = plan({ seed })!;
      expect([sent.cargoId, sent.cargoTons, sent.incident]).toEqual([free.cargoId, free.cargoTons, free.incident]);
    }
    // Not to the city it is in, nor to one without a depot: then anywhere else.
    expect(plan({ toCityId: 'city_a' })!.destinationCityId).not.toBe('city_a');
    expect(['city_b', 'city_c']).toContain(plan({ toCityId: 'atlantis' })!.destinationCityId);
  });

  it('seeds every contract of the company differently', () => {
    const seeds = new Set(Array.from({ length: 1000 }, (_, jobNumber) => fleetJobSeed(jobNumber)));
    expect(seeds.size).toBe(1000);
  });
});
