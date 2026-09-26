import { SeededRandom } from '../../core/random/SeededRandom';
import { bodyCanHaul } from '../../data/definitions/BodyType';
import type { CargoDefinition } from '../../data/definitions/CargoDefinition';
import type { CityDefinition } from '../../data/definitions/CityDefinition';
import type { DriverDefinition } from '../../data/definitions/DriverDefinition';
import type { VehicleDefinition } from '../../data/definitions/VehicleDefinition';
import type { Credits, Fraction } from '../../data/units';
import { fuelCost } from '../economy/costs';
import { contractReward } from '../missions/contractGenerator';
import { missionBasePay } from '../missions/missionReward';
import { fuelUsedLiters } from '../vehicles/fuelConsumption';

/** What a fleet contract draws on: the cities with a depot, the cargo, and the road between two depots. */
export interface FleetMarket {
  readonly cities: readonly CityDefinition[];
  readonly cargo: readonly CargoDefinition[];
  /** Road distance from one city's loading bay to another's, meters. */
  distanceMeters(originCityId: string, destinationCityId: string): number;
}

/** How fleet contracts go (GameConfig.fleet, with the fuel's price and scale). */
export interface FleetJobRules {
  /** A fleet truck's average pace on the roads, km/h, before its driver's speed factor. */
  readonly averageSpeedKmh: number;
  /** Loading at one depot and unloading at the next, seconds. */
  readonly handlingSeconds: number;
  /** The share of a contract of the day's pay a fleet contract earns. */
  readonly payFactor: number;
  /** GameConfig.fuel.consumptionScale: the miniature map's metres stretched into road. */
  readonly consumptionScale: number;
  /** GameConfig.economy.fuelPricePerLiter. */
  readonly fuelPricePerLiter: Credits;
}

/**
 * A contract a hired driver takes (spec §27): from the city they are in to
 * another, with a cargo their truck can carry. Everything is settled when
 * it is planned; the contract then takes `durationSeconds` of game time.
 */
export interface FleetJob {
  readonly originCityId: string;
  readonly destinationCityId: string;
  readonly cargoId: string;
  readonly cargoTons: number;
  /** Road distance between the two depots, meters. */
  readonly distanceMeters: number;
  /** Loading, the drive and unloading, seconds. */
  readonly durationSeconds: number;
  /** What the contract pays the company, before the driver's share and the fuel. */
  readonly pay: Credits;
  /** The driver's wage for it (DriverDefinition.payShare of the pay). */
  readonly driverShare: Credits;
  /** The diesel it burns, bought at the depots. */
  readonly fuelCost: Credits;
  /** The truck comes back damaged. */
  readonly incident: boolean;
}

/** What a contract asks of whoever drives it (a hired driver, or a rival's). */
export type FleetDriver = Pick<DriverDefinition, 'speedFactor' | 'incidentChance' | 'payShare'>;

/** Fleet contracts are of this difficulty's pay. */
const FLEET_DIFFICULTY = 'normal';
/** A fleet truck is loaded to this share of what it carries at least, and at most… */
const MIN_LOAD_SHARE = 0.4;
const MAX_LOAD_SHARE = 0.9;
/** …in half tonnes. */
const LOAD_STEP_TONS = 0.5;
/** Pay is rounded to this many credits. */
const PAY_ROUNDING = 10;

/**
 * The next contract for `driver` in `truck` (damaged `truckDamage`), from
 * `fromCityId` (any city with a depot if that one has none) to
 * `toCityId` if that is another city with a depot, else to one of the
 * others; the same for the same `seed`. Null when no other city has a depot
 * or the truck carries none of the cargo.
 */
export function planFleetJob(params: {
  readonly market: FleetMarket;
  readonly fromCityId: string;
  readonly toCityId?: string;
  readonly truck: VehicleDefinition;
  readonly truckDamage: Fraction;
  readonly driver: FleetDriver;
  readonly rules: FleetJobRules;
  readonly seed: number;
}): FleetJob | null {
  const { market, truck, driver, rules } = params;
  const cities = market.cities;
  if (cities.length < 2) {
    return null;
  }
  const cargo = market.cargo.filter((candidate) => bodyCanHaul(truck.bodyType, candidate.requiredBody));
  if (cargo.length === 0) {
    return null;
  }
  const random = new SeededRandom(Math.imul(params.seed, 0x85ebca6b) ^ 0x7f4a7c15);
  const origin = cities.find((city) => city.id === params.fromCityId) ?? cities[0]!;
  const destinations = cities.filter((city) => city !== origin);
  const roll = random.next();
  const destination =
    destinations.find((city) => city.id === params.toCityId) ??
    destinations[Math.min(destinations.length - 1, Math.floor(roll * destinations.length))]!;
  const load = cargo[Math.min(cargo.length - 1, Math.floor(random.next() * cargo.length))]!;
  const share = MIN_LOAD_SHARE + (MAX_LOAD_SHARE - MIN_LOAD_SHARE) * random.next();
  const cargoTons = Math.max(LOAD_STEP_TONS, Math.round((truck.maxPayloadTons * share) / LOAD_STEP_TONS) * LOAD_STEP_TONS);
  const incident = random.next() < driver.incidentChance;

  const distanceMeters = market.distanceMeters(origin.id, destination.id);
  const paceMetersPerSecond = (rules.averageSpeedKmh / 3.6) * driver.speedFactor;
  const reward = contractReward(distanceMeters, cargoTons, FLEET_DIFFICULTY) * rules.payFactor;
  const pay = Math.round(missionBasePay(reward, load.rewardMultiplier) / PAY_ROUNDING) * PAY_ROUNDING;
  const liters = fuelUsedLiters(
    distanceMeters,
    truck,
    cargoTons,
    1,
    rules.averageSpeedKmh / 3.6,
    params.truckDamage,
    rules.consumptionScale,
  );
  return {
    originCityId: origin.id,
    destinationCityId: destination.id,
    cargoId: load.id,
    cargoTons,
    distanceMeters,
    durationSeconds: rules.handlingSeconds + distanceMeters / paceMetersPerSecond,
    pay,
    driverShare: Math.round(pay * driver.payShare),
    fuelCost: fuelCost(liters, rules.fuelPricePerLiter),
    incident,
  };
}

/** What a finished fleet contract leaves the company: its pay less the driver's share and the fuel (may be below 0). */
export function fleetJobProfit(job: FleetJob): Credits {
  return job.pay - job.driverShare - job.fuelCost;
}

/**
 * The seed of the company's `jobNumber`-th fleet contract: every contract
 * gets its own, and a save that is loaded again plans the same ones.
 */
export function fleetJobSeed(jobNumber: number): number {
  return Math.imul(jobNumber + 1, 0x9e3779b1) ^ 0x2c1b3c6d;
}
