import { SeededRandom } from '../../core/random/SeededRandom';
import { GENERATED_MISSION_ID_PREFIX, type MissionDefinition } from '../../data/definitions/MissionDefinition';
import type { RivalCompanyDefinition } from '../../data/definitions/RivalCompanyDefinition';
import type { Credits, Fraction } from '../../data/units';
import { generateContracts, type ContractMarket } from '../missions/contractGenerator';

/** Tenders are generated contracts: their ids start with this. */
export const TENDER_ID_PREFIX = `${GENERATED_MISSION_ID_PREFIX}tender_`;

/** A tender is picked from a batch of this many contracts (the generator's easy, easy, normal and hard). */
const TENDER_CHOICES = 4;
/** Prizes are rounded to this many credits. */
const PRIZE_ROUNDING = 10;

/**
 * A tender (spec §65 V3, "ihale sistemi"): a contract on the job board that
 * a rival company bids for too. Whoever unloads it at the destination first
 * wins: the prize on top of the pay, and standing in both cities. The race
 * starts when the company has loaded it: the rival's truck sets off from the
 * same bay then, and unloads `rivalSeconds` later.
 */
export interface Tender {
  readonly contract: MissionDefinition;
  readonly rivalId: string;
  readonly prize: Credits;
  /** From loading until the rival has unloaded at the destination, seconds. */
  readonly rivalSeconds: number;
}

/** How a tender is set (GameConfig.rivals, and the time unloading takes). */
export interface TenderRules {
  /** The prize: this share of the contract's pay. */
  readonly prizeShare: Fraction;
  /** The rival's average pace, km/h, before its speed factor. */
  readonly rivalSpeedKmh: number;
  /** Unloading at the destination (GameConfig.missions.loadingSeconds), seconds. */
  readonly unloadSeconds: number;
}

/**
 * The `number`-th tender (0 is the first), the same for the same number:
 * the hardest contract of a generated batch the company can take now
 * (`canTake`: its level and truck), else the batch's first; raced by the
 * rival at home at either end if there is one, else any rival still in
 * business. Null without rivals or contracts.
 */
export function planTender(params: {
  readonly market: ContractMarket;
  readonly number: number;
  readonly rivals: readonly RivalCompanyDefinition[];
  readonly rules: TenderRules;
  readonly canTake: (contract: MissionDefinition) => boolean;
}): Tender | null {
  const { market, number, rivals, rules } = params;
  if (rivals.length === 0) {
    return null;
  }
  // Negative batches: the contracts of the day are numbered by the clock, from 0 up.
  const batch = generateContracts(market, -1 - number, TENDER_CHOICES);
  const takeable = batch.filter(params.canTake);
  const chosen = takeable[takeable.length - 1] ?? batch[0];
  if (chosen === undefined) {
    return null;
  }
  const random = new SeededRandom(Math.imul(number + 1, 0x632be5ab) ^ 0x1b873593);
  const local = rivals.filter(
    (rival) => rival.homeCityId === chosen.originCityId || rival.homeCityId === chosen.destinationCityId,
  );
  const pool = local.length > 0 ? local : rivals;
  const rival = pool[Math.min(pool.length - 1, Math.floor(random.next() * pool.length))]!;
  const meters = market.distanceMeters(chosen.originCityId, chosen.destinationCityId);
  const paceMetersPerSecond = (rules.rivalSpeedKmh / 3.6) * rival.speedFactor;
  return {
    contract: { ...chosen, id: `${TENDER_ID_PREFIX}${number + 1}` },
    rivalId: rival.id,
    prize: Math.round((chosen.baseReward * rules.prizeShare) / PRIZE_ROUNDING) * PRIZE_ROUNDING,
    rivalSeconds: meters / paceMetersPerSecond + rules.unloadSeconds,
  };
}

/** Whether `missionId` is a tender's. */
export function isTenderId(missionId: string): boolean {
  return missionId.startsWith(TENDER_ID_PREFIX);
}
