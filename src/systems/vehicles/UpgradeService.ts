import type { EventBus } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import { err, ok, type Result } from '../../core/Result';
import type { ContentCatalog } from '../../data/ContentCatalog';
import type { StatModifier, UpgradeDefinition } from '../../data/definitions/UpgradeDefinition';
import type { Credits } from '../../data/units';
import type { SpendError } from '../../domain/economy/CurrencyWallet';
import type { EconomyService } from '../economy/EconomyService';
import type { GameEvents } from '../GameEvents';
import type { CompanyLevelSource } from '../missions/MissionService';
import type { GarageService } from './GarageService';
import type { PartsSource } from '../rewards/SupplyService';

export type BuyUpgradeError = 'unknownUpgrade' | 'maxLevel' | 'locked' | SpendError;

/** The level of an upgrade the active truck could get next. */
export interface NextUpgradeLevel {
  /** 1 for the first level. */
  readonly level: number;
  /** Its price. */
  readonly cost: Credits;
  /** What the company's upgrade parts take off it, and how many of them that uses (SupplyService). */
  readonly partsCredit: Credits;
  readonly partsUsed: number;
  /** What it costs in credits, the parts used. */
  readonly price: Credits;
  /** The company level that lets the garage fit it (spec §16 RequiredCompanyLevel). */
  readonly requiredCompanyLevel: number;
  /** Below that level: shown, but it cannot be bought yet. */
  readonly locked: boolean;
  /** Its whole effect once fitted (it replaces the fitted level's). */
  readonly modifiers: readonly StatModifier[];
}

/** An upgrade in the shop, for the active truck. */
export interface UpgradeOffer {
  readonly upgrade: UpgradeDefinition;
  /** The level fitted to the active truck, 0 for none. */
  readonly fittedLevel: number;
  /** The fitted level's modifiers, empty for none. */
  readonly fittedModifiers: readonly StatModifier[];
  /** Null once the top level is fitted. */
  readonly next: NextUpgradeLevel | null;
}

/** No parts: a shop without crates (tests). */
const NO_PARTS: PartsSource = { parts: 0, useParts: () => undefined };

/**
 * The upgrade shop (spec §16; roadmap step 20): sells the next level of each
 * upgrade for the active truck, one level at a time, from the company level
 * each needs. The upgrade parts crates give each take `partCredits` off a
 * level's price, as many as it takes. GarageService keeps what each truck
 * has fitted and applies it.
 */
export class UpgradeService {
  constructor(
    private readonly content: ContentCatalog,
    private readonly garage: GarageService,
    private readonly economy: EconomyService,
    private readonly company: CompanyLevelSource,
    private readonly events: EventBus<GameEvents>,
    private readonly logger: Logger,
    private readonly parts: PartsSource = NO_PARTS,
    /** What one part takes off a price (GameConfig.crates.partCredits). */
    private readonly partCredits: Credits = 1,
  ) {}

  /** Every upgrade, in content order, with what the active truck has and could get next. */
  offers(): readonly UpgradeOffer[] {
    return this.content.upgrades.all.map((upgrade) => this.offerFor(upgrade));
  }

  /** Fits the next level of `upgradeId` to the active truck, paying for it. Returns the new level. */
  buy(upgradeId: string): Result<number, BuyUpgradeError> {
    const upgrade = this.content.upgrades.find(upgradeId);
    if (upgrade === undefined) {
      return err('unknownUpgrade');
    }
    const { next } = this.offerFor(upgrade);
    if (next === null) {
      return err('maxLevel');
    }
    if (next.locked) {
      return err('locked');
    }
    const paid = this.economy.spend(next.price, 'upgrade');
    if (!paid.ok) {
      return err(paid.error);
    }
    if (next.partsUsed > 0) {
      this.parts.useParts(next.partsUsed);
    }
    this.garage.fitUpgrade(upgradeId, next.level);
    const { instanceId } = this.garage.activeTruck;
    this.logger.info(`Fitted ${upgradeId} level ${next.level} to ${instanceId} for ${next.price} and ${next.partsUsed} parts.`);
    this.events.emit('UpgradePurchased', { instanceId, upgradeId, level: next.level, cost: next.price });
    return ok(next.level);
  }

  /** The parts a price of `cost` would use (no more than it takes), what they take off, and what is left to pay. */
  private withParts(cost: Credits): { partsUsed: number; partsCredit: Credits; price: Credits } {
    const partsUsed = Math.min(this.parts.parts, Math.ceil(cost / this.partCredits));
    const partsCredit = Math.min(cost, partsUsed * this.partCredits);
    return { partsUsed, partsCredit, price: cost - partsCredit };
  }

  private offerFor(upgrade: UpgradeDefinition): UpgradeOffer {
    const fittedLevel = this.garage.fittedLevel(upgrade.id);
    const nextLevel = upgrade.levels[fittedLevel];
    const requiredCompanyLevel = nextLevel?.requiredCompanyLevel ?? 1;
    return {
      upgrade,
      fittedLevel,
      fittedModifiers: fittedLevel > 0 ? upgrade.levels[fittedLevel - 1]!.modifiers : [],
      next:
        nextLevel === undefined
          ? null
          : {
              level: fittedLevel + 1,
              cost: nextLevel.cost,
              ...this.withParts(nextLevel.cost),
              requiredCompanyLevel,
              locked: this.company.level < requiredCompanyLevel,
              modifiers: nextLevel.modifiers,
            },
    };
  }
}
