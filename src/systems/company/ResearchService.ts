import type { EventBus, Unsubscribe } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import { err, ok, type Result } from '../../core/Result';
import type { ContentCatalog } from '../../data/ContentCatalog';
import type { GameConfig } from '../../data/config/GameConfig';
import type { FacilityEffect } from '../../data/definitions/FacilityDefinition';
import type { ResearchDefinition } from '../../data/definitions/ResearchDefinition';
import type { Credits } from '../../data/units';
import { NO_PERKS, type FacilityPerks } from '../../domain/company/facilities';
import type { SpendError } from '../../domain/economy/CurrencyWallet';
import { deliveryStars, isPerfectDelivery } from '../../domain/missions/deliveryStars';
import type { ResearchSaveData } from '../../domain/save/SaveGameData';
import type { EconomyService } from '../economy/EconomyService';
import type { GameEvents } from '../GameEvents';
import type { CompanyLevelSource } from '../missions/MissionService';
import type { CompanyPerks } from './CompanyPerks';

export type ResearchError = 'unknownResearch' | 'researched' | 'needsPrevious' | 'locked' | 'notEnoughPoints' | SpendError;

/** Where a research stands: done, open to research, waiting for the tier before it, or for a company level. */
export type ResearchState = 'researched' | 'available' | 'needsPrevious' | 'locked';

/** A step of the research tree as the head office shows it. */
export interface ResearchOffer {
  readonly definition: ResearchDefinition;
  readonly state: ResearchState;
}

/** What research did for the delivery just made, for its result. */
export interface ResearchedDelivery {
  /** Credits the research's pay bonus added: 0 for none. */
  readonly pay: Credits;
  /** Research points the delivery earned. */
  readonly points: number;
}

const NOTHING_RESEARCHED: ResearchedDelivery = Object.freeze({ pay: 0, points: 0 });

/**
 * The research tree (ResearchDefinition): the company's own deliveries earn
 * research points, a perfect one more (GameConfig.research); a step costs
 * points and credits, needs the tier before it in its branch and its company
 * level, and gives the whole company its perk for good (CompanyPerks, added
 * to the facilities'). The pay bonus it brings is paid here, on top of each
 * delivery. All of it is in the save.
 *
 * It subscribes to MissionCompleted at boot, after the economy (the delivery
 * paid first) and before the UI: the result reads `lastDelivery` already
 * updated.
 */
export class ResearchService {
  private pointsHeld = 0;
  private done = new Set<string>();
  private last: ResearchedDelivery = NOTHING_RESEARCHED;
  private readonly unsubscribe: Unsubscribe;

  constructor(
    private readonly content: ContentCatalog,
    private readonly config: GameConfig['research'],
    private readonly economy: EconomyService,
    private readonly company: CompanyLevelSource,
    private readonly companyPerks: CompanyPerks,
    private readonly events: EventBus<GameEvents>,
    private readonly logger: Logger,
  ) {
    this.unsubscribe = events.on('MissionCompleted', ({ reward, cargoDamage }) =>
      this.delivered(reward.total, isPerfectDelivery(deliveryStars(reward.onTime, cargoDamage))),
    );
  }

  /** Research points held. */
  get points(): number {
    return this.pointsHeld;
  }

  /** What research gives the company now, all together (the facilities aside). */
  get perks(): FacilityPerks {
    return this.companyPerks.of('research');
  }

  /** What research did for the delivery just made. */
  get lastDelivery(): ResearchedDelivery {
    return this.last;
  }

  /** Whether `researchId` is researched. */
  has(researchId: string): boolean {
    return this.done.has(researchId);
  }

  /** How many steps are researched, of how many. */
  get progress(): { readonly researched: number; readonly total: number } {
    return { researched: this.done.size, total: this.content.research.all.length };
  }

  /** Steps that could be researched now with the points held and `credits`: for the company page's dot. */
  readyCount(credits: Credits): number {
    let count = 0;
    for (const definition of this.content.research.all) {
      if (this.stateOf(definition) === 'available' && definition.points <= this.pointsHeld && definition.cost <= credits) {
        count++;
      }
    }
    return count;
  }

  /** Every step, in content order, with where it stands. */
  offers(): readonly ResearchOffer[] {
    return this.content.research.all.map((definition) => ({ definition, state: this.stateOf(definition) }));
  }

  /** Researches `researchId`, paying its points and credits. */
  research(researchId: string): Result<ResearchDefinition, ResearchError> {
    const definition = this.content.research.find(researchId);
    if (definition === undefined) {
      return err('unknownResearch');
    }
    const state = this.stateOf(definition);
    if (state !== 'available') {
      return err(state);
    }
    if (this.pointsHeld < definition.points) {
      return err('notEnoughPoints');
    }
    if (definition.cost > 0) {
      const paid = this.economy.spend(definition.cost, 'research');
      if (!paid.ok) {
        return err(paid.error);
      }
    }
    this.pointsHeld -= definition.points;
    this.done = new Set([...this.done, researchId]);
    this.update();
    this.logger.info(`Researched ${researchId} for ${definition.points} points and ${definition.cost}.`);
    this.events.emit('ResearchCompleted', { researchId, points: this.pointsHeld });
    return ok(definition);
  }

  /** What the save keeps. */
  snapshot(): ResearchSaveData {
    return { points: this.pointsHeld, researched: this.content.research.all.filter((r) => this.done.has(r.id)).map((r) => r.id) };
  }

  /** Takes up a loaded or new game's research: steps the content no longer has are dropped. */
  restore(data: ResearchSaveData): void {
    this.pointsHeld = Number.isInteger(data.points) && data.points > 0 ? data.points : 0;
    this.done = new Set(data.researched.filter((id) => this.content.research.find(id) !== undefined));
    this.last = NOTHING_RESEARCHED;
    this.update();
  }

  dispose(): void {
    this.unsubscribe();
  }

  private stateOf(definition: ResearchDefinition): ResearchState {
    if (this.done.has(definition.id)) {
      return 'researched';
    }
    const previous = this.content.research.all.find(
      (other) => other.branch === definition.branch && other.tier === definition.tier - 1,
    );
    if (previous !== undefined && !this.done.has(previous.id)) {
      return 'needsPrevious';
    }
    return this.company.level < (definition.requiredCompanyLevel ?? 1) ? 'locked' : 'available';
  }

  private delivered(total: Credits, perfect: boolean): void {
    const points = this.config.pointsPerDelivery + (perfect ? this.config.perfectBonusPoints : 0);
    this.pointsHeld += points;
    // In tens, as the rest of the game's pay.
    const pay = Math.round((total * this.perks.deliveryPayBonus) / 10) * 10;
    if (pay > 0) {
      this.economy.earn(pay, 'research');
    }
    this.last = { pay, points };
    this.events.emit('ResearchPointsChanged', { points: this.pointsHeld, earned: points });
  }

  private update(): void {
    const perks: Record<FacilityEffect, number> = { ...NO_PERKS };
    for (const definition of this.content.research.all) {
      if (this.done.has(definition.id)) {
        perks[definition.effect] += definition.value;
      }
    }
    this.companyPerks.set('research', perks);
  }
}
