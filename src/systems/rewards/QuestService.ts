import type { EventBus, Unsubscribe } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import { err, ok, type Result } from '../../core/Result';
import type { Clock } from '../../core/time/Clock';
import type { ContentCatalog } from '../../data/ContentCatalog';
import type { CrateTier } from '../../data/definitions/CrateTier';
import { QUEST_METRICS, type QuestDefinition, type QuestMetric } from '../../data/definitions/QuestDefinition';
import { deliveryStars, isPerfectDelivery } from '../../domain/missions/deliveryStars';
import { dailyQuests } from '../../domain/rewards/dailyQuests';
import { localDay } from '../../domain/rewards/dailyReward';
import type { QuestsSaveData } from '../../domain/save/SaveGameData';
import type { GameEvents } from '../GameEvents';
import type { CrateGranter } from '../company/LevelRewardService';

/** A quest of the day, as it stands. */
export interface QuestView {
  readonly definition: QuestDefinition;
  /** How far the day has come toward its target (at most the target). */
  readonly progress: number;
  readonly done: boolean;
  readonly claimed: boolean;
}

export type ClaimQuestError = 'unknownQuest' | 'notDone' | 'claimed';

/**
 * The daily quests: each of the player's days (their own midnight, as the
 * daily reward's) brings three from the pool (dailyQuests), counted from the
 * day's start: deliveries, perfect ones, on time, kilometres, credits
 * earned, fill-ups, tenders won. Each one done brings its crate once
 * collected; all of them collected, a bonus crate (GameConfig.crates). The
 * day's counts are in the save; a new day starts them over.
 */
export class QuestService {
  private day: number | null = null;
  private counts: Record<string, number> = {};
  private distanceStart = 0;
  private claimedIds = new Set<string>();
  private bonusTaken = false;
  /** The day's quests already announced done. */
  private announced = new Set<string>();
  private readonly unsubscribe: Unsubscribe[];

  constructor(
    private readonly content: ContentCatalog,
    private readonly crates: CrateGranter,
    /** The bonus crate for all of the day's quests. */
    private readonly bonusCrate: CrateTier,
    private readonly clock: Clock,
    private readonly localTimeOffsetMinutes: number,
    /** Metres the company's trucks were driven by the player, ever (the session's); null while no company is loaded. */
    private readonly distanceMeters: () => number | null,
    private readonly events: EventBus<GameEvents>,
    private readonly logger: Logger,
  ) {
    this.unsubscribe = [
      events.on('MissionCompleted', ({ reward, cargoDamage }) => {
        this.add('deliveries', 1);
        if (reward.onTime) {
          this.add('onTimeDeliveries', 1);
        }
        if (isPerfectDelivery(deliveryStars(reward.onTime, cargoDamage))) {
          this.add('perfectDeliveries', 1);
        }
        this.add('creditsEarned', reward.total);
      }),
      events.on('Refuelled', () => this.add('refuels', 1)),
      events.on('TenderDecided', ({ won }) => {
        if (won) {
          this.add('tendersWon', 1);
        }
      }),
      // The kilometres may have finished a quest: checked as the player leaves the road for a menu, and back.
      events.on('GameStateChanged', () => this.announce()),
    ];
  }

  /** Today's quests, with how far each has come. */
  get quests(): readonly QuestView[] {
    this.roll();
    return this.today().map((definition) => this.viewOf(definition));
  }

  /** The bonus crate for all of today's quests: whether they are all collected, and whether it was. */
  get bonus(): { readonly crate: CrateTier; readonly ready: boolean; readonly claimed: boolean } {
    const quests = this.quests;
    return { crate: this.bonusCrate, ready: quests.every((quest) => quest.claimed), claimed: this.bonusTaken };
  }

  /** Crates waiting to be collected: quests done and not collected, and the bonus once ready. */
  get claimable(): number {
    const bonus = this.bonus;
    return this.quests.filter((quest) => quest.done && !quest.claimed).length + (bonus.ready && !bonus.claimed ? 1 : 0);
  }

  /** Collects a done quest's crate. Returns its tier. */
  claim(questId: string): Result<CrateTier, ClaimQuestError> {
    const view = this.quests.find((quest) => quest.definition.id === questId);
    if (view === undefined) {
      return err('unknownQuest');
    }
    if (view.claimed) {
      return err('claimed');
    }
    if (!view.done) {
      return err('notDone');
    }
    this.claimedIds.add(questId);
    this.crates.grant(view.definition.crate, 'quest');
    this.logger.info(`Quest ${questId} collected: a ${view.definition.crate} crate.`);
    this.events.emit('QuestsChanged', { day: this.day ?? 0 });
    return ok(view.definition.crate);
  }

  /** Collects the bonus crate for all of today's quests. */
  claimBonus(): Result<CrateTier, 'notDone' | 'claimed'> {
    const bonus = this.bonus;
    if (bonus.claimed) {
      return err('claimed');
    }
    if (!bonus.ready) {
      return err('notDone');
    }
    this.bonusTaken = true;
    this.crates.grant(this.bonusCrate, 'quest');
    this.events.emit('QuestsChanged', { day: this.day ?? 0 });
    return ok(this.bonusCrate);
  }

  snapshot(): QuestsSaveData {
    this.roll();
    return {
      day: this.day,
      counts: { ...this.counts },
      distanceStartMeters: Number.isNaN(this.distanceStart) ? (this.distanceMeters() ?? 0) : this.distanceStart,
      claimed: [...this.claimedIds],
      bonusClaimed: this.bonusTaken,
    };
  }

  restore(save: QuestsSaveData): void {
    this.day = save.day;
    const counts: Record<string, number> = {};
    for (const metric of QUEST_METRICS) {
      const value = save.counts[metric];
      if (value !== undefined && value > 0) {
        counts[metric] = value;
      }
    }
    this.counts = counts;
    this.distanceStart = save.distanceStartMeters;
    this.claimedIds = new Set(save.claimed.filter((id) => this.content.quests.has(id)));
    this.bonusTaken = save.bonusClaimed;
    this.roll();
    // What a loaded game had done is not announced again.
    this.announced = new Set(this.quests.filter((quest) => quest.done).map((quest) => quest.definition.id));
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribe) {
      unsubscribe();
    }
  }

  private today(): QuestDefinition[] {
    return dailyQuests(this.content.quests.all, this.day ?? 0);
  }

  private viewOf(definition: QuestDefinition): QuestView {
    const progress = Math.min(definition.target, this.value(definition.metric));
    return { definition, progress, done: progress >= definition.target, claimed: this.claimedIds.has(definition.id) };
  }

  private value(metric: QuestMetric): number {
    if (metric === 'distanceKm') {
      const driven = this.distanceMeters();
      if (driven === null) {
        return 0;
      }
      // The day began while no company was loaded: its kilometres count from now.
      if (Number.isNaN(this.distanceStart)) {
        this.distanceStart = driven;
      }
      return Math.floor(Math.max(0, driven - this.distanceStart) / 1000);
    }
    return this.counts[metric] ?? 0;
  }

  /** A new day: its quests start from nothing. */
  private roll(): void {
    const today = localDay(this.clock.now(), this.localTimeOffsetMinutes);
    if (this.day === today) {
      return;
    }
    this.day = today;
    this.counts = {};
    this.distanceStart = this.distanceMeters() ?? Number.NaN;
    this.claimedIds = new Set();
    this.bonusTaken = false;
    this.announced = new Set();
    this.events.emit('QuestsChanged', { day: this.day ?? 0 });
  }

  private add(metric: QuestMetric, amount: number): void {
    this.roll();
    this.counts = { ...this.counts, [metric]: (this.counts[metric] ?? 0) + amount };
    this.announce();
  }

  /** Announces each of the day's quests once, as it is done. */
  private announce(): void {
    let any = false;
    for (const quest of this.quests) {
      if (quest.done && !this.announced.has(quest.definition.id)) {
        this.announced.add(quest.definition.id);
        this.events.emit('QuestCompleted', { questId: quest.definition.id });
        any = true;
      }
    }
    if (any) {
      this.events.emit('QuestsChanged', { day: this.day ?? 0 });
    }
  }
}
