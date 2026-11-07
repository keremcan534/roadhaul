import type { EventBus } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import { err, ok, type Result } from '../../core/Result';
import type { Clock } from '../../core/time/Clock';
import type { GameConfig } from '../../data/config/GameConfig';
import type { Credits } from '../../data/units';
import { claimDaily, dailyCredits, dailyOffer, localDay, NO_STREAK, type DailyStreak } from '../../domain/rewards/dailyReward';
import type { DailyRewardSaveData } from '../../domain/save/SaveGameData';
import type { EconomyService } from '../economy/EconomyService';
import type { GameEvents } from '../GameEvents';
import type { CompanyLevelSource } from '../missions/MissionService';

/** The daily reward as offered now. */
export interface DailyRewardView {
  /** It can be claimed now (not yet today). */
  readonly claimable: boolean;
  /** Today's day of the streak, from 1. */
  readonly day: number;
  /** Days in a row with today's claim. */
  readonly streak: number;
  /** What each day of the streak pays the company at its level now, the first day first. */
  readonly credits: readonly Credits[];
}

export type ClaimDailyError = 'claimed';

/**
 * The daily reward: credits for the company's first claim of each of the
 * player's days (their own midnight, `localTimeOffsetMinutes`), more for
 * each day in a row (GameConfig.dailyReward), back to day 1 after a day
 * missed, and round again after the last. It never takes anything away, and
 * nothing is bought for it. The streak is in the save.
 */
export class DailyRewardService {
  private state: DailyStreak = NO_STREAK;

  constructor(
    private readonly config: GameConfig['dailyReward'],
    private readonly economy: EconomyService,
    private readonly company: CompanyLevelSource,
    private readonly clock: Clock,
    private readonly localTimeOffsetMinutes: number,
    private readonly events: EventBus<GameEvents>,
    private readonly logger: Logger,
  ) {}

  /** Today's reward, and the whole streak's. */
  get offer(): DailyRewardView {
    const offer = dailyOffer(this.state, this.today(), this.config.credits.length);
    return {
      claimable: offer.claimable,
      day: offer.day,
      streak: offer.streak,
      credits: this.config.credits.map((_, index) => this.creditsFor(index + 1)),
    };
  }

  /** Pays today's reward. Returns what it paid. */
  claim(): Result<Credits, ClaimDailyError> {
    const today = this.today();
    const offer = dailyOffer(this.state, today, this.config.credits.length);
    if (!offer.claimable) {
      return err('claimed');
    }
    const credits = this.creditsFor(offer.day);
    this.state = claimDaily(offer, today);
    this.economy.earn(credits, 'dailyReward');
    this.logger.info(`Daily reward: day ${offer.day}, ${offer.streak} in a row, ${credits}.`);
    this.events.emit('DailyRewardClaimed', { day: offer.day, streak: offer.streak, credits });
    return ok(credits);
  }

  snapshot(): DailyRewardSaveData {
    return { lastClaimDay: this.state.lastClaimDay, streak: this.state.streak };
  }

  restore(data: DailyRewardSaveData): void {
    this.state = { lastClaimDay: data.lastClaimDay, streak: data.streak };
  }

  private today(): number {
    return localDay(this.clock.now(), this.localTimeOffsetMinutes);
  }

  private creditsFor(day: number): Credits {
    return dailyCredits(this.config.credits, day, this.company.level, this.config.levelBonus, this.config.bonusLevels);
  }
}
