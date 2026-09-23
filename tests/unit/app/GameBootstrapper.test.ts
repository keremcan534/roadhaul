import { describe, expect, it } from 'vitest';
import { GameBootstrapper, type BootstrapOptions } from '../../../src/app/GameBootstrapper';
import { ServiceKeys } from '../../../src/app/ServiceKeys';
import { MemoryStorage } from '../../../src/core/storage/KeyValueStorage';
import { ValidationError } from '../../../src/core/validation/Validator';
import { DEFAULT_GAME_CONFIG } from '../../../src/data/config/GameConfig';
import { GAME_CONTENT } from '../../../src/data/content';
import { contentFixture, missionFixture } from '../../support/contentFixtures';
import { MemoryLogger } from '../../support/MemoryLogger';

function options(overrides: Partial<BootstrapOptions> = {}): BootstrapOptions {
  return {
    config: DEFAULT_GAME_CONFIG,
    content: GAME_CONTENT,
    logger: new MemoryLogger(),
    clock: { now: () => 1_000 },
    storage: new MemoryStorage(),
    ...overrides,
  };
}

describe('GameBootstrapper', () => {
  it('boots the built-in content into the main menu', async () => {
    const container = await new GameBootstrapper(options()).boot();

    expect(container.resolve(ServiceKeys.gameState).current).toBe('mainMenu');
    expect(container.resolve(ServiceKeys.content).vehicles.has(DEFAULT_GAME_CONFIG.newGame.startingVehicleId)).toBe(
      true,
    );
  });

  it('registers a service for every service key', async () => {
    const container = await new GameBootstrapper(options()).boot();

    for (const key of Object.values(ServiceKeys)) {
      expect(container.has(key), key.name).toBe(true);
    }
  });

  it('logs a boot summary', async () => {
    const logger = new MemoryLogger();

    await new GameBootstrapper(options({ logger })).boot();

    expect(logger.messages('info')).toContain(
      'Ready in 0 ms: vehicles 3, cargo types 8, cities 3, missions 20, maps 1, upgrades 5.',
    );
  });

  it('rejects invalid content with a ValidationError', async () => {
    const content = contentFixture({ missions: [missionFixture({ cargoId: 'missing_cargo' })] });

    await expect(new GameBootstrapper(options({ content })).boot()).rejects.toThrow(ValidationError);
  });

  it('rejects a config that references unknown content', async () => {
    const config = {
      ...DEFAULT_GAME_CONFIG,
      newGame: { ...DEFAULT_GAME_CONFIG.newGame, startingVehicleId: 'ghost_truck' },
    };

    await expect(new GameBootstrapper(options({ config })).boot()).rejects.toThrow('newGame.startingVehicleId');
  });

  it('refuses to boot twice', async () => {
    const bootstrapper = new GameBootstrapper(options());
    await bootstrapper.boot();

    await expect(bootstrapper.boot()).rejects.toThrow('already booted');
  });

  it('refuses a second boot while the first one is still running', async () => {
    const bootstrapper = new GameBootstrapper(options());

    const first = bootstrapper.boot();
    const second = bootstrapper.boot();

    await expect(second).rejects.toThrow('already booted or booting');
    await expect(first).resolves.toBeDefined();
  });

  it('disposes every service on shutdown and tolerates repeated shutdowns', async () => {
    const bootstrapper = new GameBootstrapper(options());
    const container = await bootstrapper.boot();
    const events = container.resolve(ServiceKeys.events);
    events.on('GameStateChanged', () => {});

    bootstrapper.shutdown();

    expect(events.listenerCount('GameStateChanged')).toBe(0);
    expect(() => container.resolve(ServiceKeys.events)).toThrow('disposed');
    expect(() => bootstrapper.shutdown()).not.toThrow();
  });
});
