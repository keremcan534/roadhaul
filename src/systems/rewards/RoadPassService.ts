import { err, ok, type Result } from '../../core/Result';
import type { EventBus, Unsubscribe } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import type { Clock } from '../../core/time/Clock';
import type { GameConfig, PassReward } from '../../data/config/GameConfig';
import type { ProductId } from '../../data/config/products';
import type { ContentCatalog } from '../../data/ContentCatalog';
import type { BoosterKind } from '../../data/definitions/BoosterKind';
import type { CrateTier } from '../../data/definitions/CrateTier';
import type { PaintDefinition } from '../../data/definitions/PaintDefinition';
import { localDay } from '../../domain/rewards/dailyReward';
import type { RoadPassSaveData } from '../../domain/save/SaveGameData';
import type { EconomyService } from '../economy/EconomyService';
import type { CrateSource, GameEvents } from '../GameEvents';

const DAY_MS = 86_400_000;

export type ClaimPassError = 'unknownTier' | 'notReached' | 'claimed' | 'noPass' | 'noReward';

/** A tier of the season's pass: what reaching it takes and gives, on both tracks. */
export interface PassTier {
  /** 1 for the first. */
  readonly tier: number;
  /** Points the season needs for it, all told. */
  readonly points: number;
  readonly reached: boolean;
  readonly free: PassReward;
  readonly freeClaimed: boolean;
  /** Road Pass Plus's colour on this tier, or null for none. */
  readonly premium: PaintDefinition | null;
  readonly premiumClaimed: boolean;
}

/** What the pass gives through: CrateService, SupplyService, MonetizationService. */
export interface PassCrates {
  grant(tier: CrateTier, source: CrateSource): void;
}
export interface PassSupplies {
  add(parts: number, booster: BoosterKind | null): void;
}
export interface PassPurchases {
  owns(id: ProductId): boolean;
}

/** The product that opens the pass's second track: cosmetics only. */
export const ROAD_PASS_PRODUCT: ProductId = 'road_pass';

/**
 * The Road Pass: seasons of four weeks (GameConfig.roadPass) on the
 * player's calendar, each a ladder of tiers climbed with points from the
 * company's own deliveries (by their pay) and the day's quests done. Each
 * tier reached gives its free reward (credits, a crate, upgrade parts, a
 * booster) once collected. Road Pass Plus (a purchase, ROAD_PASS_PRODUCT,
 * kept for every season) adds a second track of the season's own colours on
 * some tiers: looks only, never anything that speeds the game. A new season
 * starts the points and the tiers again; the colours collected stay the
 * company's for good. In the save.
 */
export class RoadPassService {
  private season = Number.NaN;
  private points = 0;
  private freeClaimed = new Set<number>();
  private premiumClaimed = new Set<number>();
  private paints = new Set<string>();
  private readonly unsubscribe: Unsubscribe[];

  constructor(
    private readonly content: ContentCatalog,
    private readonly economy: EconomyService,
    private readonly crates: PassCrates,
    private readonly supplies: PassSupplies,
    private readonly purchases: PassPurchases,
    private readonly clock: Clock,
    private readonly localOffsetMinutes: number,
    private readonly config: GameConfig['roadPass'],
    private readonly events: EventBus<GameEvents>,
    private readonly logger: Logger,
  ) {
    this.unsubscribe = [
      events.on('MissionCompleted', ({ reward }) =>
        this.score(Math.max(config.leastDeliveryPoints, Math.round(reward.total / config.creditsPerPoint))),
      ),
      events.on('QuestCompleted', () => this.score(config.questPoints)),
    ];
  }

  /** The season it is now: 0 the first, from GameConfig.roadPass.firstSeasonDay on. */
  get currentSeason(): number {
    const day = localDay(this.clock.now(), this.localOffsetMinutes);
    return Math.max(0, Math.floor((day - this.config.firstSeasonDay) / this.config.seasonDays));
  }

  /** Milliseconds until this season ends. */
  get endsInMs(): number {
    const endDay = this.config.firstSeasonDay + (this.currentSeason + 1) * this.config.seasonDays;
    return Math.max(0, endDay * DAY_MS - this.localOffsetMinutes * 60_000 - this.clock.now());
  }

  /** The season's points (none yet if the season turned since update() last ran). */
  get seasonPoints(): number {
    return this.season === this.currentSeason ? this.points : 0;
  }

  /** How many tiers the season's points reach. */
  get tierReached(): number {
    return Math.min(this.config.freeRewards.length, Math.floor(this.seasonPoints / this.config.pointsPerTier));
  }

  /** Road Pass Plus is the company's. */
  get plus(): boolean {
    return this.purchases.owns(ROAD_PASS_PRODUCT);
  }

  /** Rewards reached and waiting to be collected (Plus's only with Plus). */
  get claimable(): number {
    return this.tiers().reduce(
      (count, tier) => count + (tier.reached && !tier.freeClaimed ? 1 : 0) + (tier.reached && this.plus && tier.premium !== null && !tier.premiumClaimed ? 1 : 0),
      0,
    );
  }

  /** Every tier of the season, the first first. */
  tiers(): PassTier[] {
    const reached = this.tierReached;
    const current = this.season === this.currentSeason;
    const premium = this.seasonPaints(this.currentSeason);
    return this.config.freeRewards.map((free, index) => {
      const tier = index + 1;
      const premiumIndex = this.config.premiumTiers.indexOf(tier);
      return {
        tier,
        points: tier * this.config.pointsPerTier,
        reached: tier <= reached,
        free,
        freeClaimed: current && this.freeClaimed.has(tier),
        premium: premiumIndex < 0 ? null : (premium[premiumIndex] ?? null),
        premiumClaimed: current && this.premiumClaimed.has(tier),
      };
    });
  }

  /** Whether the company has collected the pass colour `paintId` (it keeps it for good). */
  ownsPassPaint(paintId: string): boolean {
    return this.paints.has(paintId);
  }

  /** Collects tier `tier`'s free reward. */
  claimFree(tier: number): Result<PassReward, ClaimPassError> {
    this.update();
    const view = this.tiers()[tier - 1];
    if (view === undefined) {
      return err('unknownTier');
    }
    if (!view.reached) {
      return err('notReached');
    }
    if (view.freeClaimed) {
      return err('claimed');
    }
    this.freeClaimed.add(tier);
    this.give(view.free);
    this.logger.info(`Road Pass tier ${tier}: ${view.free.kind}.`);
    this.events.emit('RoadPassClaimed', { tier, premium: false });
    return ok(view.free);
  }

  /** Collects tier `tier`'s Road Pass Plus colour. */
  claimPremium(tier: number): Result<PaintDefinition, ClaimPassError> {
    this.update();
    const view = this.tiers()[tier - 1];
    if (view === undefined) {
      return err('unknownTier');
    }
    if (view.premium === null) {
      return err('noReward');
    }
    if (!this.plus) {
      return err('noPass');
    }
    if (!view.reached) {
      return err('notReached');
    }
    if (view.premiumClaimed) {
      return err('claimed');
    }
    this.premiumClaimed.add(tier);
    this.paints.add(view.premium.id);
    this.logger.info(`Road Pass Plus tier ${tier}: ${view.premium.id}.`);
    this.events.emit('RoadPassClaimed', { tier, premium: true });
    return ok(view.premium);
  }

  /** Checks for a new season: the points and the tiers start again. Cheap to call every step. */
  update(): void {
    const season = this.currentSeason;
    if (season === this.season) {
      return;
    }
    this.season = season;
    this.points = 0;
    this.freeClaimed = new Set();
    this.premiumClaimed = new Set();
  }

  snapshot(): RoadPassSaveData {
    return {
      season: Number.isNaN(this.season) ? null : this.season,
      points: this.points,
      freeClaimed: [...this.freeClaimed].sort((a, b) => a - b),
      premiumClaimed: [...this.premiumClaimed].sort((a, b) => a - b),
      paints: this.content.paints.all.filter((paint) => this.paints.has(paint.id)).map((paint) => paint.id),
    };
  }

  /** Takes up a loaded or new game's pass: colours the content no longer has are dropped. */
  restore(data: RoadPassSaveData): void {
    this.season = data.season ?? Number.NaN;
    this.points = data.points;
    this.freeClaimed = new Set(data.freeClaimed);
    this.premiumClaimed = new Set(data.premiumClaimed);
    this.paints = new Set(data.paints.filter((id) => this.content.paints.find(id)?.pass !== undefined));
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribe) {
      unsubscribe();
    }
  }

  /** Season `season`'s colours, in content order: the pass colours of its group (the groups take turns). */
  private seasonPaints(season: number): PaintDefinition[] {
    const groups = new Set(this.content.paints.all.filter((paint) => paint.pass !== undefined).map((paint) => paint.pass!));
    if (groups.size === 0) {
      return [];
    }
    const group = [...groups].sort((a, b) => a - b)[season % groups.size]!;
    return this.content.paints.all.filter((paint) => paint.pass === group);
  }

  private score(points: number): void {
    this.update();
    const before = this.tierReached;
    this.points += points;
    const after = this.tierReached;
    if (after > before) {
      this.events.emit('RoadPassTierReached', { tier: after });
    }
  }

  private give(reward: PassReward): void {
    switch (reward.kind) {
      case 'credits':
        this.economy.earn(reward.amount, 'roadPass');
        break;
      case 'crate':
        this.crates.grant(reward.tier, 'roadPass');
        break;
      case 'parts':
        this.supplies.add(reward.amount, null);
        break;
      case 'booster':
        this.supplies.add(0, reward.booster);
        break;
    }
  }
}
