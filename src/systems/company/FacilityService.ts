import type { EventBus } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import { err, ok, type Result } from '../../core/Result';
import type { ContentCatalog } from '../../data/ContentCatalog';
import type { FacilityDefinition, FacilityLevelDefinition } from '../../data/definitions/FacilityDefinition';
import { facilityLevel, facilityPerks, nextFacilityLevel, type FacilityPerks } from '../../domain/company/facilities';
import type { SpendError } from '../../domain/economy/CurrencyWallet';
import type { FacilitiesSaveData } from '../../domain/save/SaveGameData';
import type { EconomyService } from '../economy/EconomyService';
import type { GameEvents } from '../GameEvents';
import type { CompanyLevelSource } from '../missions/MissionService';
import type { CompanyPerks } from './CompanyPerks';

export type BuildFacilityError = 'unknownFacility' | 'maxLevel' | 'locked' | SpendError;

/** A facility as the head office offers it: how far it is built, and its next level. */
export interface FacilityOffer {
  readonly definition: FacilityDefinition;
  /** The level built, 0 for none. */
  readonly level: number;
  /** The level it would be built to next, or null at its top. */
  readonly next: FacilityLevelDefinition | null;
  /** The next level needs a company level the company has not reached yet: shown, but not for sale. */
  readonly locked: boolean;
}

/**
 * The company's facilities (FacilityDefinition): built for the whole
 * company at the head office a level at a time, from the company level
 * each needs, and kept in the save. Every change sets the company's perks
 * (CompanyPerks), which the services they change read as they go.
 */
export class FacilityService {
  private levels: Record<string, number> = {};

  constructor(
    private readonly content: ContentCatalog,
    private readonly economy: EconomyService,
    private readonly company: CompanyLevelSource,
    private readonly companyPerks: CompanyPerks,
    private readonly events: EventBus<GameEvents>,
    private readonly logger: Logger,
  ) {}

  /** What the facilities built give the company now, all together. */
  get perks(): FacilityPerks {
    return this.companyPerks.perks;
  }

  /** How far `facilityId` is built: 0 for not at all. */
  levelOf(facilityId: string): number {
    const facility = this.content.facilities.find(facilityId);
    return facility === undefined ? 0 : facilityLevel(facility, this.levels);
  }

  /** Every facility, in content order, with how far it is built and what comes next. */
  offers(): readonly FacilityOffer[] {
    return this.content.facilities.all.map((definition) => this.offerFor(definition));
  }

  /** Builds the next level of `facilityId`, paying for it. Returns the level it is built to now. */
  build(facilityId: string): Result<number, BuildFacilityError> {
    const facility = this.content.facilities.find(facilityId);
    if (facility === undefined) {
      return err('unknownFacility');
    }
    const { level, next, locked } = this.offerFor(facility);
    if (next === null) {
      return err('maxLevel');
    }
    if (locked) {
      return err('locked');
    }
    const paid = this.economy.spend(next.cost, 'facility');
    if (!paid.ok) {
      return err(paid.error);
    }
    this.levels = { ...this.levels, [facilityId]: level + 1 };
    this.update();
    this.logger.info(`Built ${facilityId} to level ${level + 1} for ${next.cost}.`);
    this.events.emit('FacilityBuilt', { facilityId, level: level + 1, cost: next.cost });
    return ok(level + 1);
  }

  /** What the save keeps: each facility built, and how far. */
  snapshot(): FacilitiesSaveData {
    return { levels: { ...this.levels } };
  }

  /** Takes up a loaded or new game's facilities: levels the content no longer has are dropped, or cut to its top. */
  restore(data: FacilitiesSaveData): void {
    const levels: Record<string, number> = {};
    for (const facility of this.content.facilities.all) {
      const level = facilityLevel(facility, data.levels);
      if (level > 0) {
        levels[facility.id] = level;
      }
    }
    this.levels = levels;
    this.update();
  }

  private offerFor(definition: FacilityDefinition): FacilityOffer {
    const level = facilityLevel(definition, this.levels);
    const next = nextFacilityLevel(definition, level);
    return { definition, level, next, locked: next !== null && this.company.level < (next.requiredCompanyLevel ?? 1) };
  }

  private update(): void {
    this.companyPerks.set(facilityPerks(this.content.facilities.all, this.levels));
  }
}
