import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../../../../src/core/storage/KeyValueStorage';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import type { SaveGameData } from '../../../../src/domain/save/SaveGameData';
import { SAVE_KEYS } from '../../../../src/systems/save/SaveService';
import { AUTOSAVE_INTERVAL_SECONDS } from '../../../../src/systems/session/GameSessionService';
import { STEP_SECONDS } from '../../../support/driving';
import { bootGame as boot, parkInTargetBay, play, reachLevel } from '../../../support/game';

describe('GameSessionService', () => {
  it('founds a new company with the starting truck, credits and a full tank, and saves it', async () => {
    const game = await boot();
    expect(game.session.hasSavedGame()).toBe(false);

    expect(game.session.startNewGame('  Kuzey   Lojistik ')).toEqual({ ok: true, value: undefined });

    expect(game.session.isActive).toBe(true);
    expect(game.company.companyName).toBe('Kuzey Lojistik');
    expect(game.economy.credits).toBe(DEFAULT_GAME_CONFIG.newGame.startingCredits);
    expect(game.fuel.fraction).toBe(1);
    expect(game.damage.damage).toBe(0);
    expect(game.session.hasSavedGame()).toBe(true);
  });

  it('rejects a bad company name without starting anything', async () => {
    const game = await boot();

    expect(game.session.startNewGame(' ')).toEqual({ ok: false, error: 'tooShort' });
    expect(game.session.isActive).toBe(false);
    expect(game.session.hasSavedGame()).toBe(false);
  });

  it('continues a game exactly where it was left: money, progress, truck, fuel, damage and the contract', async () => {
    const first = await boot();
    first.session.startNewGame('Kuzey Lojistik');
    first.missions.accept('first_package');
    play(first, STEP_SECONDS);
    parkInTargetBay(first);
    play(first, DEFAULT_GAME_CONFIG.missions.loadingSeconds + 0.1);
    play(first, 3, 1);
    first.events.emit('VehicleCollided', { impactSpeedMetersPerSecond: 7 });
    first.economy.spend(123, 'repair');
    first.session.save(); // As when the page is hidden or closed.
    const before = first.session.snapshot();

    const second = await boot(first.storage, 5_000);
    expect(second.session.continueGame()).toEqual({ ok: true, value: undefined });

    const after = second.session.snapshot();
    expect(after).toEqual({ ...before, updatedAtMs: 5_000 });
    expect(second.missions.active?.state).toBe('delivering');
    expect(second.missions.target?.kind).toBe('delivery');
    expect(second.driving.totalMassKg).toBe(first.driving.totalMassKg);
    expect(second.damage.damage).toBeGreaterThan(0);
  });

  it('saves on its own after a delivery, and every few seconds of driving', async () => {
    const game = await boot();
    game.session.startNewGame('Kuzey Lojistik');
    const savedCredits = (): number => JSON.parse(game.storage.getItem(SAVE_KEYS.main)!).economy.credits;
    const savedDistance = (): number => JSON.parse(game.storage.getItem(SAVE_KEYS.main)!).stats.distanceDrivenMeters;

    game.missions.accept('first_package');
    play(game, STEP_SECONDS);
    parkInTargetBay(game);
    play(game, DEFAULT_GAME_CONFIG.missions.loadingSeconds + 0.1);
    play(game, 1, 1);
    parkInTargetBay(game);
    play(game, DEFAULT_GAME_CONFIG.missions.loadingSeconds + 0.1);
    expect(savedCredits()).toBe(game.economy.credits);
    expect(savedCredits()).toBeGreaterThan(DEFAULT_GAME_CONFIG.newGame.startingCredits);
    const distance = savedDistance();

    play(game, AUTOSAVE_INTERVAL_SECONDS + 1, 1);
    expect(savedDistance()).toBeGreaterThan(distance);
  });

  it('saves each purchase together with what it bought', async () => {
    const game = await boot();
    game.session.startNewGame('Kuzey Lojistik');
    const saved = (): SaveGameData => JSON.parse(game.storage.getItem(SAVE_KEYS.main)!) as SaveGameData;
    const savedTruck = (index = 0) => saved().garage.vehicles[index]!;
    play(game, 5, 1);
    game.events.emit('VehicleCollided', { impactSpeedMetersPerSecond: 7 });
    reachLevel(game, 2);
    game.economy.restore(40_000);

    game.fuel.restore(60);
    expect(game.fuel.refuel().ok).toBe(true);
    expect(savedTruck().fuelLiters).toBe(150);
    expect(saved().economy.credits).toBe(game.economy.credits);

    expect(game.damage.repair().ok).toBe(true);
    expect(savedTruck().damage).toBe(0);
    expect(saved().economy.credits).toBe(game.economy.credits);

    game.upgrades.buy('engine');
    expect(savedTruck().upgrades).toEqual({ engine: 1 });

    game.garage.buy('rh_h2');
    expect(saved().garage.vehicles.map((truck) => truck.definitionId)).toEqual(['rh_h1', 'rh_h2']);

    game.garage.switchTo('truck_002');
    expect(saved().garage.activeVehicleInstanceId).toBe('truck_002');
    expect(saved().economy.credits).toBe(game.economy.credits);
  });

  it('continues with every truck, the one being driven and each one\'s upgrades', async () => {
    const first = await boot();
    first.session.startNewGame('Kuzey Lojistik');
    reachLevel(first, 2);
    first.economy.restore(40_000);
    first.upgrades.buy('fuel_tank');
    first.garage.buy('rh_h2');
    first.garage.switchTo('truck_002');
    first.upgrades.buy('brakes');
    play(first, 3, 1);
    first.session.save();

    const second = await boot(first.storage, 9_000);
    second.session.continueGame();

    expect(second.driving.definition.id).toBe('rh_h2');
    expect(second.garage.activeTruck.upgrades).toEqual({ brakes: 1 });
    expect(second.garage.trucks[0]!.upgrades).toEqual({ fuel_tank: 1 });
    expect(second.fuel.fuelLiters).toBeCloseTo(first.fuel.fuelLiters, 9);
    expect(second.session.snapshot()).toEqual({ ...first.session.snapshot(), updatedAtMs: 9_000 });
  });

  it('reports a missing or corrupted save and keeps playing nothing', async () => {
    const missing = await boot();
    expect(missing.session.continueGame()).toEqual({ ok: false, error: 'missing' });

    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEYS.main, '{broken');
    const corrupted = await boot(storage);
    expect(corrupted.session.continueGame()).toEqual({ ok: false, error: 'corrupted' });
    expect(corrupted.session.isActive).toBe(false);
  });

  it('does not write before a game is loaded', async () => {
    const game = await boot();

    expect(game.session.save()).toEqual({ ok: true, value: undefined });
    expect(game.storage.keys()).toEqual([]);
  });
});
