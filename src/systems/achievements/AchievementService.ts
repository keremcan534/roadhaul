import type { EventBus, Unsubscribe } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import { err, ok, type Result } from '../../core/Result';
import type { ContentCatalog } from '../../data/ContentCatalog';
import type { AchievementDefinition, AchievementMetric } from '../../data/definitions/AchievementDefinition';
import type { Credits } from '../../data/units';
import type { AchievementsSaveData } from '../../domain/save/SaveGameData';
import type { EconomyService } from '../economy/EconomyService';
import type { GameEvents } from '../GameEvents';

/** How far the company has come, read from the services that keep it (AchievementService asks as it checks). */
export interface CompanyMeasures {
  readonly deliveries: number;
  readonly distanceMeters: number;
  readonly companyLevel: number;
  readonly trucksOwned: number;
  readonly driversHired: number;
  readonly facilityLevels: number;
  readonly creditsEarned: Credits;
}

/** The metrics the goals count themselves (the save keeps them): the rest are measured (CompanyMeasures). */
const COUNTED: readonly AchievementMetric[] = ['perfectDeliveries', 'tendersWon', 'rivalsBoughtOut', 'dailyStreak', 'upgradesFitted', 'bigWins'];

/** A multiplier the slot machine pays this high or more is a big win. */
const BIG_WIN_MULTIPLIER = 10;

/** A goal as the company stands. */
export interface AchievementView {
  readonly definition: AchievementDefinition;
  /** Toward the target, at most the target. */
  readonly progress: number;
  /** The target is reached. */
  readonly reached: boolean;
  /** Its reward was collected. */
  readonly claimed: boolean;
}

export type ClaimAchievementError = 'unknownAchievement' | 'notReached' | 'claimed';

/**
 * The company's goals (AchievementDefinition): each counts one metric up to
 * its target, then its reward waits to be collected. What the rest of the
 * game keeps (deliveries, distance, level, garage, drivers, facilities,
 * earnings) is measured from it; the rest is counted here from the game's
 * events and saved. A goal reached is announced once (`AchievementReached`);
 * the goals already reached when a game is loaded are not.
 */
export class AchievementService {
  private counters: Record<string, number> = {};
  private claimedIds = new Set<string>();
  /** Goals known to be reached: a newly reached one is announced. */
  private reachedIds = new Set<string>();
  private readonly unsubscribe: Unsubscribe[];

  constructor(
    private readonly content: ContentCatalog,
    private readonly economy: EconomyService,
    private readonly measure: () => CompanyMeasures,
    private readonly events: EventBus<GameEvents>,
    private readonly logger: Logger,
  ) {
    const check = (): void => this.check();
    this.unsubscribe = [
      events.on('MissionCompleted', ({ cargoDamage }) => {
        if (cargoDamage === 0) {
          this.add('perfectDeliveries', 1);
        }
        this.check();
      }),
      events.on('TenderDecided', ({ won }) => {
        if (won) {
          this.add('tendersWon', 1);
        }
        this.check();
      }),
      events.on('RivalAcquired', () => {
        this.add('rivalsBoughtOut', 1);
        this.check();
      }),
      events.on('DailyRewardClaimed', ({ streak }) => {
        this.counters = { ...this.counters, dailyStreak: Math.max(this.counted('dailyStreak'), streak) };
        this.check();
      }),
      events.on('UpgradePurchased', () => {
        this.add('upgradesFitted', 1);
        this.check();
      }),
      events.on('SlotSpun', ({ multiplier }) => {
        if (multiplier >= BIG_WIN_MULTIPLIER) {
          this.add('bigWins', 1);
          this.check();
        }
      }),
      events.on('CompanyLevelUp', check),
      events.on('VehiclePurchased', check),
      events.on('DriverHired', check),
      events.on('FacilityBuilt', check),
      events.on('GameStateChanged', check),
    ];
  }

  /** Every goal, in content order, with how far the company has come. */
  list(): readonly AchievementView[] {
    const values = this.values();
    return this.content.achievements.all.map((definition) => this.viewOf(definition, values));
  }

  /** Goals reached whose reward waits. */
  get claimable(): number {
    let count = 0;
    for (const view of this.list()) {
      if (view.reached && !view.claimed) {
        count += 1;
      }
    }
    return count;
  }

  /** Collects a reached goal's reward. Returns what it paid. */
  claim(achievementId: string): Result<Credits, ClaimAchievementError> {
    const definition = this.content.achievements.find(achievementId);
    if (definition === undefined) {
      return err('unknownAchievement');
    }
    const view = this.viewOf(definition, this.values());
    if (view.claimed) {
      return err('claimed');
    }
    if (!view.reached) {
      return err('notReached');
    }
    this.claimedIds.add(achievementId);
    this.economy.earn(definition.reward, 'achievement');
    this.logger.info(`Goal ${achievementId} collected: ${definition.reward}.`);
    this.events.emit('AchievementClaimed', { achievementId, reward: definition.reward });
    return ok(definition.reward);
  }

  snapshot(): AchievementsSaveData {
    return { counters: { ...this.counters }, claimed: [...this.claimedIds] };
  }

  /** Takes up a loaded or new game's goals; those reached already are not announced again. */
  restore(data: AchievementsSaveData): void {
    const counters: Record<string, number> = {};
    for (const metric of COUNTED) {
      const value = data.counters[metric];
      if (value !== undefined && value > 0) {
        counters[metric] = value;
      }
    }
    this.counters = counters;
    this.claimedIds = new Set(data.claimed.filter((id) => this.content.achievements.has(id)));
    this.reachedIds = new Set(this.list().filter((view) => view.reached).map((view) => view.definition.id));
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribe) {
      unsubscribe();
    }
  }

  /** Announces the goals reached since the last check. */
  private check(): void {
    for (const view of this.list()) {
      if (view.reached && !this.reachedIds.has(view.definition.id)) {
        this.reachedIds.add(view.definition.id);
        this.events.emit('AchievementReached', { achievementId: view.definition.id });
      }
    }
  }

  private add(metric: AchievementMetric, amount: number): void {
    this.counters = { ...this.counters, [metric]: this.counted(metric) + amount };
  }

  private counted(metric: AchievementMetric): number {
    return this.counters[metric] ?? 0;
  }

  /** Each metric's value now. */
  private values(): Readonly<Record<AchievementMetric, number>> {
    const measures = this.measure();
    return {
      deliveries: measures.deliveries,
      perfectDeliveries: this.counted('perfectDeliveries'),
      distanceKm: Math.floor(measures.distanceMeters / 1000),
      companyLevel: measures.companyLevel,
      trucksOwned: measures.trucksOwned,
      driversHired: measures.driversHired,
      facilityLevels: measures.facilityLevels,
      creditsEarned: measures.creditsEarned,
      tendersWon: this.counted('tendersWon'),
      rivalsBoughtOut: this.counted('rivalsBoughtOut'),
      dailyStreak: this.counted('dailyStreak'),
      upgradesFitted: this.counted('upgradesFitted'),
      bigWins: this.counted('bigWins'),
    };
  }

  private viewOf(definition: AchievementDefinition, values: Readonly<Record<AchievementMetric, number>>): AchievementView {
    const value = values[definition.metric];
    return {
      definition,
      progress: Math.min(value, definition.target),
      reached: value >= definition.target,
      claimed: this.claimedIds.has(definition.id),
    };
  }
}
