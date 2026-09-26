import { describe, expect, it } from 'vitest';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { bootGame, deliver, newCompany, play, reachLevel } from '../../../support/game';

describe('GarageService', () => {
  it('starts a company with the H1, and shows the dealer\'s bigger trucks locked until their level', async () => {
    const game = await newCompany();

    expect(game.garage.trucks).toEqual([
      expect.objectContaining({ instanceId: 'truck_001', definition: expect.objectContaining({ id: 'rh_h1' }), active: true }),
    ]);
    expect(game.garage.dealer().map((offer) => [offer.definition.id, offer.price, offer.locked, offer.ownedCount])).toEqual([
      ['rh_h1', 12000, false, 1],
      ['rh_h2', 22000, true, 0],
      ['rh_h3', 38000, true, 0],
    ]);
    expect(game.garage.buy('rh_h2')).toEqual({ ok: false, error: 'locked' });
    expect(game.economy.credits).toBe(50_000);
  });

  it('sells a truck once the company reaches its level and can pay, full and without upgrades', async () => {
    const game = await newCompany(2, 30_000);
    const bought: GameEvents['VehiclePurchased'][] = [];
    game.events.on('VehiclePurchased', (event) => bought.push(event));

    const result = game.garage.buy('rh_h2');

    expect(result.ok && result.value).toMatchObject({
      instanceId: 'truck_002',
      fuelLiters: 250,
      damage: 0,
      upgrades: {},
      active: false,
    });
    expect(game.economy.credits).toBe(8000);
    expect(bought).toEqual([{ instanceId: 'truck_002', definitionId: 'rh_h2', price: 22000 }]);
    expect(game.garage.buy('rh_h2')).toEqual({ ok: false, error: 'insufficientFunds' });
    expect(game.garage.buy('rh_h9')).toEqual({ ok: false, error: 'unknownVehicle' });
    expect(game.garage.trucks.map((truck) => truck.instanceId)).toEqual(['truck_001', 'truck_002']);
  });

  it('sells a model again for the fleet, as many as the garage holds at the company\'s level', async () => {
    const game = await newCompany(1, 100_000);
    expect(game.garage.capacity).toBe(2);

    expect(game.garage.buy('rh_h1').ok).toBe(true);
    expect(game.garage.dealer()[0]!.ownedCount).toBe(2);
    expect(game.garage.hasRoom).toBe(false);
    expect(game.garage.buy('rh_h1')).toEqual({ ok: false, error: 'garageFull' });
    expect(game.economy.credits).toBe(88_000);

    // A bigger company has a bigger garage (GameConfig.fleet.garageSlots).
    reachLevel(game, 4);
    expect(game.garage.capacity).toBe(6);
    expect(game.garage.buy('rh_h1').ok).toBe(true);
    expect(game.garage.trucks.map((truck) => [truck.instanceId, truck.definition.id])).toEqual([
      ['truck_001', 'rh_h1'],
      ['truck_002', 'rh_h1'],
      ['truck_003', 'rh_h1'],
    ]);
  });

  it('never lets the player drive a truck a hired driver has out, and keeps its wear and repairs apart', async () => {
    const game = await newCompany(1, 100_000);
    game.garage.buy('rh_h1');
    game.garage.assignDriver('truck_002', 'driver_kemal');
    expect(game.garage.trucks[1]).toMatchObject({ instanceId: 'truck_002', driverId: 'driver_kemal', active: false });

    expect(game.garage.switchTo('truck_002')).toEqual({ ok: false, error: 'onTheRoad' });
    expect(() => game.garage.assignDriver('truck_001', 'driver_kemal')).toThrow();
    game.garage.wearTruck('truck_002', 0.3);
    game.garage.wearTruck('truck_002', 0.9);
    expect(game.garage.trucks[1]!.damage).toBe(1);
    expect(() => game.garage.wearTruck('truck_001', 0.1)).toThrow();
    game.garage.mendTruck('truck_002');
    expect(game.garage.trucks[1]!.damage).toBe(0);

    game.garage.assignDriver('truck_002', null);
    expect(game.garage.switchTo('truck_002').ok).toBe(true);
  });

  it('refuses a truck the company cannot pay for', async () => {
    const game = await newCompany(3, 30_000);

    expect(game.garage.buy('rh_h3')).toEqual({ ok: false, error: 'insufficientFunds' });
    expect(game.garage.trucks).toHaveLength(1);
    expect(game.economy.credits).toBe(30_000);
  });

  it('switches trucks in place, each keeping its own fuel and damage, and opens the new truck\'s contracts', async () => {
    const game = await newCompany(2);
    game.garage.buy('rh_h2');
    play(game, 4, 1);
    game.events.emit('VehicleCollided', { impactSpeedMetersPerSecond: 7 });
    const h1 = { fuel: game.fuel.fuelLiters, damage: game.damage.damage, x: game.driving.vehicle.x };
    const changes: GameEvents['ActiveVehicleChanged'][] = [];
    game.events.on('ActiveVehicleChanged', (event) => changes.push(event));
    expect(game.missions.accept('cold_chain')).toEqual({ ok: false, error: 'needsAnotherTruck' });

    expect(game.garage.switchTo('truck_002').ok).toBe(true);

    expect(changes).toEqual([{ instanceId: 'truck_002', definitionId: 'rh_h2' }]);
    expect(game.driving.definition.id).toBe('rh_h2');
    expect(game.driving.vehicle.x).toBe(h1.x);
    expect(game.fuel.fuelLiters).toBe(250);
    expect(game.fuel.capacityLiters).toBe(250);
    expect(game.damage.damage).toBe(0);
    expect(game.garage.activeTruck.instanceId).toBe('truck_002');
    expect(game.garage.trucks[0]).toMatchObject({ fuelLiters: h1.fuel, damage: h1.damage, active: false });
    expect(game.missions.jobBoard().find((offer) => offer.mission.id === 'cold_chain')?.blockedBy).toBeNull();
    expect(game.missions.jobBoard().find((offer) => offer.mission.id === 'first_package')?.blockedBy).toBeNull();

    game.garage.switchTo('truck_001');
    expect(game.fuel.fuelLiters).toBe(h1.fuel);
    expect(game.damage.damage).toBe(h1.damage);
  });

  it('never switches in the middle of a contract, nor to a truck it does not own', async () => {
    const game = await newCompany(2);
    game.garage.buy('rh_h2');

    expect(game.garage.switchTo('truck_001')).toEqual({ ok: false, error: 'alreadyActive' });
    expect(game.garage.switchTo('truck_009')).toEqual({ ok: false, error: 'unknownTruck' });
    game.missions.accept('first_package');
    expect(game.garage.switchTo('truck_002')).toEqual({ ok: false, error: 'missionInProgress' });
    expect(game.driving.definition.id).toBe('rh_h1');

    game.missions.abandon();
    expect(game.garage.switchTo('truck_002').ok).toBe(true);
  });

  it('keeps each truck\'s upgrades to itself', async () => {
    const game = await newCompany(2);
    game.garage.buy('rh_h2');
    game.upgrades.buy('fuel_tank');
    expect(game.fuel.capacityLiters).toBe(180);

    game.garage.switchTo('truck_002');

    expect(game.garage.fittedLevel('fuel_tank')).toBe(0);
    expect(game.fuel.capacityLiters).toBe(250);
    game.garage.switchTo('truck_001');
    expect(game.garage.fittedLevel('fuel_tank')).toBe(1);
    expect(game.fuel.capacityLiters).toBe(180);
  });

  it('takes the new truck on its first contract', async () => {
    const game = await newCompany(2);
    game.garage.buy('rh_h2');
    game.garage.switchTo('truck_002');
    const credits = game.economy.credits;

    deliver(game, 'cold_chain');

    expect(game.company.stats.deliveriesCompleted).toBe(1);
    expect(game.economy.credits).toBeGreaterThan(credits);
  });
});

describe('GarageService paint shop', () => {
  it('paints any of the company\'s trucks for the colour\'s price, and brings the factory colour back for free', async () => {
    const game = await newCompany(2, 30_000);
    game.garage.buy('rh_h2');
    const painted: GameEvents['VehiclePainted'][] = [];
    game.events.on('VehiclePainted', (event) => painted.push(event));
    const credits = game.economy.credits;

    // The truck waiting in the garage too, not only the one driven.
    const blue = game.garage.paint('truck_002', 'ocean_blue');
    expect(blue.ok && blue.value).toMatchObject({ instanceId: 'truck_002', paint: expect.objectContaining({ id: 'ocean_blue' }) });
    expect(game.economy.credits).toBe(credits - 1500);
    expect(game.garage.paint('truck_002', 'ocean_blue')).toEqual({ ok: false, error: 'alreadyPainted' });

    const factory = game.garage.paint('truck_002', null);
    expect(factory.ok && factory.value.paint).toBeNull();
    expect(game.economy.credits).toBe(credits - 1500);
    expect(game.garage.paint('truck_001', null)).toEqual({ ok: false, error: 'alreadyPainted' });
    expect(painted).toEqual([
      { instanceId: 'truck_002', paintId: 'ocean_blue', price: 1500 },
      { instanceId: 'truck_002', paintId: null, price: 0 },
    ]);
  });

  it('keeps the richer colours for bigger companies, and refuses unknown trucks, colours and empty wallets', async () => {
    const game = await newCompany(1, 1000);
    const shop = game.garage.paintShop();
    expect(shop.map((offer) => offer.paint.id)).toContain('royal_purple');
    expect(shop.find((offer) => offer.paint.id === 'royal_purple')).toMatchObject({ requiredCompanyLevel: 3, locked: true });
    expect(shop.find((offer) => offer.paint.id === 'signal_red')).toMatchObject({ requiredCompanyLevel: 1, locked: false });

    expect(game.garage.paint('truck_001', 'royal_purple')).toEqual({ ok: false, error: 'locked' });
    expect(game.garage.paint('truck_001', 'chrome')).toEqual({ ok: false, error: 'unknownPaint' });
    expect(game.garage.paint('truck_009', 'signal_red')).toEqual({ ok: false, error: 'unknownTruck' });
    expect(game.garage.paint('truck_001', 'signal_red')).toEqual({ ok: false, error: 'insufficientFunds' });
    expect(game.garage.activeTruck.paint).toBeNull();
    expect(game.economy.credits).toBe(1000);
  });

  it('saves the paint at once, and a continued company still has it', async () => {
    const first = await newCompany(1, 5000);
    first.garage.paint('truck_001', 'forest_green');
    expect(first.session.snapshot().garage.vehicles[0]!.paintId).toBe('forest_green');

    const second = await bootGame(first.storage, 9_000);
    second.session.continueGame();
    expect(second.garage.activeTruck.paint?.id).toBe('forest_green');
  });
});
