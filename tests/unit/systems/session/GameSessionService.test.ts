import { describe, expect, it } from 'vitest';
import { GameBootstrapper } from '../../../../src/app/GameBootstrapper';
import { ServiceKeys } from '../../../../src/app/ServiceKeys';
import { MemoryStorage } from '../../../../src/core/storage/KeyValueStorage';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import { GAME_CONTENT } from '../../../../src/data/content';
import { bayParkingPose } from '../../../../src/domain/missions/loadingBay';
import { SAVE_KEYS } from '../../../../src/systems/save/SaveService';
import { AUTOSAVE_INTERVAL_SECONDS } from '../../../../src/systems/session/GameSessionService';
import { input, STEP_SECONDS } from '../../../support/driving';
import { MemoryLogger } from '../../../support/MemoryLogger';

/** Boots the real game headless, sharing `storage` like a browser tab shares localStorage. */
async function boot(storage = new MemoryStorage(), nowMs = 1_000) {
  const services = await new GameBootstrapper({
    config: DEFAULT_GAME_CONFIG,
    content: GAME_CONTENT,
    logger: new MemoryLogger(),
    clock: { now: () => nowMs },
    storage,
  }).boot();
  return {
    storage,
    session: services.resolve(ServiceKeys.session),
    driving: services.resolve(ServiceKeys.driving),
    missions: services.resolve(ServiceKeys.missions),
    economy: services.resolve(ServiceKeys.economy),
    company: services.resolve(ServiceKeys.company),
    fuel: services.resolve(ServiceKeys.fuel),
    damage: services.resolve(ServiceKeys.damage),
    events: services.resolve(ServiceKeys.events),
  };
}

type Game = Awaited<ReturnType<typeof boot>>;

/** Runs fixed steps like the game loop does while driving. */
function play(game: Game, seconds: number, throttle = 0): void {
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += STEP_SECONDS) {
    game.driving.step(STEP_SECONDS, input({ throttle }));
    game.missions.update(STEP_SECONDS);
    game.fuel.update();
    game.session.update(STEP_SECONDS);
  }
}

function parkInTargetBay(game: Game): void {
  const pose = bayParkingPose(game.missions.target!.depot.bay, game.driving.definition.body);
  game.driving.placeTruck(pose.x, pose.z, pose.heading);
}

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
