import type { EventBus, Unsubscribe } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import { err, ok, type Result } from '../../core/Result';
import type { KeyValueStorage } from '../../core/storage/KeyValueStorage';
import type { Clock } from '../../core/time/Clock';
import type { GameConfig } from '../../data/config/GameConfig';
import { PRODUCT_IDS, isProductId, type ProductId } from '../../data/config/products';
import type { Credits, Fraction } from '../../data/units';
import {
  FRESH_PACING,
  allowanceLeft,
  allowanceUsed,
  deliveryBonus,
  interstitialDue,
  pacingAfterAd,
  pacingAfterDelivery,
  parseAllowance,
  type AdPacing,
  type DailyAllowance,
} from '../../domain/monetization/adRules';
import type { EconomyService } from '../economy/EconomyService';
import type { GameEvents } from '../GameEvents';
import type { DamageService, RepairError } from '../vehicles/DamageService';
import type { FuelService, RefuelError, Refuelled } from '../vehicles/FuelService';
import type { PremiumPaintAccess, PremiumPaintSource } from '../vehicles/GarageService';
import { NO_ADS, type AdService } from './AdService';
import { NO_STORE, type PurchaseOutcome, type PurchaseStore, type StoreProduct } from './PurchaseStore';

/** What the player owns from the store, kept on the device between visits (the store has the last word). */
const OWNED_KEY = 'roadhaul.purchases';
/** Today's rewarded service discounts. */
const ALLOWANCE_KEY = 'roadhaul.serviceDiscounts';

/** Why a rewarded boost gave nothing: no ad to show, the ad closed before its end, or none left to give. */
export type BoostError = 'unavailable' | 'skipped' | 'used';

/** A rewarded ad's discount on a repair or a fill-up, and how many are left today. */
export interface ServiceDiscountOffer {
  readonly discount: Fraction;
  readonly left: number;
}

/**
 * Ads and purchases (spec §35–36): the one owner of both, so gameplay never talks to an SDK.
 *
 * - Rewarded ads are only ever the player's choice: a bonus on a delivery's pay, or a discount on a repair or a
 *   fill-up (a few a day). Everything a boost needs is checked before its ad: no ad is watched for nothing.
 * - Interstitials come only between contracts, as the delivery's result closes, and seldom (adRules.interstitialDue).
 * - `remove_ads` stops the interstitials and gives the boosts without an ad; `premium_paints` opens the garage's
 *   premium colours (GarageService asks `owns`). What was bought is kept on the device and read again from the store
 *   at each start (a refund takes it away).
 *
 * The platform's ads and store arrive after the game has started (their SDKs load late): until then, and in the web
 * game, there are none.
 */
export class MonetizationService implements PremiumPaintSource {
  private ads: AdService = NO_ADS;
  private store: PurchaseStore = NO_STORE;
  private pacing: AdPacing = FRESH_PACING;
  private allowance: DailyAllowance | null;
  private ownedIds: readonly ProductId[];
  /** The bonus the delivery just made may still earn, while its result is open. */
  private pendingBonus: Credits = 0;
  /** An ad or a purchase is under way: another waits for it to end. */
  private busy = false;
  private readonly unsubscribe: Unsubscribe;

  constructor(
    private readonly economy: EconomyService,
    private readonly fuel: FuelService,
    private readonly damage: DamageService,
    private readonly events: EventBus<GameEvents>,
    private readonly storage: KeyValueStorage,
    private readonly clock: Clock,
    private readonly config: GameConfig['monetization'],
    private readonly logger: Logger,
  ) {
    this.ownedIds = this.read(OWNED_KEY, parseOwned) ?? [];
    this.allowance = this.read(ALLOWANCE_KEY, parseAllowance);
    this.unsubscribe = events.on('MissionCompleted', ({ reward }) => {
      this.pacing = pacingAfterDelivery(this.pacing);
      this.pendingBonus = deliveryBonus(reward.total, config);
    });
  }

  /** The platform's ads, once their SDK is up. */
  attachAds(ads: AdService): void {
    this.ads = ads;
  }

  /** The platform's store, once its SDK is up: what the player owns is read from it again. */
  attachStore(store: PurchaseStore): Promise<boolean> {
    this.store = store;
    return this.restorePurchases();
  }

  // ---- What the player owns ----

  get owned(): readonly ProductId[] {
    return this.ownedIds;
  }

  owns(id: ProductId): boolean {
    return this.ownedIds.includes(id);
  }

  get adsEnabled(): boolean {
    return this.ads.enabled;
  }

  get adsRemoved(): boolean {
    return this.owns('remove_ads');
  }

  get storeEnabled(): boolean {
    return this.store.enabled;
  }

  /** The premium colours: bought, for sale, or not sold here (the garage then leaves them out). */
  get premiumPaintAccess(): PremiumPaintAccess {
    if (this.owns('premium_paints')) {
      return 'owned';
    }
    return this.store.enabled ? 'forSale' : 'unavailable';
  }

  /** What is on sale, with its price in the player's currency: "Remove ads" only where there are ads. */
  async productsForSale(): Promise<readonly StoreProduct[]> {
    if (!this.store.enabled) {
      return [];
    }
    try {
      return await this.store.products(PRODUCT_IDS.filter((id) => id !== 'remove_ads' || this.ads.enabled));
    } catch (error) {
      this.logger.warn('The store did not answer with its products.', error);
      return [];
    }
  }

  async buy(id: ProductId): Promise<PurchaseOutcome> {
    if (!this.store.enabled || this.busy) {
      return 'failed';
    }
    this.busy = true;
    try {
      const outcome = await this.store.purchase(id);
      if (outcome === 'purchased') {
        this.setOwned([...this.ownedIds, id]);
      }
      this.logger.info(`Purchase of ${id}: ${outcome}.`);
      return outcome;
    } catch (error) {
      this.logger.warn(`The purchase of ${id} failed.`, error);
      return 'failed';
    } finally {
      this.busy = false;
    }
  }

  /** Reads what the player owns from the store again (at start, and Settings' "Restore purchases"): false offline. */
  async restorePurchases(): Promise<boolean> {
    if (!this.store.enabled) {
      return false;
    }
    try {
      this.setOwned(await this.store.owned());
      return true;
    } catch (error) {
      this.logger.warn('The store did not answer with the purchases.', error);
      return false;
    }
  }

  // ---- Rewarded boosts ----

  /** The bonus a rewarded ad would add to the delivery just made: 0 when there is none to offer. */
  get deliveryBonusOffer(): Credits {
    return this.canReward() ? this.pendingBonus : 0;
  }

  /** Watches the ad (none with ads removed) and pays the delivery's bonus. */
  async claimDeliveryBonus(): Promise<Result<Credits, BoostError>> {
    const bonus = this.pendingBonus;
    if (bonus <= 0) {
      return err('used');
    }
    const watched = await this.reward();
    if (!watched.ok) {
      return watched;
    }
    this.pendingBonus = 0;
    this.economy.earn(bonus, 'adBonus');
    return ok(bonus);
  }

  /** A rewarded ad's discount on a repair or a fill-up in a yard or at a rest area: null when none can be offered. */
  get serviceDiscountOffer(): ServiceDiscountOffer | null {
    const left = allowanceLeft(this.allowance, this.clock.now(), this.config.serviceDiscountsPerDay);
    return this.canReward() && left > 0 ? { discount: this.config.serviceDiscount, left } : null;
  }

  /** Repairs the truck at the discount, after the ad. */
  async repairWithAd(): Promise<Result<Credits, BoostError | RepairError>> {
    const factor = 1 - this.config.serviceDiscount;
    if (this.damage.damage <= 0) {
      return err('notDamaged');
    }
    if (!this.damage.atWorkshop) {
      return err('notAtServicePoint');
    }
    if (!this.economy.canAfford(Math.round(this.damage.repairCost * factor))) {
      return err('insufficientFunds');
    }
    const watched = await this.discountAd();
    if (!watched.ok) {
      return watched;
    }
    const repaired = this.damage.repair(factor);
    if (repaired.ok) {
      this.useAllowance();
    }
    return repaired;
  }

  /** Fills the tank at the discount, after the ad. */
  async refuelWithAd(): Promise<Result<Refuelled, BoostError | RefuelError>> {
    const factor = 1 - this.config.serviceDiscount;
    if (this.fuel.missingLiters < 0.5) {
      return err('tankFull');
    }
    if (!this.fuel.atPump) {
      return err('notAtServicePoint');
    }
    if (this.economy.litersAffordable(Math.floor(this.economy.credits / factor)) <= 0) {
      return err('insufficientFunds');
    }
    const watched = await this.discountAd();
    if (!watched.ok) {
      return watched;
    }
    const filled = this.fuel.refuel(false, factor);
    if (filled.ok) {
      this.useAllowance();
    }
    return filled;
  }

  // ---- Interstitials ----

  /** The delivery's result closed, the way back on the road: an interstitial when one is due. Resolves once closed. */
  async betweenContracts(): Promise<void> {
    this.pendingBonus = 0;
    if (!this.ads.enabled || this.adsRemoved || this.busy || !interstitialDue(this.pacing, this.clock.now(), this.config)) {
      return;
    }
    this.busy = true;
    try {
      if (await this.ads.showInterstitial()) {
        this.pacing = pacingAfterAd(this.pacing, 'interstitial', this.clock.now());
      }
    } catch (error) {
      this.logger.warn('The interstitial failed.', error);
    } finally {
      this.busy = false;
    }
  }

  /** Whether the ad privacy choices must be offered (Settings). */
  get privacyOptionsRequired(): boolean {
    return this.ads.enabled && this.ads.privacyOptionsRequired();
  }

  showPrivacyOptions(): Promise<void> {
    return this.ads.showPrivacyOptions();
  }

  dispose(): void {
    this.unsubscribe();
  }

  /** A boost can be offered: ads in this build, and an ad ready (or none needed). */
  private canReward(): boolean {
    return this.ads.enabled && !this.busy && (this.adsRemoved || this.ads.rewardedReady());
  }

  private async discountAd(): Promise<Result<void, BoostError>> {
    if (allowanceLeft(this.allowance, this.clock.now(), this.config.serviceDiscountsPerDay) <= 0) {
      return err('used');
    }
    return this.reward();
  }

  /** The ad a boost asks for, watched to its end: none with ads removed. */
  private async reward(): Promise<Result<void, BoostError>> {
    if (!this.ads.enabled || this.busy) {
      return err('unavailable');
    }
    if (this.adsRemoved) {
      return ok(undefined);
    }
    this.busy = true;
    try {
      const outcome = await this.ads.showRewarded();
      if (outcome !== 'rewarded') {
        return err(outcome === 'skipped' ? 'skipped' : 'unavailable');
      }
      this.pacing = pacingAfterAd(this.pacing, 'rewarded', this.clock.now());
      return ok(undefined);
    } catch (error) {
      this.logger.warn('The rewarded ad failed.', error);
      return err('unavailable');
    } finally {
      this.busy = false;
    }
  }

  private useAllowance(): void {
    this.allowance = allowanceUsed(this.allowance, this.clock.now());
    this.write(ALLOWANCE_KEY, this.allowance);
  }

  private setOwned(owned: readonly ProductId[]): void {
    const next = PRODUCT_IDS.filter((id) => owned.includes(id));
    if (next.length === this.ownedIds.length && next.every((id, index) => this.ownedIds[index] === id)) {
      return;
    }
    this.ownedIds = Object.freeze(next);
    this.write(OWNED_KEY, next);
    this.events.emit('PurchasesChanged', { owned: this.ownedIds });
  }

  private read<T>(key: string, parse: (value: unknown) => T | null): T | null {
    try {
      const stored = this.storage.getItem(key);
      return stored === null ? null : parse(JSON.parse(stored));
    } catch {
      return null;
    }
  }

  private write(key: string, value: unknown): void {
    try {
      this.storage.setItem(key, JSON.stringify(value));
    } catch (error) {
      this.logger.warn(`Could not keep ${key}.`, error);
    }
  }
}

function parseOwned(value: unknown): readonly ProductId[] | null {
  return Array.isArray(value) ? PRODUCT_IDS.filter((id) => value.some((entry) => entry === id && isProductId(entry))) : null;
}
