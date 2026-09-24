import { describe, expect, it } from 'vitest';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { deliver, newCompany, play } from '../../../support/game';

describe('GarageService', () => {
  it('starts a company with the H1, and shows the dealer\'s bigger trucks locked until their level', async () => {
    const game = await newCompany();

    expect(game.garage.trucks).toEqual([
      expect.objectContaining({ instanceId: 'truck_001', definition: expect.objectContaining({ id: 'rh_h1' }), active: true }),
    ]);
    expect(game.garage.dealer().map((offer) => [offer.definition.id, offer.price, offer.locked, offer.owned])).toEqual([
      ['rh_h1', 12000, false, true],
      ['rh_h2', 22000, true, false],
      ['rh_h3', 38000, true, false],
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
    expect(game.garage.buy('rh_h2')).toEqual({ ok: false, error: 'alreadyOwned' });
    expect(game.garage.buy('rh_h1')).toEqual({ ok: false, error: 'alreadyOwned' });
    expect(game.garage.buy('rh_h9')).toEqual({ ok: false, error: 'unknownVehicle' });
    expect(game.garage.trucks.map((truck) => truck.instanceId)).toEqual(['truck_001', 'truck_002']);
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
