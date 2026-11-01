import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../../../../src/core/storage/KeyValueStorage';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import { MISSIONS } from '../../../../src/data/content/missions';
import { emptyCareer } from '../../../../src/domain/career/careerRecords';
import { bootGame, deliver, newCompany, parkAtDepot, parkInTargetBay, play } from '../../../support/game';
import { STEP_SECONDS } from '../../../support/driving';

const mission = (id: string) => MISSIONS.find((candidate) => candidate.id === id)!;

describe('CareerService', () => {
  it('starts a company with nothing on its record', async () => {
    const game = await newCompany(1, 5000);

    expect(game.career.records).toEqual({ ...emptyCareer(), favouriteCargoId: null, favouriteCityId: null });
  });

  it('records a delivery: its tons, its pay, its cargo and its town, the haul driven loaded', async () => {
    const game = await newCompany(1, 5000);
    let paid = 0;
    game.events.on('MissionCompleted', ({ reward }) => (paid = reward.total));
    const first = mission('first_package');

    game.missions.accept(first.id);
    play(game, STEP_SECONDS);
    // Driven before the pickup: not part of the haul.
    play(game, 3, 1);
    parkInTargetBay(game);
    play(game, DEFAULT_GAME_CONFIG.missions.loadingSeconds + 0.1);
    expect(game.missions.active!.state).toBe('loaded');
    const before = game.session.distanceDrivenMeters;
    play(game, 4, 1);
    const haul = game.session.distanceDrivenMeters - before;
    expect(haul).toBeGreaterThan(5);
    expect(game.career.records.haulMeters).toBeCloseTo(haul, 1);
    parkInTargetBay(game);
    play(game, DEFAULT_GAME_CONFIG.missions.loadingSeconds + 0.1);

    const records = game.career.records;
    expect(records.tonsDelivered).toBe(first.cargoWeightTons);
    expect(records.bestPay).toBe(paid);
    expect(records.longestHaulMeters).toBeCloseTo(haul, 1);
    expect(records.haulMeters).toBe(0);
    expect(records.cargo).toEqual({ [first.cargoId]: 1 });
    expect(records.destinations).toEqual({ [first.destinationCityId]: 1 });
    expect(records.favouriteCargoId).toBe(first.cargoId);
    expect(records.favouriteCityId).toBe(first.destinationCityId);
    expect(records.topSpeedKmh).toBeGreaterThan(5);
    expect(records.drivingSeconds).toBeGreaterThan(7);
  });

  it('keeps the longest haul and the best pay, and adds up the rest', async () => {
    const game = await newCompany(2, 50_000);
    deliver(game, 'first_package');
    const after = game.career.records;
    deliver(game, 'first_package');

    const records = game.career.records;
    expect(records.tonsDelivered).toBeCloseTo(after.tonsDelivered * 2, 6);
    expect(records.bestPay).toBe(after.bestPay);
    expect(records.cargo[mission('first_package').cargoId]).toBe(2);
    expect(records.longestHaulMeters).toBeGreaterThanOrEqual(after.longestHaulMeters);
  });

  it('counts the diesel bought, the repairs paid and the knocks taken', async () => {
    const game = await newCompany(1, 50_000);
    parkAtDepot(game);
    game.fuel.restore(10);

    const refuelled = game.fuel.refuel();
    expect(refuelled.ok).toBe(true);
    game.events.emit('VehicleCollided', { impactSpeedMetersPerSecond: 8 });
    game.events.emit('VehicleCollided', { impactSpeedMetersPerSecond: 9 });
    const repaired = game.damage.repair();
    expect(repaired.ok).toBe(true);
    game.events.emit('TruckOverturned', { speedMetersPerSecond: 12 });
    game.events.emit('VehicleWrecked', { x: 0, z: 0, speedMetersPerSecond: 10, color: 0xffffff });
    game.events.emit('PropKnockedOver', { kind: 'lamp', x: 0, z: 0, speedMetersPerSecond: 6, byTruck: true });
    game.events.emit('PropKnockedOver', { kind: 'lamp', x: 0, z: 0, speedMetersPerSecond: 6, byTruck: false });

    const records = game.career.records;
    expect(refuelled.ok && records.fuelLiters).toBeCloseTo(refuelled.ok ? refuelled.value.liters : 0, 6);
    expect(refuelled.ok && records.fuelSpent).toBe(refuelled.ok ? refuelled.value.cost : -1);
    expect(records.repairsSpent).toBe(repaired.ok ? repaired.value : -1);
    expect(records.knocks).toBe(2);
    expect(records.overturns).toBe(1);
    expect(records.carsWrecked).toBe(1);
    expect(records.propsKnocked).toBe(1);
  });

  it('forgets a haul when its contract fails', async () => {
    const game = await newCompany(1, 5000);
    game.missions.accept('first_package');
    play(game, STEP_SECONDS);
    parkInTargetBay(game);
    play(game, DEFAULT_GAME_CONFIG.missions.loadingSeconds + 0.1);
    play(game, 3, 1);
    expect(game.career.records.haulMeters).toBeGreaterThan(0);

    game.missions.abandon();

    expect(game.career.records.haulMeters).toBe(0);
    expect(game.career.records.longestHaulMeters).toBe(0);
  });

  it('keeps the record in the save, the haul under way too; a new company starts without', async () => {
    const storage = new MemoryStorage();
    const first = await bootGame(storage);
    first.session.startNewGame('Kuzey Lojistik');
    deliver(first, 'first_package');
    first.events.emit('VehicleCollided', { impactSpeedMetersPerSecond: 8 });
    first.missions.accept('first_package');
    play(first, STEP_SECONDS);
    parkInTargetBay(first);
    play(first, DEFAULT_GAME_CONFIG.missions.loadingSeconds + 0.1);
    play(first, 2, 1);
    const kept = first.career.records;
    first.session.save();

    const second = await bootGame(storage);
    second.session.continueGame();
    expect(second.career.records).toEqual(kept);

    second.session.startNewGame('Güney Nakliyat');
    expect(second.career.records).toEqual({ ...emptyCareer(), favouriteCargoId: null, favouriteCityId: null });
  });
});
