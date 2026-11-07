import type { EventBus, Unsubscribe } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import { SeededRandom } from '../../core/random/SeededRandom';
import type { Clock } from '../../core/time/Clock';
import type { GameConfig } from '../../data/config/GameConfig';
import type { CrateTier } from '../../data/definitions/CrateTier';
import { PLAYER_COMPANY_ID, type RivalCompanyDefinition } from '../../data/definitions/RivalCompanyDefinition';
import type { Credits } from '../../data/units';
import { localDay } from '../../domain/rewards/dailyReward';
import type { WeeklyCupSaveData } from '../../domain/save/SaveGameData';
import type { EconomyService } from '../economy/EconomyService';
import type { CrateSource, GameEvents } from '../GameEvents';

const DAY_MS = 86_400_000;
/** 1 January 1970 was a Thursday: three days on, the weeks start on Mondays. */
const MONDAY_OFFSET_DAYS = 3;

/** A company in the week's cup. */
export interface CupEntry {
  /** PLAYER_COMPANY_ID or a rival's id. */
  readonly companyId: string;
  readonly points: number;
}

/** How the company finished a week's cup, and what it won. */
export interface CupResult {
  readonly week: number;
  /** 1 for first. */
  readonly rank: number;
  readonly credits: Credits;
  readonly crate: CrateTier | null;
}

/** What the cup reads of the rivals: RivalService. */
export interface CupRivals {
  statuses(): readonly { readonly definition: RivalCompanyDefinition; readonly trucks: number; readonly acquired: boolean }[];
}

/** What the cup gives a crate through: CrateService. */
export interface CupCrates {
  grant(tier: CrateTier, source: CrateSource): void;
}

/**
 * The weekly cup (Monday to Sunday of the player's calendar): the company
 * earns points for its own deliveries (by their pay) and its hired drivers'
 * (by their profit); the rivals earn theirs through the week by their size
 * and manner (a ruthless one more, a thrifty one less), their week's total
 * worked out from the week alone. When a new week starts, the last one's top
 * three are paid (credits and a crate, GameConfig.weeklyCup.rewards) and the
 * points start again. In the save.
 */
export class WeeklyCupService {
  private week = Number.NaN;
  private points = 0;
  private last: CupResult | null = null;
  private readonly unsubscribe: Unsubscribe[];

  constructor(
    private readonly rivals: CupRivals,
    private readonly economy: EconomyService,
    private readonly crates: CupCrates,
    private readonly clock: Clock,
    private readonly localOffsetMinutes: number,
    private readonly config: GameConfig['weeklyCup'],
    private readonly events: EventBus<GameEvents>,
    private readonly logger: Logger,
  ) {
    this.unsubscribe = [
      events.on('MissionCompleted', ({ reward }) => this.score(Math.max(config.leastDeliveryPoints, Math.round(reward.total / config.creditsPerPoint)))),
      events.on('FleetJobCompleted', ({ profit }) => this.score(Math.max(0, Math.round(profit / config.fleetCreditsPerPoint)))),
    ];
  }

  /** The week it is now (Monday-based weeks since 1970 on the player's calendar). */
  get currentWeek(): number {
    return Math.floor((localDay(this.clock.now(), this.localOffsetMinutes) + MONDAY_OFFSET_DAYS) / 7);
  }

  /** Milliseconds until this week's cup ends. */
  get endsInMs(): number {
    const offsetMs = this.localOffsetMinutes * 60_000;
    const end = ((this.currentWeek + 1) * 7 - MONDAY_OFFSET_DAYS) * DAY_MS - offsetMs;
    return Math.max(0, end - this.clock.now());
  }

  /** How the last week the company played ended, or null. */
  get lastResult(): CupResult | null {
    return this.last;
  }

  /** The company's points this week (none yet if the week turned since update() last ran). */
  get playerPoints(): number {
    return this.week === this.currentWeek ? this.points : 0;
  }

  /**
   * This week's standings, the most points first: the company and the rivals
   * still in business. Reads only: update() decides a week that has ended.
   */
  standings(): CupEntry[] {
    const week = this.currentWeek;
    const now = this.clock.now();
    const offsetMs = this.localOffsetMinutes * 60_000;
    const start = (week * 7 - MONDAY_OFFSET_DAYS) * DAY_MS - offsetMs;
    const share = Math.min(1, Math.max(0, (now - start) / (7 * DAY_MS)));
    return this.table(week, share, this.playerPoints);
  }

  /** Checks for a new week: the last one's cup is decided and paid. Cheap to call every step. */
  update(): void {
    this.roll();
  }

  snapshot(): WeeklyCupSaveData {
    return {
      week: Number.isNaN(this.week) ? null : this.week,
      points: this.points,
      last: this.last === null ? null : { ...this.last },
    };
  }

  restore(data: WeeklyCupSaveData): void {
    this.week = data.week ?? Number.NaN;
    this.points = data.points;
    this.last = data.last === null ? null : { ...data.last };
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribe) {
      unsubscribe();
    }
  }

  private score(points: number): void {
    this.roll();
    this.points += points;
  }

  /** A new week: the last one the company took part in is decided and paid, the points start again. */
  private roll(): void {
    const week = this.currentWeek;
    if (week === this.week) {
      return;
    }
    if (!Number.isNaN(this.week) && this.points > 0) {
      const table = this.table(this.week, 1, this.points);
      const rank = table.findIndex((entry) => entry.companyId === PLAYER_COMPANY_ID) + 1;
      const prize = this.config.rewards[rank - 1];
      this.last = { week: this.week, rank, credits: prize?.credits ?? 0, crate: prize?.crate ?? null };
      if (prize !== undefined) {
        this.economy.earn(prize.credits, 'cup');
        if (prize.crate !== null) {
          this.crates.grant(prize.crate, 'cup');
        }
      }
      this.logger.info(`Weekly cup ${this.week}: ${rank} of ${table.length}.`);
      this.events.emit('WeeklyCupEnded', this.last);
    }
    this.week = week;
    this.points = 0;
  }

  /** Week `week`'s table with `share` of it gone (0..1): the rivals' points so far, and the company's `points`. */
  private table(week: number, share: number, points: number): CupEntry[] {
    const entries: CupEntry[] = [{ companyId: PLAYER_COMPANY_ID, points }];
    this.rivals.statuses().forEach((rival, index) => {
      if (rival.acquired) {
        return;
      }
      const luck = new SeededRandom(week * 7919 + index * 104_729 + 17).range(this.config.rivalLuck[0], this.config.rivalLuck[1]);
      const manner = this.config.mannerFactors[rival.definition.personality];
      const total = rival.trucks * this.config.rivalPointsPerTruck * manner * luck;
      entries.push({ companyId: rival.definition.id, points: Math.floor(total * share) });
    });
    // Ties go to the company: it is the player's cup.
    return entries.sort((a, b) => b.points - a.points || (a.companyId === PLAYER_COMPANY_ID ? -1 : b.companyId === PLAYER_COMPANY_ID ? 1 : 0));
  }
}
