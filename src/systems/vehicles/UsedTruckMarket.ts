import { err, ok, type Result } from '../../core/Result';
import type { Logger } from '../../core/logging/Logger';
import { SeededRandom } from '../../core/random/SeededRandom';
import type { Clock } from '../../core/time/Clock';
import type { GameConfig } from '../../data/config/GameConfig';
import type { ContentCatalog } from '../../data/ContentCatalog';
import type { VehicleDefinition } from '../../data/definitions/VehicleDefinition';
import type { Credits, Fraction } from '../../data/units';
import type { UsedTrucksSaveData } from '../../domain/save/SaveGameData';
import type { CompanyLevelSource } from '../missions/MissionService';
import type { BuyTruckError, GarageService, OwnedTruck } from './GarageService';

export type BuyUsedTruckError = 'unknownOffer' | 'sold' | BuyTruckError;

/** A used truck for sale. */
export interface UsedTruckOffer {
  /** Its place in the period's list (0 up). */
  readonly index: number;
  readonly definition: VehicleDefinition;
  readonly price: Credits;
  /** What the same truck costs new, with its upgrades. */
  readonly newPrice: Credits;
  readonly damage: Fraction;
  readonly paintId: string | null;
  readonly upgrades: Readonly<Record<string, number>>;
  /** How far it has been driven, km (for show). */
  readonly odometerKm: number;
  readonly sold: boolean;
}

const HOUR_MS = 3_600_000;

/**
 * The used-truck market in the garage: every few hours of the clock
 * (GameConfig.usedTrucks.refreshHours) a few used trucks of the models the
 * company may buy, each cheaper than new by a share, worn, some in another
 * colour, some with an upgrade fitted (its price counted in what new would
 * cost, so buying one and selling it again never pays). The same period
 * shows the same trucks; those bought stay sold until the next (in the save).
 */
export class UsedTruckMarket {
  private soldPeriod = Number.NaN;
  private sold = new Set<number>();

  constructor(
    private readonly content: ContentCatalog,
    private readonly garage: GarageService,
    private readonly company: CompanyLevelSource,
    private readonly clock: Clock,
    private readonly config: GameConfig['usedTrucks'],
    private readonly logger: Logger,
  ) {}

  /** The period the market is in now: a new list each `refreshHours`. */
  get period(): number {
    return Math.floor(this.clock.now() / (this.config.refreshHours * HOUR_MS));
  }

  /** Milliseconds until the next list. */
  get nextListInMs(): number {
    const length = this.config.refreshHours * HOUR_MS;
    return (this.period + 1) * length - this.clock.now();
  }

  /** The trucks for sale now, those sold this period marked. */
  offers(): readonly UsedTruckOffer[] {
    const period = this.period;
    const sold = period === this.soldPeriod ? this.sold : new Set<number>();
    return this.listFor(period).map((offer) => ({ ...offer, sold: sold.has(offer.index) }));
  }

  /** Buys used truck `index` of the list now, if the garage has room and the company the credits. */
  buy(index: number): Result<OwnedTruck, BuyUsedTruckError> {
    const offer = this.offers().find((candidate) => candidate.index === index);
    if (offer === undefined) {
      return err('unknownOffer');
    }
    if (offer.sold) {
      return err('sold');
    }
    // Sold before the garage tells of the truck: whoever listens (the panel, redrawn) sees it sold already.
    const period = this.period;
    if (period !== this.soldPeriod) {
      this.soldPeriod = period;
      this.sold = new Set();
    }
    this.sold.add(index);
    const bought = this.garage.buyUsed(offer);
    if (!bought.ok) {
      this.sold.delete(index);
      return bought;
    }
    this.logger.info(`Bought a used ${offer.definition.id} for ${offer.price}.`);
    return ok(bought.value);
  }

  snapshot(): UsedTrucksSaveData {
    return Number.isNaN(this.soldPeriod) ? { period: null, sold: [] } : { period: this.soldPeriod, sold: [...this.sold].sort((a, b) => a - b) };
  }

  restore(data: UsedTrucksSaveData): void {
    this.soldPeriod = data.period ?? Number.NaN;
    this.sold = new Set(data.sold);
  }

  /** The period's list, the same each time for the same period and company level. */
  private listFor(period: number): Omit<UsedTruckOffer, 'sold'>[] {
    const { offers, discount, damage, odometerKm, paintChance, upgradeChance } = this.config;
    const level = this.company.level;
    const models = this.content.vehicles.all.filter((vehicle) => (vehicle.requiredCompanyLevel ?? 1) <= level);
    const paints = this.content.paints.all.filter(
      (paint) => paint.premium !== true && paint.crate === undefined && paint.pass === undefined && (paint.requiredCompanyLevel ?? 1) <= level,
    );
    const upgrades = this.content.upgrades.all.filter((upgrade) => (upgrade.levels[0]?.requiredCompanyLevel ?? 1) <= level);
    const random = new SeededRandom(0x7ac0 + period * 104_729);
    const list: Omit<UsedTruckOffer, 'sold'>[] = [];
    for (let index = 0; index < offers && models.length > 0; index++) {
      const definition = models[random.int(0, models.length - 1)]!;
      const fitted: Record<string, number> = {};
      let upgradesCost = 0;
      if (upgrades.length > 0 && random.next() < upgradeChance) {
        const upgrade = upgrades[random.int(0, upgrades.length - 1)]!;
        fitted[upgrade.id] = 1;
        upgradesCost = upgrade.levels[0]!.cost;
      }
      const paintId = paints.length > 0 && random.next() < paintChance ? paints[random.int(0, paints.length - 1)]!.id : null;
      const newPrice = definition.purchasePrice + upgradesCost;
      const share = 1 - random.range(discount[0], discount[1]);
      list.push({
        index,
        definition,
        price: Math.round((newPrice * share) / 100) * 100,
        newPrice,
        damage: Math.round(random.range(damage[0], damage[1]) * 100) / 100,
        paintId,
        upgrades: fitted,
        odometerKm: Math.round(random.range(odometerKm[0], odometerKm[1]) / 1000) * 1000,
      });
    }
    return list;
  }
}
