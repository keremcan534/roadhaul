import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../../../../src/core/storage/KeyValueStorage';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import { RESEARCH } from '../../../../src/data/content/research';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { bootGame, deliver, newCompany, parkInTargetBay, play, reachLevel, type Game } from '../../../support/game';
import { STEP_SECONDS } from '../../../support/driving';

function listen<K extends keyof GameEvents>(game: Game, name: K): GameEvents[K][] {
  const heard: GameEvents[K][] = [];
  game.events.on(name, (event) => heard.push(event));
  return heard;
}

/** A company at `level` with plenty of money and research points, `researchIds` researched. */
async function companyWith(researchIds: readonly string[], level = 6): Promise<Game> {
  const game = await newCompany(level, 500_000);
  game.research.restore({ points: 1000, researched: [] });
  for (const researchId of researchIds) {
    const done = game.research.research(researchId);
    if (!done.ok) {
      throw new Error(`Cannot research ${researchId}: ${done.error}.`);
    }
  }
  return game;
}

const research = (id: string) => RESEARCH.find((step) => step.id === id)!;

describe('ResearchService', () => {
  it('starts a company with no points, each branch\'s first step open and the rest waiting for the one above', async () => {
    const game = await newCompany(1, 5000);

    expect(game.research.points).toBe(0);
    expect(game.research.offers().map((offer) => [offer.definition.id, offer.state])).toEqual(
      RESEARCH.map((step) => [step.id, step.tier === 1 ? 'available' : 'needsPrevious']),
    );
    expect(game.research.progress).toEqual({ researched: 0, total: RESEARCH.length });
    expect(game.research.readyCount(game.economy.credits)).toBe(0);
  });

  it('earns a point a delivery, two for a perfect one', async () => {
    const game = await newCompany(1, 5000);
    const earned = listen(game, 'ResearchPointsChanged');

    deliver(game, 'first_package'); // Parked straight in each bay: on time, the cargo untouched.

    expect(game.research.points).toBe(DEFAULT_GAME_CONFIG.research.pointsPerDelivery + DEFAULT_GAME_CONFIG.research.perfectBonusPoints);
    expect(game.research.lastDelivery).toEqual({ pay: 0, points: 2 });
    expect(earned).toEqual([{ points: 2, earned: 2 }]);
    expect(game.research.readyCount(game.economy.credits)).toBe(0);
  });

  it('researches a step for its points and credits, a step at a time, from its company level', async () => {
    const game = await newCompany(4, 50_000);
    const done = listen(game, 'ResearchCompleted');

    expect(game.research.research('better_rates')).toEqual({ ok: false, error: 'notEnoughPoints' });
    game.research.restore({ points: 20, researched: [] });
    expect(game.research.research('premium_clients')).toEqual({ ok: false, error: 'needsPrevious' });
    expect(game.research.research('unknown_step')).toEqual({ ok: false, error: 'unknownResearch' });

    const first = research('better_rates');
    expect(game.research.research('better_rates')).toEqual({ ok: true, value: first });
    expect(game.research.points).toBe(20 - first.points);
    expect(game.economy.credits).toBe(50_000 - first.cost);
    expect(game.research.perks.deliveryPayBonus).toBe(first.value);
    expect(done).toEqual([{ researchId: 'better_rates', points: 20 - first.points }]);
    expect(game.research.research('better_rates')).toEqual({ ok: false, error: 'researched' });

    // Tier 4 needs company level 6.
    expect(game.research.research('training_program').ok).toBe(true);
    expect(game.research.research('premium_clients').ok).toBe(true);
    expect(game.research.offers().find((offer) => offer.definition.id === 'brand_power')!.state).toBe('locked');
    expect(game.research.research('brand_power')).toEqual({ ok: false, error: 'locked' });
    expect(game.research.progress.researched).toBe(3);
  });

  it('keeps the points when the credits fall short', async () => {
    const game = await newCompany(1, 100);
    game.research.restore({ points: 5, researched: [] });

    expect(game.research.research('better_rates')).toEqual({ ok: false, error: 'insufficientFunds' });
    expect(game.research.points).toBe(5);
    expect(game.economy.credits).toBe(100);
    // Each first step, with the points: none the credits reach, all three once they do.
    expect(game.research.readyCount(game.economy.credits)).toBe(0);
    expect(game.research.readyCount(2000)).toBe(3);
  });

  it('pays the pay bonus on top of each delivery, in tens, and says so', async () => {
    const game = await companyWith(['better_rates', 'training_program', 'premium_clients']);
    const credits = game.economy.credits;
    let total = 0;
    game.events.on('MissionCompleted', ({ reward }) => (total = reward.total));

    deliver(game, 'first_package');

    const pay = Math.round((total * 0.07) / 10) * 10;
    expect(pay).toBeGreaterThan(0);
    expect(game.research.lastDelivery).toEqual({ pay, points: 2 });
    expect(game.economy.credits).toBe(credits + total + pay);
  });

  it('loads faster, keeps the cargo whole and saves diesel for the whole company', async () => {
    const plain = await newCompany(6, 500_000);
    const researched = await companyWith(['quick_loading', 'eco_driving', 'cargo_straps']);
    const { loadingSeconds } = DEFAULT_GAME_CONFIG.missions;

    // Loading: 15 % less time in the bay.
    for (const game of [plain, researched]) {
      game.missions.accept('first_package');
      play(game, STEP_SECONDS);
      parkInTargetBay(game);
      play(game, loadingSeconds * 0.86);
    }
    expect(plain.missions.active!.state).toBe('travellingToPickup');
    expect(researched.missions.active!.state).toBe('loaded');

    // Cargo damage: 15 % of a knock's kept away.
    const plainDamage = listen(plain, 'CargoDamaged');
    const researchedDamage = listen(researched, 'CargoDamaged');
    play(plain, loadingSeconds * 0.2); // Loaded now too.
    for (const game of [plain, researched]) {
      game.events.emit('VehicleCollided', { impactSpeedMetersPerSecond: 3 });
    }
    expect(researchedDamage[0]!.addedDamage).toBeCloseTo(plainDamage[0]!.addedDamage * 0.85, 6);

    // Diesel: 5 % less for the same drive.
    const before = [plain.fuel.fuelLiters, researched.fuel.fuelLiters];
    play(plain, 8, 1);
    play(researched, 8, 1);
    const used = [before[0]! - plain.fuel.fuelLiters, before[1]! - researched.fuel.fuelLiters];
    expect(used[0]).toBeGreaterThan(0);
    expect(used[1]! / used[0]!).toBeCloseTo(0.95, 2);
  });

  it('brings more contracts of the day with the logistics branch', async () => {
    const game = await companyWith([]);
    const before = game.missions.jobBoard().filter((offer) => offer.daily).length;

    game.research.research('quick_loading');
    game.research.research('dispatch_planning');

    expect(game.missions.jobBoard().filter((offer) => offer.daily).length).toBe(before + 1);
  });

  it('keeps the points and the research in the save; a new company starts without', async () => {
    const storage = new MemoryStorage();
    const first = await bootGame(storage);
    first.session.startNewGame('Kuzey Lojistik');
    reachLevel(first, 2);
    first.economy.restore(50_000);
    first.research.restore({ points: 10, researched: [] });
    first.research.research('eco_driving');
    first.session.save();

    const second = await bootGame(storage);
    second.session.continueGame();
    expect(second.research.points).toBe(10 - research('eco_driving').points);
    expect(second.research.has('eco_driving')).toBe(true);
    expect(second.research.perks.fuelUseReduction).toBe(research('eco_driving').value);

    second.session.startNewGame('Güney Nakliyat');
    expect(second.research.points).toBe(0);
    expect(second.research.has('eco_driving')).toBe(false);
    expect(second.research.perks.fuelUseReduction).toBe(0);
  });

  it('takes a save as the content has it: a step it no longer has dropped', async () => {
    const game = await newCompany(1, 5000);
    game.research.restore({ points: 3, researched: ['eco_driving', 'time_travel'] });

    expect(game.research.snapshot()).toEqual({ points: 3, researched: ['eco_driving'] });
  });
});
