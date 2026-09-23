import { isLogLevel, type LogLevel } from '../../core/logging/Logger';
import { frozenCopy } from '../../core/objects/frozenCopy';
import { Validator, type ValidationIssue } from '../../core/validation/Validator';
import type { ContentCatalog } from '../ContentCatalog';
import type { Credits, Fraction } from '../units';

/**
 * Central tuning values (spec §17: prices and limits live in config, not in
 * world objects). Game code receives the config through the composition root.
 */
export interface GameConfig {
  readonly simulation: {
    /** Duration of one fixed simulation step. */
    readonly fixedStepSeconds: number;
    /** Cap on catch-up steps per frame on slow devices. */
    readonly maxStepsPerFrame: number;
    /** Longer frames are clamped to this (tab switches, hitches). */
    readonly maxFrameDeltaSeconds: number;
  };
  readonly rendering: {
    /**
     * Upper bound for the device pixel ratio. Phones report 2.5 to 4, and
     * rendering at that resolution costs more fill rate than low/mid devices have.
     */
    readonly maxPixelRatio: number;
    readonly antialias: boolean;
  };
  readonly missions: {
    /** Seconds the truck must stand still in a bay to load or unload (spec §12). */
    readonly loadingSeconds: number;
  };
  readonly economy: {
    /** Price of a litre of diesel at a depot pump (spec §17: prices live in config, not in the world). */
    readonly fuelPricePerLiter: Credits;
    /** Fuel brought to a truck stranded on the road costs this many times the pump price. */
    readonly roadsideFuelPriceFactor: number;
    /** Repairing a truck from 100% damage costs this much; less damage costs proportionally less. */
    readonly fullRepairCost: Credits;
  };
  readonly fuel: {
    /**
     * The region is a miniature of real roads (spec §76's 35 km prototype in
     * about 11 km): fuel burns as if every map meter were this many. Spec §17
     * still sets the relative consumption. A full tank lasts eight or nine
     * contracts.
     */
    readonly consumptionScale: number;
    /** The HUD warns below this share of a full tank. */
    readonly lowFuelFraction: Fraction;
  };
  readonly company: {
    /** XP at which each company level starts, level 1 first (spec §14: five levels in the first version). */
    readonly levelXp: readonly number[];
  };
  readonly newGame: {
    readonly startingCredits: Credits;
    /** VehicleDefinition id of the truck every new company starts with. */
    readonly startingVehicleId: string;
    /** MapDefinition id the driving starts on. */
    readonly startingMapId: string;
  };
  readonly debug: {
    readonly logLevel: LogLevel;
    /** Shows FPS, draw calls and triangles (enable in the browser with `?debug`). */
    readonly showPerfOverlay: boolean;
  };
}

export const DEFAULT_GAME_CONFIG: GameConfig = frozenCopy<GameConfig>({
  simulation: {
    fixedStepSeconds: 1 / 60,
    maxStepsPerFrame: 5,
    maxFrameDeltaSeconds: 0.25,
  },
  rendering: {
    maxPixelRatio: 1.5,
    antialias: false,
  },
  missions: {
    loadingSeconds: 3,
  },
  economy: {
    fuelPricePerLiter: 12,
    roadsideFuelPriceFactor: 2,
    fullRepairCost: 6000,
  },
  fuel: {
    consumptionScale: 10,
    lowFuelFraction: 0.15,
  },
  company: {
    levelXp: [0, 1000, 3000, 6500, 12000],
  },
  newGame: {
    startingCredits: 5000, // Placeholder until the economy step (roadmap step 14).
    startingVehicleId: 'rh_h1',
    startingMapId: 'north_valley',
  },
  debug: {
    logLevel: 'info',
    showPerfOverlay: false,
  },
});

/** Checks value ranges and that the config only references existing content. */
export function validateGameConfig(config: GameConfig, content: ContentCatalog): readonly ValidationIssue[] {
  const validator = new Validator();
  const { simulation, rendering, missions, economy, fuel, company, newGame, debug } = config;

  validator.check(
    Number.isFinite(simulation.fixedStepSeconds) &&
      simulation.fixedStepSeconds > 0 &&
      simulation.fixedStepSeconds <= 0.1,
    'simulation.fixedStepSeconds',
    'must be greater than 0 and at most 0.1',
  );
  validator.positiveInteger(simulation.maxStepsPerFrame, 'simulation.maxStepsPerFrame');
  validator.check(
    Number.isFinite(simulation.maxFrameDeltaSeconds) && simulation.maxFrameDeltaSeconds >= simulation.fixedStepSeconds,
    'simulation.maxFrameDeltaSeconds',
    'must be at least fixedStepSeconds',
  );
  validator.positiveNumber(rendering.maxPixelRatio, 'rendering.maxPixelRatio');
  validator.boolean(rendering.antialias, 'rendering.antialias');
  validator.check(
    Number.isFinite(missions.loadingSeconds) && missions.loadingSeconds > 0 && missions.loadingSeconds <= 30,
    'missions.loadingSeconds',
    'must be greater than 0 and at most 30',
  );
  validator.positiveInteger(economy.fuelPricePerLiter, 'economy.fuelPricePerLiter');
  validator.check(
    Number.isFinite(economy.roadsideFuelPriceFactor) && economy.roadsideFuelPriceFactor >= 1,
    'economy.roadsideFuelPriceFactor',
    'must be at least 1',
  );
  validator.positiveInteger(economy.fullRepairCost, 'economy.fullRepairCost');
  validator.positiveNumber(fuel.consumptionScale, 'fuel.consumptionScale');
  validator.fraction(fuel.lowFuelFraction, 'fuel.lowFuelFraction');
  const levels = company.levelXp;
  validator.check(
    Array.isArray(levels) &&
      levels.length > 0 &&
      levels[0] === 0 &&
      levels.every((xp, index) => Number.isInteger(xp) && (index === 0 || xp > levels[index - 1]!)),
    'company.levelXp',
    'must start at 0 and rise strictly in whole numbers',
  );
  // Whatever needs a company level must need one the company can reach.
  const checkReachable = (id: string, requiredLevel: number | undefined, path: string): void => {
    validator.check(
      (requiredLevel ?? 1) <= levels.length,
      path,
      `"${id}" needs level ${requiredLevel}, but the company only has ${levels.length} levels`,
    );
  };
  content.missions.all.forEach((mission, index) => {
    checkReachable(mission.id, mission.requiredCompanyLevel, `content.missions[${index}].requiredCompanyLevel`);
  });
  content.vehicles.all.forEach((vehicle, index) => {
    checkReachable(vehicle.id, vehicle.requiredCompanyLevel, `content.vehicles[${index}].requiredCompanyLevel`);
  });
  content.upgrades.all.forEach((upgrade, upgradeIndex) => {
    upgrade.levels.forEach((level, index) => {
      checkReachable(
        upgrade.id,
        level.requiredCompanyLevel,
        `content.upgrades[${upgradeIndex}].levels[${index}].requiredCompanyLevel`,
      );
    });
  });
  validator.nonNegativeInteger(newGame.startingCredits, 'newGame.startingCredits');
  validator.check(
    content.vehicles.has(newGame.startingVehicleId),
    'newGame.startingVehicleId',
    `unknown vehicle "${newGame.startingVehicleId}"`,
  );
  validator.check(
    content.maps.has(newGame.startingMapId),
    'newGame.startingMapId',
    `unknown map "${newGame.startingMapId}"`,
  );
  validator.check(isLogLevel(debug.logLevel), 'debug.logLevel', `unknown log level "${debug.logLevel}"`);
  validator.boolean(debug.showPerfOverlay, 'debug.showPerfOverlay');
  return validator.issues;
}
