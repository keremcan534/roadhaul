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

export type BuyUpgradeError = 'unknownUpgrade' | 'maxLevel' | 'locked' | SpendError;

/** The level of an upgrade the active truck could get next. */
export interface NextUpgradeLevel {
  /** 1 for the first level. */
  readonly level: number;
  readonly cost: Credits;
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

/**
 * The upgrade shop (spec §16; roadmap step 20): sells the next level of each
 * upgrade for the active truck, one level at a time, from the company level
 * each needs. GarageService keeps what each truck has fitted and applies it.
 */
export class UpgradeService {
  constructor(
    private readonly content: ContentCatalog,
    private readonly garage: GarageService,
    private readonly economy: EconomyService,
    private readonly company: CompanyLevelSource,
    private readonly events: EventBus<GameEvents>,
    private readonly logger: Logger,
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
    const paid = this.economy.spend(next.cost, 'upgrade');
    if (!paid.ok) {
      return err(paid.error);
    }
    this.garage.fitUpgrade(upgradeId, next.level);
    const { instanceId } = this.garage.activeTruck;
    this.logger.info(`Fitted ${upgradeId} level ${next.level} to ${instanceId} for ${next.cost}.`);
    this.events.emit('UpgradePurchased', { instanceId, upgradeId, level: next.level, cost: next.cost });
    return ok(next.level);
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
              requiredCompanyLevel,
              locked: this.company.level < requiredCompanyLevel,
              modifiers: nextLevel.modifiers,
            },
    };
  }
}
