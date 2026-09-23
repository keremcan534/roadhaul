import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_CONFIG, validateGameConfig, type GameConfig } from '../../../src/data/config/GameConfig';
import { ContentCatalog } from '../../../src/data/ContentCatalog';
import { GAME_CONTENT } from '../../../src/data/content';

const catalog = ContentCatalog.create(GAME_CONTENT);

function withChanges(changes: {
  simulation?: Partial<GameConfig['simulation']>;
  newGame?: Partial<GameConfig['newGame']>;
}): GameConfig {
  return {
    ...DEFAULT_GAME_CONFIG,
    simulation: { ...DEFAULT_GAME_CONFIG.simulation, ...changes.simulation },
    newGame: { ...DEFAULT_GAME_CONFIG.newGame, ...changes.newGame },
  };
}

describe('GameConfig', () => {
  it('ships a default config that is valid for the built-in content', () => {
    expect(validateGameConfig(DEFAULT_GAME_CONFIG, catalog)).toEqual([]);
  });

  it('is frozen, so no code can change the defaults at runtime', () => {
    expect(Object.isFrozen(DEFAULT_GAME_CONFIG)).toBe(true);
    expect(Object.isFrozen(DEFAULT_GAME_CONFIG.newGame)).toBe(true);
  });

  it('reports a starting vehicle that does not exist', () => {
    const config = withChanges({ newGame: { startingVehicleId: 'ghost_truck' } });

    expect(validateGameConfig(config, catalog)).toEqual([
      { path: 'newGame.startingVehicleId', message: 'unknown vehicle "ghost_truck"' },
    ]);
  });

  it('reports out-of-range values', () => {
    const config = withChanges({
      simulation: { fixedStepSeconds: 0, maxStepsPerFrame: 0 },
      newGame: { startingCredits: -100 },
    });

    expect(validateGameConfig(config, catalog).map((issue) => issue.path)).toEqual([
      'simulation.fixedStepSeconds',
      'simulation.maxStepsPerFrame',
      'newGame.startingCredits',
    ]);
  });

  it('requires the frame clamp to allow at least one fixed step', () => {
    const config = withChanges({ simulation: { fixedStepSeconds: 0.05, maxFrameDeltaSeconds: 0.01 } });

    expect(validateGameConfig(config, catalog).map((issue) => issue.path)).toEqual([
      'simulation.maxFrameDeltaSeconds',
    ]);
  });
});
