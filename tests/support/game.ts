import { GameBootstrapper } from '../../src/app/GameBootstrapper';
import { ServiceKeys } from '../../src/app/ServiceKeys';
import { MemoryStorage } from '../../src/core/storage/KeyValueStorage';
import { DEFAULT_GAME_CONFIG, type GameConfig } from '../../src/data/config/GameConfig';
import { GAME_CONTENT } from '../../src/data/content';
import { bayParkingPose } from '../../src/domain/missions/loadingBay';
import { input, STEP_SECONDS } from './driving';
import { MemoryLogger } from './MemoryLogger';

/**
 * Boots the real game headless, with the shipped content, sharing `storage`
 * like a browser tab shares localStorage.
 */
export async function bootGame(storage = new MemoryStorage(), nowMs = 1_000, config: GameConfig = DEFAULT_GAME_CONFIG) {
  const services = await new GameBootstrapper({
    config,
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
    garage: services.resolve(ServiceKeys.garage),
    upgrades: services.resolve(ServiceKeys.upgrades),
    specialEvents: services.resolve(ServiceKeys.specialEvents),
    tutorial: services.resolve(ServiceKeys.tutorial),
    events: services.resolve(ServiceKeys.events),
  };
}

export type Game = Awaited<ReturnType<typeof bootGame>>;

/** Runs fixed steps like the game loop does while driving. */
export function play(game: Game, seconds: number, throttle = 0): void {
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += STEP_SECONDS) {
    game.driving.step(STEP_SECONDS, input({ throttle }));
    game.missions.update(STEP_SECONDS);
    game.fuel.update();
    game.session.update(STEP_SECONDS);
  }
}

/** Puts the truck, at rest, squarely in the bay the contract needs next. */
export function parkInTargetBay(game: Game): void {
  const pose = bayParkingPose(game.missions.target!.depot.bay, game.driving.definition.body);
  game.driving.placeTruck(pose.x, pose.z, pose.heading);
}

/** Parks the truck, at rest, in the bay of `cityId`'s depot: in its yard, where the pump and workshop are. */
export function parkAtDepot(game: Game, cityId = 'city_a'): void {
  const depot = game.driving.world.depotOf(cityId);
  if (depot === undefined) {
    throw new Error(`No depot for ${cityId} on this map.`);
  }
  const pose = bayParkingPose(depot.bay, game.driving.definition.body);
  game.driving.placeTruck(pose.x, pose.z, pose.heading);
}

/** Takes `missionId` and drives it to completion by parking in each bay: the fastest possible delivery. */
export function deliver(game: Game, missionId: string): void {
  const accepted = game.missions.accept(missionId);
  if (!accepted.ok) {
    throw new Error(`Cannot take ${missionId}: ${accepted.error}.`);
  }
  play(game, STEP_SECONDS);
  parkInTargetBay(game);
  play(game, DEFAULT_GAME_CONFIG.missions.loadingSeconds + 0.1);
  play(game, 1, 1);
  parkInTargetBay(game);
  play(game, DEFAULT_GAME_CONFIG.missions.loadingSeconds + 0.1);
}

/** Puts the company at the start of `level` (and its XP), as if it had earned it. */
export function reachLevel(game: Game, level: number, config: GameConfig = DEFAULT_GAME_CONFIG): void {
  const xp = config.company.levelXp[level - 1];
  if (xp === undefined) {
    throw new RangeError(`There is no company level ${level}.`);
  }
  game.company.restore(
    { companyName: game.company.companyName },
    { level, xp, reputation: game.company.reputation },
    { ...game.company.stats, distanceDrivenMeters: 0 },
  );
}

/** A new company in the shipped game at `level`, with `credits`. */
export async function newCompany(level = 1, credits = 50_000): Promise<Game> {
  const game = await bootGame();
  game.session.startNewGame('Kuzey Lojistik');
  reachLevel(game, level);
  game.economy.restore(credits);
  return game;
}
