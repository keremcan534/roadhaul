import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_CONFIG, validateGameConfig, type GameConfig } from '../../../src/data/config/GameConfig';
import { ContentCatalog } from '../../../src/data/ContentCatalog';
import { GAME_CONTENT } from '../../../src/data/content';

const catalog = ContentCatalog.create(GAME_CONTENT);

function withChanges(changes: {
  simulation?: Partial<GameConfig['simulation']>;
  missions?: Partial<GameConfig['missions']>;
  newGame?: Partial<GameConfig['newGame']>;
}): GameConfig {
  return {
    ...DEFAULT_GAME_CONFIG,
    simulation: { ...DEFAULT_GAME_CONFIG.simulation, ...changes.simulation },
    missions: { ...DEFAULT_GAME_CONFIG.missions, ...changes.missions },
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
      missions: { loadingSeconds: 0 },
      newGame: { startingCredits: -100 },
    });

    expect(validateGameConfig(config, catalog).map((issue) => issue.path)).toEqual([
      'simulation.fixedStepSeconds',
      'simulation.maxStepsPerFrame',
      'missions.loadingSeconds',
      'newGame.startingCredits',
    ]);
  });

  it('checks prices, fuel tuning and the company levels', () => {
    const config: GameConfig = {
      ...DEFAULT_GAME_CONFIG,
      economy: { fuelPricePerLiter: 0, roadsideFuelPriceFactor: 0.5, fullRepairCost: 99.5 },
      fuel: { consumptionScale: -1, lowFuelFraction: 2 },
      company: { levelXp: [100, 50, 60, 70, 80] },
    };

    expect(validateGameConfig(config, catalog).map((issue) => issue.path)).toEqual([
      'economy.fuelPricePerLiter',
      'economy.roadsideFuelPriceFactor',
      'economy.fullRepairCost',
      'fuel.consumptionScale',
      'fuel.lowFuelFraction',
      'company.levelXp',
    ]);
  });

  it('reports contracts, trucks and upgrades locked behind a company level that does not exist', () => {
    const config: GameConfig = { ...DEFAULT_GAME_CONFIG, company: { levelXp: [0, 1000] } };
    const beyondLevel2 = (level: number | undefined): boolean => (level ?? 1) > 2;

    expect(validateGameConfig(config, catalog).map((issue) => issue.path)).toEqual([
      ...GAME_CONTENT.missions.flatMap((mission, index) =>
        beyondLevel2(mission.requiredCompanyLevel) ? [`content.missions[${index}].requiredCompanyLevel`] : [],
      ),
      ...GAME_CONTENT.vehicles.flatMap((vehicle, index) =>
        beyondLevel2(vehicle.requiredCompanyLevel) ? [`content.vehicles[${index}].requiredCompanyLevel`] : [],
      ),
      ...GAME_CONTENT.upgrades.flatMap((upgrade, upgradeIndex) =>
        upgrade.levels.flatMap((level, index) =>
          beyondLevel2(level.requiredCompanyLevel)
            ? [`content.upgrades[${upgradeIndex}].levels[${index}].requiredCompanyLevel`]
            : [],
        ),
      ),
    ]);
    expect(validateGameConfig(config, catalog).length).toBeGreaterThan(10);
  });

  it('requires the frame clamp to allow at least one fixed step', () => {
    const config = withChanges({ simulation: { fixedStepSeconds: 0.05, maxFrameDeltaSeconds: 0.01 } });

    expect(validateGameConfig(config, catalog).map((issue) => issue.path)).toEqual([
      'simulation.maxFrameDeltaSeconds',
    ]);
  });
});
