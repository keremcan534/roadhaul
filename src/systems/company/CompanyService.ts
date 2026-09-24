import type { EventBus, Unsubscribe } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import type { GameConfig } from '../../data/config/GameConfig';
import type { Credits } from '../../data/units';
import { levelForXp, levelProgress, type LevelProgress } from '../../domain/company/companyProgress';
import type { CompanySaveData, ProfileSaveData, StatsSaveData } from '../../domain/save/SaveGameData';
import type { GameEvents } from '../GameEvents';

/** Delivery statistics kept with the company. */
export interface CompanyStats {
  deliveriesCompleted: number;
  deliveriesFailed: number;
  creditsEarned: Credits;
}

/**
 * The player's company (spec §14): name, XP and level, reputation and
 * delivery statistics. Deliveries add XP and reputation (MissionCompleted),
 * failures cost reputation (MissionFailed). Announces CompanyProgressed and
 * CompanyLevelUp.
 */
export class CompanyService {
  private name = '';
  private xpTotal = 0;
  private reputationTotal = 0;
  private readonly statistics: CompanyStats = { deliveriesCompleted: 0, deliveriesFailed: 0, creditsEarned: 0 };
  private readonly unsubscribe: Unsubscribe[];

  constructor(
    private readonly events: EventBus<GameEvents>,
    private readonly config: GameConfig['company'],
    private readonly logger: Logger,
  ) {
    this.unsubscribe = [
      events.on('MissionCompleted', ({ xp, reputation, reward }) => {
        this.statistics.deliveriesCompleted++;
        this.statistics.creditsEarned += reward.total;
        this.progress(xp, reputation);
      }),
      events.on('MissionFailed', ({ reputationLost }) => {
        this.statistics.deliveriesFailed++;
        this.progress(0, -reputationLost);
      }),
    ];
  }

  get companyName(): string {
    return this.name;
  }

  get xp(): number {
    return this.xpTotal;
  }

  /** Derived from XP, so it can never disagree with it. */
  get level(): number {
    return levelForXp(this.xpTotal, this.config.levelXp);
  }

  get maxLevel(): number {
    return this.config.levelXp.length;
  }

  get levelProgress(): LevelProgress {
    return levelProgress(this.xpTotal, this.config.levelXp);
  }

  get reputation(): number {
    return this.reputationTotal;
  }

  get stats(): Readonly<CompanyStats> {
    return this.statistics;
  }

  /** Adds XP earned outside a delivery: an event's reward. */
  award(xp: number): void {
    this.progress(xp, 0);
  }

  /** Takes over a loaded or new company. No events: nothing was earned. */
  restore(profile: ProfileSaveData, company: CompanySaveData, stats: StatsSaveData): void {
    this.name = profile.companyName;
    this.xpTotal = company.xp;
    this.reputationTotal = company.reputation;
    this.statistics.deliveriesCompleted = stats.deliveriesCompleted;
    this.statistics.deliveriesFailed = stats.deliveriesFailed;
    this.statistics.creditsEarned = stats.creditsEarned;
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribe) {
      unsubscribe();
    }
  }

  private progress(xp: number, reputation: number): void {
    const levelBefore = this.level;
    this.xpTotal += Math.max(0, xp);
    this.reputationTotal = Math.max(0, this.reputationTotal + reputation);
    const level = this.level;
    this.events.emit('CompanyProgressed', { xp: this.xpTotal, level, reputation: this.reputationTotal });
    if (level > levelBefore) {
      this.logger.info(`Company level ${level}.`);
      this.events.emit('CompanyLevelUp', { level });
    }
  }
}
