import { describe, expect, it } from 'vitest';
import {
  applyQualityPreset,
  DEFAULT_GAME_CONFIG,
  QUALITY_LEVELS,
  QUALITY_PRESETS,
  validateGameConfig,
  type GameConfig,
} from '../../../src/data/config/GameConfig';
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
      missions: { loadingSeconds: 0, dailyContracts: { count: 2.5, refreshHours: 0 } },
      newGame: { startingCredits: -100 },
    });

    expect(validateGameConfig(config, catalog).map((issue) => issue.path)).toEqual([
      'simulation.fixedStepSeconds',
      'simulation.maxStepsPerFrame',
      'missions.loadingSeconds',
      'missions.dailyContracts.count',
      'missions.dailyContracts.refreshHours',
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

  it('checks the traffic: how many vehicles, how far round the truck, and a speed limit for every kind of road', () => {
    const config: GameConfig = {
      ...DEFAULT_GAME_CONFIG,
      traffic: {
        maxVehicles: 2.5,
        radiusMeters: 100,
        minSpawnDistanceMeters: 150,
        speedLimitsKmh: { street: 45, ringRoad: 0, highway: 90 } as GameConfig['traffic']['speedLimitsKmh'],
      },
    };

    expect(validateGameConfig(config, catalog).map((issue) => issue.path)).toEqual([
      'traffic.maxVehicles',
      'traffic.radiusMeters',
      'traffic.speedLimitsKmh.ringRoad',
      'traffic.speedLimitsKmh.rural',
    ]);
    expect(
      validateGameConfig({ ...DEFAULT_GAME_CONFIG, traffic: { ...DEFAULT_GAME_CONFIG.traffic, maxVehicles: 0 } }, catalog),
    ).toEqual([]);
  });

  it('keeps the arrival-time pace a share of the speed limit', () => {
    for (const etaPaceFactor of [0, 1.2, Number.NaN]) {
      const config: GameConfig = { ...DEFAULT_GAME_CONFIG, navigation: { etaPaceFactor } };
      expect(validateGameConfig(config, catalog).map((issue) => issue.path), String(etaPaceFactor)).toEqual([
        'navigation.etaPaceFactor',
      ]);
    }
  });

  it('starts in weather that exists, and turns it over a positive time', () => {
    const config: GameConfig = {
      ...DEFAULT_GAME_CONFIG,
      weather: { initialWeatherId: 'hurricane', changes: 'yes' as unknown as boolean, transitionSeconds: 0 },
    };

    expect(validateGameConfig(config, catalog)).toEqual([
      { path: 'weather.initialWeatherId', message: 'unknown weather "hurricane"' },
      { path: 'weather.changes', message: expect.any(String) },
      { path: 'weather.transitionSeconds', message: expect.any(String) },
    ]);
  });

  it('ships the high graphics preset by default, and a valid config for every preset', () => {
    expect(applyQualityPreset(DEFAULT_GAME_CONFIG, 'high')).toEqual(DEFAULT_GAME_CONFIG);
    for (const level of QUALITY_LEVELS) {
      expect(validateGameConfig(applyQualityPreset(DEFAULT_GAME_CONFIG, level), catalog), level).toEqual([]);
    }
  });

  it('asks less of weaker devices: fewer pixels, less rain and traffic, no glows on low', () => {
    const [low, medium, high] = QUALITY_LEVELS.map((level) => QUALITY_PRESETS[level]);

    expect(low!.maxPixelRatio).toBeLessThan(medium!.maxPixelRatio);
    expect(medium!.maxPixelRatio).toBeLessThan(high!.maxPixelRatio);
    expect(low!.trafficVehicles).toBeLessThan(high!.trafficVehicles);
    expect(low!.rainDensity).toBeLessThan(high!.rainDensity);
    expect(low!.lampGlows).toBe(false);
    const applied = applyQualityPreset(DEFAULT_GAME_CONFIG, 'low');
    expect(applied.rendering).toMatchObject({ quality: 'low', maxPixelRatio: low!.maxPixelRatio, lampGlows: false });
    expect(applied.traffic.maxVehicles).toBe(low!.trafficVehicles);
  });

  it('checks the graphics values', () => {
    const config: GameConfig = {
      ...DEFAULT_GAME_CONFIG,
      rendering: {
        ...DEFAULT_GAME_CONFIG.rendering,
        quality: 'ultra' as never,
        minResolutionScale: 0,
        rainDensity: 1.5,
        lampGlows: 'yes' as never,
      },
    };

    expect(validateGameConfig(config, catalog).map((issue) => issue.path)).toEqual([
      'rendering.quality',
      'rendering.minResolutionScale',
      'rendering.rainDensity',
      'rendering.lampGlows',
    ]);
  });

  it('requires the frame clamp to allow at least one fixed step', () => {
    const config = withChanges({ simulation: { fixedStepSeconds: 0.05, maxFrameDeltaSeconds: 0.01 } });

    expect(validateGameConfig(config, catalog).map((issue) => issue.path)).toEqual([
      'simulation.maxFrameDeltaSeconds',
    ]);
  });
});
