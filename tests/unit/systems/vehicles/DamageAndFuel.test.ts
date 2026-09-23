import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import { ContentCatalog } from '../../../../src/data/ContentCatalog';
import { DrivingService } from '../../../../src/systems/driving/DrivingService';
import { EconomyService } from '../../../../src/systems/economy/EconomyService';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { DamageService } from '../../../../src/systems/vehicles/DamageService';
import { EMERGENCY_FUEL_LITERS, FuelService } from '../../../../src/systems/vehicles/FuelService';
import { bayParkingPose } from '../../../../src/domain/missions/loadingBay';
import { contentFixture } from '../../../support/contentFixtures';
import { input, STEP_SECONDS } from '../../../support/driving';
import { MemoryLogger } from '../../../support/MemoryLogger';

/**
 * Fixture truck: 300 L tank, 0.3 L/km; fuel at 10 credits (20 on the road); a
 * full repair costs 6000. The truck starts in the origin depot's yard, where
 * the pump and workshop are; driveFor() takes it out onto the road.
 */
function setup(credits = 10_000) {
  const logger = new MemoryLogger();
  const events = new EventBus<GameEvents>(logger);
  const content = ContentCatalog.create(contentFixture());
  const driving = new DrivingService(content, events, logger);
  const economy = new EconomyService(events, { fuelPricePerLiter: 10, roadsideFuelPriceFactor: 2, fullRepairCost: 6000 }, logger);
  const damage = new DamageService(driving, economy, events, logger);
  const fuel = new FuelService(driving, damage, economy, events, { consumptionScale: 100, lowFuelFraction: 0.15 }, logger);
  driving.start('test_truck', 'test_map');
  parkInYard(driving);
  economy.restore(credits);
  fuel.restore(300);
  return { events, driving, economy, damage, fuel };
}

/** Stops the truck in the origin depot's bay, inside its yard. */
function parkInYard(driving: DrivingService): void {
  const pose = bayParkingPose(driving.world.depots[0]!.bay, driving.definition.body);
  driving.placeTruck(pose.x, pose.z, pose.heading);
}

/** Stops the truck on the open road, away from any depot or rest area. */
function parkOnTheRoad(driving: DrivingService): void {
  driving.placeTruck(0, 0, Math.PI / 2);
}

function driveFor(context: ReturnType<typeof setup>, seconds: number, throttle = 1): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += STEP_SECONDS) {
    context.driving.step(STEP_SECONDS, input({ throttle }));
    context.fuel.update();
  }
}

describe('DamageService', () => {
  it('damages the truck in collisions and weakens it, by band (spec §18)', () => {
    const context = setup();
    const damaged: GameEvents['VehicleDamaged'][] = [];
    context.events.on('VehicleDamaged', (event) => damaged.push(event));

    context.events.emit('VehicleCollided', { impactSpeedMetersPerSecond: 14 });

    expect(context.damage.damage).toBeCloseTo(0.25, 9);
    expect(context.damage.band).toBe('damaged');
    expect(damaged).toEqual([{ damage: context.damage.damage, addedDamage: context.damage.damage, band: 'damaged' }]);
    expect(context.damage.repairCost).toBe(1500);
  });

  it('caps damage at a wreck, which still drives', () => {
    const context = setup();
    for (let i = 0; i < 10; i++) {
      context.events.emit('VehicleCollided', { impactSpeedMetersPerSecond: 20 });
    }

    expect(context.damage.damage).toBe(1);
    expect(context.damage.band).toBe('critical');
    driveFor(context, 2);
    expect(context.driving.vehicle.speed).toBeGreaterThan(1);
  });

  it('repairs for money, restoring full strength', () => {
    const context = setup(2000);
    context.events.emit('VehicleCollided', { impactSpeedMetersPerSecond: 14 });

    expect(context.damage.repair()).toEqual({ ok: true, value: 1500 });

    expect(context.damage.damage).toBe(0);
    expect(context.economy.credits).toBe(500);
    expect(context.damage.repair()).toEqual({ ok: false, error: 'notDamaged' });
  });

  it('repairs only in a depot yard or at a rest area', () => {
    const context = setup();
    context.events.emit('VehicleCollided', { impactSpeedMetersPerSecond: 14 });
    parkOnTheRoad(context.driving);

    expect(context.damage.atWorkshop).toBe(false);
    expect(context.damage.repair()).toEqual({ ok: false, error: 'notAtServicePoint' });
    expect(context.economy.credits).toBe(10_000);

    parkInYard(context.driving);
    expect(context.damage.atWorkshop).toBe(true);
    expect(context.damage.repair().ok).toBe(true);
  });

  it('refuses a repair the company cannot afford', () => {
    const context = setup(100);
    context.events.emit('VehicleCollided', { impactSpeedMetersPerSecond: 14 });

    expect(context.damage.repair()).toEqual({ ok: false, error: 'insufficientFunds' });
    expect(context.damage.damage).toBeCloseTo(0.25, 9);
  });
});

describe('FuelService', () => {
  it('burns fuel for the distance driven, more with cargo', () => {
    const empty = setup();
    const loaded = setup();
    loaded.driving.setCargoMass(10_000);

    driveFor(empty, 5);
    driveFor(loaded, 5);

    expect(empty.fuel.fuelLiters).toBeLessThan(300);
    const emptyBurn = (300 - empty.fuel.fuelLiters) / empty.driving.vehicle.odometerMeters;
    const loadedBurn = (300 - loaded.fuel.fuelLiters) / loaded.driving.vehicle.odometerMeters;
    expect(loadedBurn).toBeGreaterThan(emptyBurn * 1.3);
  });

  it('burns nothing standing still', () => {
    const context = setup();

    driveFor(context, 2, 0);

    expect(context.fuel.fuelLiters).toBe(300);
  });

  it('stalls the engine when the tank runs dry', () => {
    const context = setup();
    context.fuel.restore(0.05);

    driveFor(context, 5);

    expect(context.fuel.isEmpty).toBe(true);
    expect(context.driving.isEngineRunning).toBe(false);
  });

  it('announces the level only when the whole percent changes', () => {
    const context = setup();
    const levels: number[] = [];
    context.events.on('FuelChanged', ({ fraction }) => levels.push(Math.floor(fraction * 100)));

    driveFor(context, 10);

    expect(levels.length).toBeGreaterThan(0);
    expect(new Set(levels).size).toBe(levels.length);
  });

  it('fills the tank for money, dearer on the road, and restarts the engine', () => {
    const context = setup();
    const refuelled: GameEvents['Refuelled'][] = [];
    context.events.on('Refuelled', (event) => refuelled.push({ ...event, liters: context.fuel.fuelLiters }));
    context.fuel.restore(250);

    expect(context.fuel.fillUpCost()).toBe(500);
    expect(context.fuel.fillUpCost(true)).toBe(1000);
    expect(context.fuel.refuel(true)).toEqual({ ok: true, value: { liters: 50, cost: 1000 } });
    expect(context.fuel.fuelLiters).toBe(300);
    expect(context.economy.credits).toBe(9000);
    expect(context.fuel.refuel()).toEqual({ ok: false, error: 'tankFull' });
    // Announced once the fuel is in the tank (the session saves then).
    expect(refuelled).toEqual([{ liters: 300, cost: 1000 }]);
  });

  it('holds more in an upgraded tank and burns less with an upgraded engine', () => {
    const plain = setup();
    const upgraded = setup();

    upgraded.fuel.setUpgradeBonuses(0.5, 0.2);
    expect(upgraded.fuel.capacityLiters).toBe(450);
    expect(upgraded.fuel.fuelLiters).toBe(300);
    expect(upgraded.fuel.fraction).toBeCloseTo(2 / 3, 12);
    expect(upgraded.fuel.refuel()).toEqual({ ok: true, value: { liters: 150, cost: 1500 } });

    upgraded.fuel.restore(300);
    parkOnTheRoad(plain.driving);
    parkOnTheRoad(upgraded.driving);
    driveFor(plain, 5);
    driveFor(upgraded, 5);
    const plainBurn = (300 - plain.fuel.fuelLiters) / plain.driving.vehicle.odometerMeters;
    const upgradedBurn = (300 - upgraded.fuel.fuelLiters) / upgraded.driving.vehicle.odometerMeters;
    expect(upgradedBurn).toBeCloseTo(plainBurn * 0.8, 9);
  });

  it('keeps what fits when the tank gets smaller, and ignores unusable bonuses', () => {
    const context = setup();
    context.fuel.setUpgradeBonuses(0.5, 0);
    context.fuel.restore(450);

    context.fuel.setUpgradeBonuses(0, 0);
    expect(context.fuel.fuelLiters).toBe(300);

    context.fuel.setUpgradeBonuses(Number.NaN, 5);
    expect(context.fuel.capacityLiters).toBe(300);
    driveFor(context, 2);
    expect(context.fuel.fuelLiters).toBeLessThan(300); // At most 90 % saved: fuel still burns.
  });

  it('fills up at the pump only in a depot yard or at a rest area; the fuel truck comes anywhere', () => {
    const context = setup();
    context.fuel.restore(200);
    parkOnTheRoad(context.driving);

    expect(context.fuel.atPump).toBe(false);
    expect(context.fuel.refuel()).toEqual({ ok: false, error: 'notAtServicePoint' });
    expect(context.fuel.refuel(true)).toEqual({ ok: true, value: { liters: 100, cost: 2000 } });

    context.fuel.restore(200);
    parkInYard(context.driving);
    expect(context.fuel.atPump).toBe(true);
    expect(context.fuel.refuel()).toEqual({ ok: true, value: { liters: 100, cost: 1000 } });
  });

  it('buys what the company can afford when a full tank is too dear', () => {
    const context = setup(95);
    context.fuel.restore(100);

    expect(context.fuel.refuel()).toEqual({ ok: true, value: { liters: 9, cost: 90 } });
    expect(context.fuel.fuelLiters).toBe(109);
    expect(context.economy.credits).toBe(5);
  });

  it('gives a stranded, broke company emergency fuel for free, so it is never stuck', () => {
    const context = setup(0);
    context.fuel.restore(0);

    expect(context.driving.isEngineRunning).toBe(false);
    expect(context.fuel.refuel(true)).toEqual({ ok: true, value: { liters: EMERGENCY_FUEL_LITERS, cost: 0 } });
    expect(context.driving.isEngineRunning).toBe(true);

    // Not while there is still fuel in the tank.
    expect(context.fuel.refuel(true)).toEqual({ ok: false, error: 'insufficientFunds' });
  });

  it('burns more with a damaged truck', () => {
    const healthy = setup();
    const damaged = setup();
    damaged.damage.restore(1);

    driveFor(healthy, 5);
    driveFor(damaged, 5);

    const healthyBurn = (300 - healthy.fuel.fuelLiters) / healthy.driving.vehicle.odometerMeters;
    const damagedBurn = (300 - damaged.fuel.fuelLiters) / damaged.driving.vehicle.odometerMeters;
    expect(damagedBurn).toBeGreaterThan(healthyBurn * 1.2);
  });
});
