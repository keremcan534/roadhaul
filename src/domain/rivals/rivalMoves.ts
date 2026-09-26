import type { Fraction } from '../../data/units';
import type { StandingBoard } from './StandingBoard';

/** Draws numbers in [0, 1): SeededRandom, or a fixed list in tests. */
export interface RandomSource {
  next(): number;
}

/** A truck away from home heads back there this share of the time, when it does not go into battle. */
const HOME_BIAS = 0.5;
/** An aggressive rival (aggression 1) sends a truck to a city the player leads this share of the time. */
const ATTACK_SHARE = 0.6;
/** A rival defends a lead of less than this share over the runner-up. */
const SAFE_LEAD: Fraction = 0.1;
/** What makes a city worth a campaign, besides the share the rival already has there… */
const PLAYER_CITY_WEIGHT = 0.25;
const HOME_WEIGHT = 0.3;

/**
 * Where a rival's truck in `fromCityId` takes its next contract: now and
 * then, the more the rival is `aggression`, into a city the player leads
 * (`playerCities`), to fight for it; otherwise, from away, often back home;
 * else anywhere. Null when there is no other city.
 */
export function rivalDestination(params: {
  /** The cities with a depot. */
  readonly cityIds: readonly string[];
  readonly fromCityId: string;
  readonly homeCityId: string;
  readonly playerCities: readonly string[];
  readonly aggression: Fraction;
  readonly random: RandomSource;
}): string | null {
  const { cityIds, fromCityId, homeCityId, random } = params;
  const choices = cityIds.filter((cityId) => cityId !== fromCityId);
  if (choices.length === 0) {
    return null;
  }
  const attackRoll = random.next();
  const homeRoll = random.next();
  const pickRoll = random.next();
  const targets = choices.filter((cityId) => params.playerCities.includes(cityId));
  if (targets.length > 0 && attackRoll < params.aggression * ATTACK_SHARE) {
    return pick(targets, pickRoll);
  }
  if (fromCityId !== homeCityId && choices.includes(homeCityId) && homeRoll < HOME_BIAS) {
    return homeCityId;
  }
  return pick(choices, pickRoll);
}

/**
 * Why a rival campaigns in a city: to keep a lead that is slipping, to
 * take a city from the player, or to win ground elsewhere.
 */
export type CampaignAim = 'defend' | 'attack' | 'expand';

export interface CampaignTarget {
  readonly cityId: string;
  readonly aim: CampaignAim;
}

/**
 * The city a rival runs its next campaign in, or null when it leads
 * everywhere safely: where its own lead is slipping, or else where it
 * stands to gain most — the more of the city it already has, the better;
 * better still its home, or a city the player leads. `leaderOf` tells who
 * leads each city.
 */
export function campaignTarget(
  board: StandingBoard,
  leaderOf: (cityId: string) => string | null,
  rivalId: string,
  homeCityId: string,
  playerId: string,
): CampaignTarget | null {
  let best: CampaignTarget | null = null;
  let bestScore = -Infinity;
  for (const cityId of board.cityIds) {
    const leader = leaderOf(cityId);
    const share = board.shareOf(cityId, rivalId);
    let score: number;
    let aim: CampaignAim;
    if (leader === rivalId) {
      const lead = share - runnerUpShare(board, cityId, rivalId);
      if (lead >= SAFE_LEAD) {
        continue;
      }
      score = 1 + (SAFE_LEAD - lead); // Keeping a city comes first.
      aim = 'defend';
    } else {
      score = share + (leader === playerId ? PLAYER_CITY_WEIGHT : 0) + (cityId === homeCityId ? HOME_WEIGHT : 0);
      aim = leader === playerId ? 'attack' : 'expand';
    }
    if (score > bestScore) {
      best = { cityId, aim };
      bestScore = score;
    }
  }
  return best;
}

/**
 * Who leads `cityId` now, when `current` led it until now (null: nobody):
 * the leader keeps it while it still has nearly the lead share, and nobody
 * is `margin` of the share or more ahead of it; otherwise whoever
 * StandingBoard.leaderOf names, or nobody. The margin keeps a close race
 * from changing hands at every delivery.
 */
export function nextLeader(board: StandingBoard, cityId: string, current: string | null, leadShare: Fraction, margin: Fraction): string | null {
  if (current !== null) {
    const share = board.shareOf(cityId, current);
    if (share >= leadShare - margin && runnerUpShare(board, cityId, current) < share + margin) {
      return current;
    }
  }
  return board.leaderOf(cityId, leadShare);
}

/** The biggest share in `cityId` of any company but `companyId`. */
function runnerUpShare(board: StandingBoard, cityId: string, companyId: string): Fraction {
  let best = 0;
  for (const other of board.companyIds) {
    if (other !== companyId) {
      best = Math.max(best, board.shareOf(cityId, other));
    }
  }
  return best;
}

/** The item `roll` (0..1) lands on, all equally likely. */
function pick<T>(items: readonly T[], roll: number): T {
  return items[Math.min(items.length - 1, Math.floor(roll * items.length))]!;
}
