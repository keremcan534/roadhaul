import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import { MemoryStorage } from '../../../../src/core/storage/KeyValueStorage';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import type { ProductId } from '../../../../src/data/config/products';
import { ContentCatalog } from '../../../../src/data/ContentCatalog';
import { bayParkingPose } from '../../../../src/domain/missions/loadingBay';
import type { MissionReward } from '../../../../src/domain/missions/missionReward';
import { DrivingService } from '../../../../src/systems/driving/DrivingService';
import { EconomyService } from '../../../../src/systems/economy/EconomyService';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import type { AdService, RewardedOutcome } from '../../../../src/systems/monetization/AdService';
import { MonetizationService } from '../../../../src/systems/monetization/MonetizationService';
import type { PurchaseOutcome, PurchaseStore } from '../../../../src/systems/monetization/PurchaseStore';
import { DamageService } from '../../../../src/systems/vehicles/DamageService';
import { FuelService } from '../../../../src/systems/vehicles/FuelService';
import { contentFixture } from '../../../support/contentFixtures';
import { MemoryLogger } from '../../../support/MemoryLogger';

const config = {
  ...DEFAULT_GAME_CONFIG.monetization,
  deliveryBonusShare: 0.25,
  deliveryBonusMinCredits: 100,
  deliveryBonusMaxCredits: 2500,
  serviceDiscount: 0.5,
  serviceDiscountsPerDay: 2,
  interstitialFirstAfterDeliveries: 2,
  interstitialEveryDeliveries: 2,
  interstitialMinSeconds: 60,
};

/** Ads that do what the test says: each rewarded ad ends as `next`. */
class FakeAds implements AdService {
  enabled = true;
  ready = true;
  next: RewardedOutcome = 'rewarded';
  rewarded = 0;
  interstitials = 0;

  rewardedReady(): boolean {
    return this.ready;
  }

  showRewarded(): Promise<RewardedOutcome> {
    this.rewarded++;
    return Promise.resolve(this.next);
  }

  showInterstitial(): Promise<boolean> {
    this.interstitials++;
    return Promise.resolve(true);
  }

  privacyOptionsRequired(): boolean {
    return true;
  }

  showPrivacyOptions(): Promise<void> {
    return Promise.resolve();
  }
}

/** A store whose shelves and receipts the test sets. */
class FakeStore implements PurchaseStore {
  enabled = true;
  receipts: ProductId[] = [];
  next: PurchaseOutcome = 'purchased';
  offline = false;

  products(ids: readonly ProductId[]) {
    return Promise.resolve(ids.map((id) => ({ id, price: '€1.99' })));
  }

  purchase(id: ProductId): Promise<PurchaseOutcome> {
    if (this.next === 'purchased') {
      this.receipts.push(id);
    }
    return Promise.resolve(this.next);
  }

  owned(): Promise<readonly ProductId[]> {
    return this.offline ? Promise.reject(new Error('offline')) : Promise.resolve([...this.receipts]);
  }
}

const reward = (total: number): MissionReward => ({
  basePay: total,
  timeBonus: 0,
  latePenalty: 0,
  conditionBonus: 0,
  total,
  onTime: true,
  lateSeconds: 0,
});

/**
 * The truck parked in the fixture's origin yard (pump and workshop), 10 000 credits; fuel at 10 credits a litre, a
 * full repair at 6000. The clock starts at noon UTC.
 */
function setup(storage = new MemoryStorage()) {
  const logger = new MemoryLogger();
  const events = new EventBus<GameEvents>(logger);
  const content = ContentCatalog.create(contentFixture());
  const driving = new DrivingService(content, events, logger);
  const economy = new EconomyService(events, { fuelPricePerLiter: 10, roadsideFuelPriceFactor: 2, fullRepairCost: 6000 }, logger);
  const damage = new DamageService(driving, economy, events, logger);
  const fuel = new FuelService(driving, damage, economy, events, { consumptionScale: 100, lowFuelFraction: 0.15 }, logger);
  driving.start('test_truck', 'test_map');
  const pose = bayParkingPose(driving.world.depots[0]!.bay, driving.definition.body);
  driving.placeTruck(pose.x, pose.z, pose.heading);
  economy.restore(10_000);
  fuel.restore(300);
  const clock = { nowMs: Date.parse('2026-09-30T12:00:00Z'), now: () => clock.nowMs };
  const monetization = new MonetizationService(economy, fuel, damage, events, storage, clock, config, logger);
  const ads = new FakeAds();
  const store = new FakeStore();
  const deliver = (total: number) =>
    events.emit('MissionCompleted', {
      missionId: 'test_mission',
      mission: content.missions.all[0]!,
      reward: reward(total),
      deliverySeconds: 100,
      cargoDamage: 0,
      xp: 10,
      reputation: 1,
    });
  return { events, economy, damage, fuel, monetization, ads, store, clock, storage, deliver };
}

describe('MonetizationService without ads', () => {
  it('offers nothing and shows nothing: the web game, and builds without ads', async () => {
    const context = setup();
    context.deliver(1000);

    expect(context.monetization.adsEnabled).toBe(false);
    expect(context.monetization.deliveryBonusOffer).toBe(0);
    expect(context.monetization.serviceDiscountOffer).toBeNull();
    expect(await context.monetization.claimDeliveryBonus()).toEqual({ ok: false, error: 'unavailable' });
    expect(context.monetization.privacyOptionsRequired).toBe(false);
    expect(await context.monetization.productsForSale()).toEqual([]);
  });
});

describe('the delivery bonus', () => {
  it("is a share of the delivery's pay, paid after the ad, once", async () => {
    const context = setup();
    context.monetization.attachAds(context.ads);
    const moves: GameEvents['MoneyChanged'][] = [];
    context.events.on('MoneyChanged', (event) => moves.push(event));
    context.deliver(1260);
    expect(context.economy.credits).toBe(11_260);

    expect(context.monetization.deliveryBonusOffer).toBe(315);
    expect(await context.monetization.claimDeliveryBonus()).toEqual({ ok: true, value: 315 });
    expect(context.economy.credits).toBe(11_575);
    expect(moves.at(-1)?.reason).toBe('adBonus');
    expect(context.monetization.deliveryBonusOffer).toBe(0);
    expect(await context.monetization.claimDeliveryBonus()).toEqual({ ok: false, error: 'used' });
    expect(context.ads.rewarded).toBe(1);
  });

  it('pays nothing for an ad closed before its end, and can be tried again', async () => {
    const context = setup();
    context.monetization.attachAds(context.ads);
    context.deliver(1000);
    context.ads.next = 'skipped';

    expect(await context.monetization.claimDeliveryBonus()).toEqual({ ok: false, error: 'skipped' });
    expect(context.economy.credits).toBe(11_000);

    context.ads.next = 'rewarded';
    expect(await context.monetization.claimDeliveryBonus()).toEqual({ ok: true, value: 250 });
  });

  it('is offered only while an ad is ready, and only until the result closes', async () => {
    const context = setup();
    context.monetization.attachAds(context.ads);
    context.deliver(1000);
    context.ads.ready = false;

    expect(context.monetization.deliveryBonusOffer).toBe(0);

    context.ads.ready = true;
    expect(context.monetization.deliveryBonusOffer).toBe(250);
    await context.monetization.betweenContracts();
    expect(context.monetization.deliveryBonusOffer).toBe(0);
  });

  it('comes without an ad once ads are removed', async () => {
    const context = setup();
    context.monetization.attachAds(context.ads);
    await context.monetization.attachStore(context.store);
    await context.monetization.buy('remove_ads');
    context.ads.ready = false;
    context.deliver(1000);

    expect(context.monetization.deliveryBonusOffer).toBe(250);
    expect(await context.monetization.claimDeliveryBonus()).toEqual({ ok: true, value: 250 });
    expect(context.ads.rewarded).toBe(0);
  });
});

describe('the service discount', () => {
  it('repairs at half price after the ad, a few times a day', async () => {
    const context = setup();
    context.monetization.attachAds(context.ads);
    context.events.emit('VehicleCollided', { impactSpeedMetersPerSecond: 14 });

    expect(context.monetization.serviceDiscountOffer).toEqual({ discount: 0.5, left: 2 });
    expect(await context.monetization.repairWithAd()).toEqual({ ok: true, value: 750 });
    expect(context.economy.credits).toBe(9250);
    expect(context.damage.damage).toBe(0);
    expect(context.monetization.serviceDiscountOffer).toEqual({ discount: 0.5, left: 1 });
  });

  it('fills the tank at half price after the ad', async () => {
    const context = setup();
    context.monetization.attachAds(context.ads);
    context.fuel.restore(100);

    const filled = await context.monetization.refuelWithAd();

    expect(filled.ok && filled.value.cost).toBe(1000);
    expect(context.economy.credits).toBe(9000);
    expect(context.fuel.missingLiters).toBeLessThan(0.5);
  });

  it('shows no ad for a service that could not be given', async () => {
    const context = setup();
    context.monetization.attachAds(context.ads);

    expect(await context.monetization.repairWithAd()).toEqual({ ok: false, error: 'notDamaged' });
    expect(await context.monetization.refuelWithAd()).toEqual({ ok: false, error: 'tankFull' });
    context.events.emit('VehicleCollided', { impactSpeedMetersPerSecond: 14 });
    context.economy.restore(100);
    expect(await context.monetization.repairWithAd()).toEqual({ ok: false, error: 'insufficientFunds' });
    expect(context.ads.rewarded).toBe(0);
  });

  it('keeps count of the day on the device, and starts again the next day', async () => {
    const storage = new MemoryStorage();
    const context = setup(storage);
    context.monetization.attachAds(context.ads);
    for (let use = 0; use < 2; use++) {
      context.events.emit('VehicleCollided', { impactSpeedMetersPerSecond: 14 });
      expect((await context.monetization.repairWithAd()).ok).toBe(true);
    }
    context.events.emit('VehicleCollided', { impactSpeedMetersPerSecond: 14 });
    expect(context.monetization.serviceDiscountOffer).toBeNull();
    expect(await context.monetization.repairWithAd()).toEqual({ ok: false, error: 'used' });

    const again = setup(storage);
    again.monetization.attachAds(again.ads);
    expect(again.monetization.serviceDiscountOffer).toBeNull();
    again.clock.nowMs = Date.parse('2026-10-01T08:00:00Z');
    expect(again.monetization.serviceDiscountOffer).toEqual({ discount: 0.5, left: 2 });
  });
});

describe('interstitials', () => {
  it('show only between contracts, after a few deliveries, and not soon after another ad', async () => {
    const context = setup();
    context.monetization.attachAds(context.ads);

    context.deliver(1000);
    await context.monetization.betweenContracts();
    expect(context.ads.interstitials).toBe(0);

    context.deliver(1000);
    await context.monetization.betweenContracts();
    expect(context.ads.interstitials).toBe(1);

    context.deliver(1000);
    context.deliver(1000);
    context.clock.nowMs += 30_000;
    await context.monetization.betweenContracts();
    expect(context.ads.interstitials).toBe(1);

    context.clock.nowMs += 30_000;
    await context.monetization.betweenContracts();
    expect(context.ads.interstitials).toBe(2);
  });

  it('never show once ads are removed', async () => {
    const context = setup();
    context.monetization.attachAds(context.ads);
    await context.monetization.attachStore(context.store);
    await context.monetization.buy('remove_ads');
    for (let delivery = 0; delivery < 6; delivery++) {
      context.deliver(1000);
      await context.monetization.betweenContracts();
    }
    expect(context.ads.interstitials).toBe(0);
  });
});

describe('purchases', () => {
  it('sell "Remove ads" only where there are ads', async () => {
    const context = setup();
    await context.monetization.attachStore(context.store);
    expect((await context.monetization.productsForSale()).map((product) => product.id)).toEqual(['premium_paints']);

    context.monetization.attachAds(context.ads);
    expect((await context.monetization.productsForSale()).map((product) => product.id)).toEqual([
      'remove_ads',
      'premium_paints',
    ]);
  });

  it('keep what was bought on the device, and tell the game', async () => {
    const storage = new MemoryStorage();
    const context = setup(storage);
    const changes: GameEvents['PurchasesChanged'][] = [];
    context.events.on('PurchasesChanged', (event) => changes.push(event));
    await context.monetization.attachStore(context.store);

    expect(await context.monetization.buy('premium_paints')).toBe('purchased');
    expect(context.monetization.owns('premium_paints')).toBe(true);
    expect(changes).toEqual([{ owned: ['premium_paints'] }]);

    const offline = setup(storage);
    offline.store.offline = true;
    expect(await offline.monetization.attachStore(offline.store)).toBe(false);
    expect(offline.monetization.owns('premium_paints')).toBe(true);
  });

  it("take back what the store no longer has (a refund), and ignore what it doesn't know", async () => {
    const storage = new MemoryStorage();
    storage.setItem('roadhaul.purchases', JSON.stringify(['premium_paints', 'gold_truck']));
    const context = setup(storage);
    expect(context.monetization.owned).toEqual(['premium_paints']);

    expect(await context.monetization.attachStore(context.store)).toBe(true);
    expect(context.monetization.owned).toEqual([]);
    expect(storage.getItem('roadhaul.purchases')).toBe('[]');
  });

  it('give nothing for a cancelled or pending purchase', async () => {
    const context = setup();
    await context.monetization.attachStore(context.store);
    context.store.next = 'cancelled';
    expect(await context.monetization.buy('premium_paints')).toBe('cancelled');
    context.store.next = 'pending';
    expect(await context.monetization.buy('premium_paints')).toBe('pending');
    expect(context.monetization.owned).toEqual([]);
  });

  it('are refused without a store', async () => {
    const context = setup();
    expect(context.monetization.storeEnabled).toBe(false);
    expect(await context.monetization.buy('premium_paints')).toBe('failed');
    expect(await context.monetization.restorePurchases()).toBe(false);
  });
});
