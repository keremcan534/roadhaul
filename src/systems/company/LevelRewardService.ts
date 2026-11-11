import type { EventBus } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import { err, ok, type Result } from '../../core/Result';
import type { LevelRewardConfig } from '../../data/config/GameConfig';
import type { LevelRewardsSaveData } from '../../domain/save/SaveGameData';
import type { EconomyService } from '../economy/EconomyService';
import type { CrateSource, GameEvents } from '../GameEvents';
import type { CompanyLevelSource } from '../missions/MissionService';
import type { CrateTier } from '../../data/config/GameConfig';

/** Gives crates: CrateService. */
export interface CrateGranter {
  grant(tier: CrateTier, source: CrateSource): void;
}

export type CollectLevelRewardError = 'nothingWaiting';

/** A company level's reward, collected. */
export interface LevelRewardCollected extends LevelRewardConfig {
  readonly level: number;
}

/**
 * The company levels' rewards (GameConfig.company.levelRewards): each level
 * from the second brings credits and a crate, which wait until the player
 * collects them, one level at a time, the lowest first (the level-up
 * celebration's button). The highest level collected is in the save.
 */
export class LevelRewardService {
  private rewarded = 1;

  constructor(
    private readonly rewards: readonly LevelRewardConfig[],
    private readonly company: CompanyLevelSource,
    private readonly economy: EconomyService,
    private readonly crates: CrateGranter,
    private readonly events: EventBus<GameEvents>,
    private readonly logger: Logger,
  ) {}

  /** The lowest level whose reward waits to be collected, or null. */
  get waitingLevel(): number | null {
    return this.rewarded < this.company.level ? this.rewarded + 1 : null;
  }

  /** How many levels' rewards wait. */
  get waiting(): number {
    return Math.max(0, this.company.level - this.rewarded);
  }

  /** What level `level` (from 2) brings. Throws for a level without a reward. */
  rewardFor(level: number): LevelRewardConfig {
    const reward = this.rewards[level - 2];
    if (reward === undefined) {
      throw new Error(`Level ${level} has no reward.`);
    }
    return reward;
  }

  /** Collects the lowest waiting level's reward: pays its credits and gives its crate. */
  collect(): Result<LevelRewardCollected, CollectLevelRewardError> {
    const level = this.waitingLevel;
    if (level === null) {
      return err('nothingWaiting');
    }
    const reward = this.rewardFor(level);
    this.rewarded = level;
    this.economy.earn(reward.credits, 'levelReward');
    this.crates.grant(reward.crate, 'level');
    this.logger.info(`Level ${level} reward collected: ${reward.credits} credits and a ${reward.crate} crate.`);
    this.events.emit('LevelRewardCollected', { level, credits: reward.credits, crate: reward.crate });
    return ok({ level, ...reward });
  }

  snapshot(): LevelRewardsSaveData {
    return { rewardedLevel: this.rewarded };
  }

  restore(save: LevelRewardsSaveData): void {
    this.rewarded = save.rewardedLevel;
  }
}
