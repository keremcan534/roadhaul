import { SeededRandom } from '../../core/random/SeededRandom';
import { bodyCanHaul } from '../../data/definitions/BodyType';
import type { CargoCategory, CargoDefinition } from '../../data/definitions/CargoDefinition';
import type { CityDefinition, CitySpecialization } from '../../data/definitions/CityDefinition';
import {
  GENERATED_MISSION_ID_PREFIX,
  type MissionDefinition,
  type MissionDifficulty,
  type MissionVariant,
} from '../../data/definitions/MissionDefinition';
import type { VehicleDefinition } from '../../data/definitions/VehicleDefinition';

/** What the contract generator draws on: the cities with a depot on the map, the cargo, the trucks and the roads. */
export interface ContractMarket {
  readonly cities: readonly CityDefinition[];
  readonly cargo: readonly CargoDefinition[];
  readonly vehicles: readonly VehicleDefinition[];
  /** Road distance from one city's loading bay to another's, meters. */
  distanceMeters(originCityId: string, destinationCityId: string): number;
}

/** Each batch opens with two easy contracts a new company can take, then harder ones… */
const SLOT_DIFFICULTIES: readonly MissionDifficulty[] = ['easy', 'easy', 'normal', 'hard'];
/** …and any further slots draw from these. */
const LATER_DIFFICULTIES: readonly MissionDifficulty[] = ['normal', 'hard', 'expert'];
/** The company level each difficulty asks for (spec §14), before the truck it needs is counted. */
const DIFFICULTY_LEVEL: Readonly<Record<MissionDifficulty, number>> = { easy: 1, normal: 2, hard: 3, expert: 4 };
/**
 * Pay (spec §64: base distance value × difficulty; the cargo multiplier is
 * applied when paying): credits per km of road and per tonne, times the
 * difficulty's factor. Contracts of the day pay a little over the standing
 * ones, to be worth a look.
 */
const PAY_PER_KM = 150;
const PAY_PER_TON = 110;
const DIFFICULTY_PAY: Readonly<Record<MissionDifficulty, number>> = { easy: 1, normal: 1.6, hard: 2.1, expert: 2.6 };
const GENERATED_PAY_FACTOR = 1.1;
/**
 * Time limits: the road at this average speed (km/h), 15% more for loads
 * over 10 t, and time to leave one yard and park in the next; rounded up to
 * 10 s. Like the hand-authored contracts', a little easier.
 */
const AVERAGE_KMH: Readonly<Record<MissionDifficulty, number>> = { easy: 32, normal: 37, hard: 44, expert: 42 };
const HEAVY_LOAD_TONS = 10;
const HEAVY_LOAD_TIME_FACTOR = 1.15;
const YARD_SECONDS = 50;
const DAMAGE_TOLERANCE: Readonly<Record<MissionDifficulty, number>> = { easy: 0.3, normal: 0.2, hard: 0.15, expert: 0.1 };
/** Loads are a quarter to nine tenths of what the biggest suitable rigid truck carries, in half tonnes. */
const MIN_LOAD_SHARE = 0.25;
const MAX_LOAD_SHARE = 0.9;
/** A city ships more of what it makes (spec §20): these cargo families are this many times likelier from it. */
const SPECIALITIES: Readonly<Record<CitySpecialization, readonly CargoCategory[]>> = {
  starter: ['food', 'furniture', 'electronics', 'fragile'],
  industrial: ['automotive', 'construction', 'oversized', 'electronics'],
  agricultural: ['agriculture', 'food', 'frozenFood'],
  mining: ['construction', 'oversized', 'hazardous'],
  coastal: ['food', 'frozenFood', 'fragile'],
  quarry: ['construction', 'oversized'],
  market: ['furniture', 'electronics', 'food'],
};
/**
 * Of the contracts of the day after the two easy ones: this share are
 * rushes, on this share of the clock (a quarter faster on average: on the
 * highway's 90 and the country roads' 70 that is still a fair drive) for
 * this much more pay…
 */
const RUSH_CHANCE = 0.18;
const RUSH_TIME_SHARE = 0.8;
const RUSH_PAY_FACTOR = 1.5;
/** …and of those above easy, this share convoys. */
const CONVOY_CHANCE = 0.2;
/** The two easy contracts a batch opens with are always plain ones. */
const PLAIN_SLOTS = 2;
const SPECIALITY_WEIGHT = 3;

/**
 * A batch of contracts (spec §28–29), the same for everyone for the same
 * `batch` number (the entry point numbers the day's shifts). For each:
 * pick the origin city and another as the destination; a cargo (a city's
 * specialities are likelier); a load some truck can carry; the road
 * distance; the pay (spec §64); the time limit and the damage tolerance of
 * its difficulty. The company level it asks for is its difficulty's, or
 * the level where the truck it needs is sold if that is later. Easy
 * contracts fit a truck a new company can own. After the two easy ones,
 * a contract may be a rush or a convoy (MissionVariant: contractVariant);
 * never in a tender's batch (a negative one). Ids are
 * `daily_<batch>_<slot>`. Needs two cities; fewer give no contracts.
 */
export function generateContracts(market: ContractMarket, batch: number, count: number): MissionDefinition[] {
  const contracts: MissionDefinition[] = [];
  if (market.cities.length < 2) {
    return contracts;
  }
  const random = new SeededRandom(Math.imul(batch, 0x9e3779b1) ^ 0x2545f491);
  for (let slot = 0; slot < count; slot++) {
    // Draw the same numbers for every slot, so one that finds no cargo does not shift the next.
    const difficultyRoll = random.next();
    const originRoll = random.next();
    const destinationRoll = random.next();
    const cargoRoll = random.next();
    const loadRoll = random.next();
    const difficulty = SLOT_DIFFICULTIES[slot] ?? pick(LATER_DIFFICULTIES, difficultyRoll);
    const origin = pick(market.cities, originRoll);
    const destination = pick(
      market.cities.filter((city) => city !== origin),
      destinationRoll,
    );
    const trucks =
      difficulty === 'easy'
        ? market.vehicles.filter((vehicle) => (vehicle.requiredCompanyLevel ?? 1) <= 1)
        : market.vehicles;
    const carries = (cargo: CargoDefinition) => (vehicle: VehicleDefinition) =>
      bodyCanHaul(vehicle.bodyType, cargo.requiredBody);
    const choices = market.cargo.filter((cargo) => trucks.some(carries(cargo)));
    if (choices.length === 0) {
      continue;
    }
    const specialities = SPECIALITIES[origin.specialization];
    const cargo = weightedPick(
      choices,
      (candidate) => (specialities.includes(candidate.category) ? SPECIALITY_WEIGHT : 1),
      cargoRoll,
    );
    // Sized to the rigid trucks that carry it: a semi-trailer's bigger loads are its own contracts (missions.ts), and
    // the day's work stays open to companies without one.
    const suitable = trucks.filter(carries(cargo));
    const rigid = suitable.filter((vehicle) => vehicle.trailer === undefined);
    const capacity = Math.max(...(rigid.length > 0 ? rigid : suitable).map((vehicle) => vehicle.maxPayloadTons));
    const share = MIN_LOAD_SHARE + (MAX_LOAD_SHARE - MIN_LOAD_SHARE) * loadRoll;
    const tons = Math.max(0.5, Math.round(capacity * share * 2) / 2);
    const haulers = market.vehicles.filter((vehicle) => carries(cargo)(vehicle) && vehicle.maxPayloadTons >= tons);
    const truckLevel = Math.min(...haulers.map((vehicle) => vehicle.requiredCompanyLevel ?? 1));
    const level = Math.max(DIFFICULTY_LEVEL[difficulty], truckLevel);
    const meters = market.distanceMeters(origin.id, destination.id);
    const pay = contractReward(meters, tons, difficulty) * GENERATED_PAY_FACTOR;
    const heavy = tons > HEAVY_LOAD_TONS ? HEAVY_LOAD_TIME_FACTOR : 1;
    const driveSeconds = (meters / (AVERAGE_KMH[difficulty] / 3.6)) * heavy;
    contracts.push({
      id: `${GENERATED_MISSION_ID_PREFIX}${batch}_${slot + 1}`,
      originCityId: origin.id,
      destinationCityId: destination.id,
      cargoId: cargo.id,
      cargoWeightTons: tons,
      baseReward: Math.max(50, Math.round(pay / 50) * 50),
      timeLimitSeconds: Math.ceil((driveSeconds + YARD_SECONDS) / 10) * 10,
      damageTolerance: DAMAGE_TOLERANCE[difficulty],
      difficulty,
      ...(level > 1 ? { requiredCompanyLevel: level } : {}),
    });
    // Tenders (negative batches) are plain ones too: a race is enough.
    const variant = slot < PLAIN_SLOTS || batch < 0 ? 'standard' : contractVariant(batch, slot, difficulty);
    if (variant !== 'standard') {
      contracts[contracts.length - 1] = withVariant(contracts[contracts.length - 1]!, variant);
    }
  }
  return contracts;
}

/**
 * The kind of job slot `slot` of batch `batch` is, from a draw of its own
 * (the rest of the batch is drawn as before it had kinds): a rush now and
 * then, and from the normal contracts up, a convoy (CONVOY_CHANCE).
 */
function contractVariant(batch: number, slot: number, difficulty: MissionDifficulty): MissionVariant {
  // The batch and slot mixed well first: one batch's draws are nothing like the next one's.
  let seed = Math.imul(batch, 0x9e3779b1) ^ Math.imul(slot + 1, 0x85ebca6b);
  seed = Math.imul(seed ^ (seed >>> 16), 0x7feb352d);
  seed = Math.imul(seed ^ (seed >>> 15), 0x846ca68b);
  const roll = new SeededRandom(seed ^ (seed >>> 16)).next();
  if (roll < RUSH_CHANCE) {
    return 'rush';
  }
  if (difficulty !== 'easy' && roll < RUSH_CHANCE + CONVOY_CHANCE) {
    return 'convoy';
  }
  return 'standard';
}

/** `contract` as a job of kind `variant`: a rush on a shorter clock for more pay; a convoy as it was (its bonus comes at the drop-off). */
export function withVariant(contract: MissionDefinition, variant: MissionVariant): MissionDefinition {
  if (variant === 'rush') {
    return {
      ...contract,
      variant,
      timeLimitSeconds: Math.ceil((contract.timeLimitSeconds * RUSH_TIME_SHARE) / 10) * 10,
      baseReward: Math.round((contract.baseReward * RUSH_PAY_FACTOR) / 50) * 50,
    };
  }
  return { ...contract, variant };
}

/**
 * What a contract of `difficulty` over `distanceMeters` of road with `tons`
 * aboard is worth (spec §64: base distance value × difficulty; the cargo
 * multiplier comes on top when paying), in fractional credits.
 */
export function contractReward(distanceMeters: number, tons: number, difficulty: MissionDifficulty): number {
  return (PAY_PER_KM * (distanceMeters / 1000) + PAY_PER_TON * tons) * DIFFICULTY_PAY[difficulty];
}

/** The item `roll` (0..1) lands on, all equally likely. */
function pick<T>(items: readonly T[], roll: number): T {
  return items[Math.min(items.length - 1, Math.floor(roll * items.length))]!;
}

/** The item `roll` (0..1) lands on, each as likely as its weight. */
function weightedPick<T>(items: readonly T[], weight: (item: T) => number, roll: number): T {
  const total = items.reduce((sum, item) => sum + weight(item), 0);
  let left = roll * total;
  for (const item of items) {
    left -= weight(item);
    if (left < 0) {
      return item;
    }
  }
  return items[items.length - 1]!;
}
