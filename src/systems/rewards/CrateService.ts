import type { EventBus, Unsubscribe } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import { err, ok, type Result } from '../../core/Result';
import type { Clock } from '../../core/time/Clock';
import type { ContentCatalog } from '../../data/ContentCatalog';
import type { BoosterKind } from '../../data/definitions/BoosterKind';
import { CRATE_TIERS, isCrateTier, type CrateTier, type GameConfig } from '../../data/config/GameConfig';
import { deliveryStars, isPerfectDelivery, type DeliveryStars } from '../../domain/missions/deliveryStars';
import {
  drawCrate,
  freeCrateTier,
  nextStreakCrate,
  streakCrate,
  type CratePaint,
  type CrateContents,
} from '../../domain/rewards/crates';
import type { CratesSaveData } from '../../domain/save/SaveGameData';
import type { EconomyService } from '../economy/EconomyService';
import type { CrateSource, GameEvents } from '../GameEvents';

export type OpenCrateError = 'noCrate';
export type FreeCrateError = 'notReady';

/** Keeps what crates give besides credits and looks: SupplyService. */
export interface SupplyKeeper {
  add(parts: number, booster: BoosterKind | null): void;
}

/** The free crate: ready now, or when. */
export interface FreeCrateView {
  readonly ready: boolean;
  /** When it is ready, epoch ms (in the past once it is). */
  readonly readyAtMs: number;
}

/** What the last delivery did for the perfect streak, for its result to show. */
export interface DeliveryCelebration {
  readonly stars: DeliveryStars;
  /** Perfect deliveries in a row with this one: 0 when it broke the streak. */
  readonly streak: number;
  readonly best: number;
  /** The crate this delivery's streak earned, or null. */
  readonly crate: CrateTier | null;
  /** The next crate the streak earns: how many more perfect deliveries, and which. */
  readonly next: { readonly deliveries: number; readonly tier: CrateTier };
}

/** A crate colour, owned or not: the garage shows those not got yet locked. */
export interface CratePaintSource {
  ownsCratePaint(paintId: string): boolean;
}

/** None owned: a garage without crates (tests). */
export const NO_CRATE_PAINTS: CratePaintSource = { ownsCratePaint: () => false };

/**
 * The company's crates (GameConfig.crates): earned, never sold, waiting in
 * the crates' slots until opened, at once, for credits and, now and then,
 * upgrade parts, a booster (both to SupplyService) or one of the colours
 * only crates hold (PaintDefinition.crate), each given once. A crate comes
 * for a streak of perfect deliveries (three stars: on time, cargo
 * flawless), which this service keeps; for a company level, through
 * LevelRewardService; with each day's daily reward (a better one on its
 * last day); for the day's quests (QuestService); for a rewarded ad the
 * player asks for (MonetizationService); and free every few hours, waiting
 * until collected. The crates held, the colours given, the streak and when
 * the free crate is next ready are in the save.
 *
 * It subscribes to MissionCompleted when created at boot, before the UI:
 * the result reads `lastDelivery` already updated.
 */
export class CrateService implements CratePaintSource {
  private readonly held: Record<CrateTier, number> = { bronze: 0, silver: 0, gold: 0 };
  private openedCount = 0;
  private readonly paints = new Set<string>();
  private readonly liveries = new Set<string>();
  private streak = 0;
  private best = 0;
  private last: DeliveryCelebration | null = null;
  private freeAtMs = 0;
  private readonly cratePaints: readonly CratePaint[];
  private readonly unsubscribe: Unsubscribe[];

  constructor(
    private readonly config: GameConfig['crates'],
    content: ContentCatalog,
    private readonly economy: EconomyService,
    private readonly supplies: SupplyKeeper,
    private readonly clock: Clock,
    /** Uniform in [0, 1): a seeded generator in tests. */
    private readonly random: () => number,
    /** The daily reward's last day (GameConfig.dailyReward.credits' length): its claim brings a better crate. */
    private readonly lastDailyDay: number,
    private readonly events: EventBus<GameEvents>,
    private readonly logger: Logger,
  ) {
    this.cratePaints = [
      ...content.paints.all.flatMap((paint) => (paint.crate === undefined ? [] : [{ id: paint.id, rarity: paint.crate }])),
      ...content.liveries.all.flatMap((livery) =>
        livery.crate === undefined ? [] : [{ id: livery.id, rarity: livery.crate, kind: 'livery' as const }],
      ),
    ];
    this.unsubscribe = [
      events.on('MissionCompleted', ({ reward, cargoDamage }) => this.delivered(deliveryStars(reward.onTime, cargoDamage))),
      events.on('MissionFailed', () => {
        this.streak = 0;
        this.last = null;
      }),
      events.on('DailyRewardClaimed', ({ day }) => {
        if (day === this.lastDailyDay) {
          this.grant(this.config.dailyStreakCrate, 'dailyStreak');
        } else {
          this.grant(this.config.dailyCrate, 'daily');
        }
      }),
    ];
  }

  /** Crates of `tier` waiting to be opened. */
  count(tier: CrateTier): number {
    return this.held[tier];
  }

  /** Crates of every tier waiting to be opened. */
  get total(): number {
    return this.held.bronze + this.held.silver + this.held.gold;
  }

  /** Crates opened, ever. */
  get opened(): number {
    return this.openedCount;
  }

  get perfectStreak(): number {
    return this.streak;
  }

  get bestPerfectStreak(): number {
    return this.best;
  }

  /** The last delivery's stars and what they did for the streak; null before one, or after a failure. */
  get lastDelivery(): DeliveryCelebration | null {
    return this.last;
  }

  /** The crate colours and designs, and how many of them the crates have given. */
  get paintsGot(): { readonly got: number; readonly of: number } {
    return { got: this.paints.size + this.liveries.size, of: this.cratePaints.length };
  }

  ownsCratePaint(paintId: string): boolean {
    return this.paints.has(paintId);
  }

  ownsCrateLivery(liveryId: string): boolean {
    return this.liveries.has(liveryId);
  }

  /** The free crate: ready now, or when. */
  get freeCrate(): FreeCrateView {
    return { ready: this.clock.now() >= this.freeAtMs, readyAtMs: this.freeAtMs };
  }

  /** Collects the free crate, its tier drawn by its weights; the next is ready some hours on. */
  claimFreeCrate(): Result<CrateTier, FreeCrateError> {
    const now = this.clock.now();
    if (now < this.freeAtMs) {
      return err('notReady');
    }
    const tier = freeCrateTier(this.random(), this.config.freeCrateWeights);
    this.freeAtMs = now + this.config.freeCrateHours * 3_600_000;
    this.grant(tier, 'free');
    return ok(tier);
  }

  /** A crate of `tier` comes to the company. */
  grant(tier: CrateTier, source: CrateSource): void {
    this.held[tier] += 1;
    this.logger.info(`Crate earned: ${tier} (${source}).`);
    this.events.emit('CrateEarned', { tier, source });
  }

  /** Opens a crate of `tier`: pays its credits and gives its colour, if it holds one. */
  open(tier: CrateTier): Result<CrateContents, OpenCrateError> {
    if (this.held[tier] <= 0) {
      return err('noCrate');
    }
    const unowned = this.cratePaints.filter((paint) => !this.paints.has(paint.id) && !this.liveries.has(paint.id));
    const contents = drawCrate(this.config.tiers[tier], unowned, this.random, this.config.boosters.weights);
    this.held[tier] -= 1;
    this.openedCount += 1;
    if (contents.paintId !== null) {
      this.paints.add(contents.paintId);
    }
    if (contents.liveryId !== null) {
      this.liveries.add(contents.liveryId);
    }
    this.economy.earn(contents.credits, 'crate');
    this.supplies.add(contents.parts, contents.booster);
    this.logger.info(`Crate opened: ${tier}, ${contents.credits} credits${contents.paintId === null ? '' : `, ${contents.paintId}`}.`);
    this.events.emit('CrateOpened', { tier, credits: contents.credits, paintId: contents.paintId, liveryId: contents.liveryId });
    return ok(contents);
  }

  snapshot(): CratesSaveData {
    const held: Record<string, number> = {};
    for (const tier of CRATE_TIERS) {
      if (this.held[tier] > 0) {
        held[tier] = this.held[tier];
      }
    }
    return {
      held,
      opened: this.openedCount,
      paints: [...this.paints],
      liveries: [...this.liveries],
      perfectStreak: this.streak,
      bestPerfectStreak: this.best,
      freeCrateAtMs: this.freeAtMs,
    };
  }

  /** A crate colour the content no longer has is dropped. */
  restore(save: CratesSaveData): void {
    for (const tier of CRATE_TIERS) {
      this.held[tier] = 0;
    }
    for (const [tier, count] of Object.entries(save.held)) {
      if (isCrateTier(tier)) {
        this.held[tier] = count;
      }
    }
    this.openedCount = save.opened;
    this.paints.clear();
    for (const id of save.paints) {
      if (this.cratePaints.some((paint) => paint.id === id && paint.kind !== 'livery')) {
        this.paints.add(id);
      }
    }
    this.liveries.clear();
    for (const id of save.liveries) {
      if (this.cratePaints.some((paint) => paint.id === id && paint.kind === 'livery')) {
        this.liveries.add(id);
      }
    }
    this.streak = save.perfectStreak;
    this.best = Math.max(save.bestPerfectStreak, save.perfectStreak);
    this.freeAtMs = save.freeCrateAtMs;
    this.last = null;
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribe) {
      unsubscribe();
    }
  }

  private delivered(stars: DeliveryStars): void {
    this.streak = isPerfectDelivery(stars) ? this.streak + 1 : 0;
    this.best = Math.max(this.best, this.streak);
    const crate = isPerfectDelivery(stars) ? streakCrate(this.streak, this.config.perfectStreak) : null;
    this.last = { stars, streak: this.streak, best: this.best, crate, next: nextStreakCrate(this.streak, this.config.perfectStreak) };
    if (crate !== null) {
      this.grant(crate, 'perfectStreak');
    }
  }
}
