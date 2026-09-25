import { isLogLevel, type LogLevel } from '../../core/logging/Logger';
import { frozenCopy } from '../../core/objects/frozenCopy';
import { MINUTES_PER_DAY } from '../../core/time/dayTime';
import { Validator, type ValidationIssue } from '../../core/validation/Validator';
import type { ContentCatalog } from '../ContentCatalog';
import { ROAD_KINDS, type RoadKind } from '../definitions/MapDefinition';
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
    /** The graphics preset these values come from (applyQualityPreset). */
    readonly quality: QualityLevel;
    /**
     * Upper bound for the device pixel ratio. Phones report 2.5 to 4, and
     * rendering at that resolution costs more fill rate than low/mid devices have.
     */
    readonly maxPixelRatio: number;
    readonly antialias: boolean;
    /** The adaptive resolution lowers the pixel ratio to no less than this share of maxPixelRatio. */
    readonly minResolutionScale: Fraction;
    /** Share of the rain's streaks drawn. */
    readonly rainDensity: Fraction;
    /** Share of the exhaust, dust and spray puffs the truck throws. */
    readonly particleDensity: Fraction;
    /** Share of the grass, flowers and bushes on the verges, and how far away they are drawn. */
    readonly vegetationDensity: Fraction;
    /** Glows round lit lamps at night. */
    readonly lampGlows: boolean;
    /**
     * The renderer's last steps (PostProcessing): the scene drawn with its
     * lights past white, then graded by the weather, with darker corners and
     * smooth edges. Off: the scene goes straight to the screen.
     */
    readonly postProcessing: boolean;
    /** With postProcessing: bright lights (lamps, the low sun) bloom into a soft glow. */
    readonly bloom: boolean;
    /** With postProcessing: multisampling of the scene (4: smooth edges); 0 smooths them in the colour pass (FXAA). */
    readonly msaaSamples: number;
    /**
     * The sun's real-time shadows of the truck and the traffic, round the
     * truck: the shadow map's size in texels (a power of two), or 0 for
     * none (the soft shadows under them stay either way).
     */
    readonly shadowMapSize: number;
  };
  readonly missions: {
    /** Seconds the truck must stand still in a bay to load or unload (spec §12). */
    readonly loadingSeconds: number;
    /**
     * Contracts of the day (spec §28–29): how many the generator adds to the
     * job board, and every how many hours a new batch replaces them.
     */
    readonly dailyContracts: { readonly count: number; readonly refreshHours: number };
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
  readonly traffic: {
    /** NPC vehicles alive at once, all around the truck (0 turns traffic off). */
    readonly maxVehicles: number;
    /** Traffic lives within this distance of the truck; vehicles further away are recycled. */
    readonly radiusMeters: number;
    /** New vehicles appear at least this far from the truck, out of sight. */
    readonly minSpawnDistanceMeters: number;
    /** Speed limits by kind of road, km/h. Each vehicle cruises at its own share of the limit. */
    readonly speedLimitsKmh: Readonly<Record<RoadKind, number>>;
  };
  readonly navigation: {
    /**
     * The arrival time (ETA) assumes the truck drives at this share of each
     * road's speed limit (or of its own top speed, if lower): a truck slows
     * for bends, junctions and traffic.
     */
    readonly etaPaceFactor: Fraction;
  };
  readonly weather: {
    /** WeatherDefinition id the game starts with. */
    readonly initialWeatherId: string;
    /** The weather whose look is a clear day's: the time of day's looks are drawn under it, the others laid over them. */
    readonly clearWeatherId: string;
    /** False keeps the initial weather for good (tests, screenshots). */
    readonly changes: boolean;
    /** One weather turns into the next over this long, seconds. */
    readonly transitionSeconds: number;
  };
  /**
   * The time of day (TimeOfDayService): the game's clock, and the sun and
   * the moon on their real paths over the region for the calendar's date.
   */
  readonly timeOfDay: {
    /** The region's latitude, degrees north: how high the sun climbs and how long the days are, through the year. */
    readonly latitudeDegrees: number;
    /** The clock time (hours) when the sun stands highest: after 12 where the time zone runs ahead of the sun. */
    readonly solarNoonHours: number;
    /** While the clock runs, this many seconds of the day pass each second: the day goes round in 72 minutes at 20. */
    readonly gameSecondsPerSecond: number;
    /** The clock's time (minutes after midnight) in a new game, until the player picks another in Settings. */
    readonly startMinutes: number;
    /** Above this elevation, degrees, the sun lights a full day: the sky is the weather's own. */
    readonly dayFromDegrees: number;
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

/** More NPC vehicles than this would cost too much on low-end phones. */
export const MAX_TRAFFIC_VEHICLES = 48;

/** Graphics presets, from weak phones to desktops. */
export const QUALITY_LEVELS = ['low', 'medium', 'high'] as const;
export type QualityLevel = (typeof QUALITY_LEVELS)[number];

/** The player's graphics setting: a preset, or `auto` to let the device decide. */
export const QUALITY_CHOICES = ['auto', ...QUALITY_LEVELS] as const;
export type QualityChoice = (typeof QUALITY_CHOICES)[number];

export function isQualityChoice(value: unknown): value is QualityChoice {
  return (QUALITY_CHOICES as readonly unknown[]).includes(value);
}

/** What a graphics preset sets (applyQualityPreset). */
export interface QualityPreset {
  readonly maxPixelRatio: number;
  readonly minResolutionScale: Fraction;
  readonly rainDensity: Fraction;
  readonly particleDensity: Fraction;
  readonly vegetationDensity: Fraction;
  readonly lampGlows: boolean;
  readonly postProcessing: boolean;
  readonly bloom: boolean;
  readonly msaaSamples: number;
  readonly shadowMapSize: number;
  /** NPC vehicles around the truck. */
  readonly trafficVehicles: number;
}

export const QUALITY_PRESETS: Readonly<Record<QualityLevel, QualityPreset>> = frozenCopy({
  low: {
    maxPixelRatio: 1,
    minResolutionScale: 0.7,
    rainDensity: 0.5,
    particleDensity: 0.5,
    vegetationDensity: 0.45,
    lampGlows: false,
    postProcessing: false,
    bloom: false,
    msaaSamples: 0,
    shadowMapSize: 0,
    trafficVehicles: 8,
  },
  medium: {
    maxPixelRatio: 1.25,
    minResolutionScale: 0.6,
    rainDensity: 0.75,
    particleDensity: 0.75,
    vegetationDensity: 0.75,
    lampGlows: true,
    postProcessing: true,
    bloom: true,
    msaaSamples: 0,
    shadowMapSize: 0,
    trafficVehicles: 12,
  },
  high: {
    maxPixelRatio: 1.5,
    minResolutionScale: 0.6,
    rainDensity: 1,
    particleDensity: 1,
    vegetationDensity: 1,
    lampGlows: true,
    postProcessing: true,
    bloom: true,
    msaaSamples: 4,
    shadowMapSize: 2048,
    trafficVehicles: 16,
  },
});

/**
 * `config` with the graphics preset `level`: resolution, rain, smoke and
 * dust, glows, the colour pass and its bloom and smoothing, the sun's
 * shadows, and how much traffic.
 */
export function applyQualityPreset(config: GameConfig, level: QualityLevel): GameConfig {
  const { trafficVehicles, ...rendering } = QUALITY_PRESETS[level];
  return {
    ...config,
    rendering: { ...config.rendering, ...rendering, quality: level },
    traffic: { ...config.traffic, maxVehicles: trafficVehicles },
  };
}

export const DEFAULT_GAME_CONFIG: GameConfig = frozenCopy<GameConfig>({
  simulation: {
    fixedStepSeconds: 1 / 60,
    maxStepsPerFrame: 5,
    maxFrameDeltaSeconds: 0.25,
  },
  // The high preset (QUALITY_PRESETS); the browser entry picks the preset for the device.
  rendering: {
    quality: 'high',
    maxPixelRatio: 1.5,
    antialias: false,
    minResolutionScale: 0.6,
    rainDensity: 1,
    particleDensity: 1,
    vegetationDensity: 1,
    lampGlows: true,
    postProcessing: true,
    bloom: true,
    msaaSamples: 4,
    shadowMapSize: 2048,
  },
  missions: {
    loadingSeconds: 3,
    dailyContracts: { count: 5, refreshHours: 6 },
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
  traffic: {
    maxVehicles: 16,
    radiusMeters: 700,
    minSpawnDistanceMeters: 180,
    speedLimitsKmh: { street: 45, ringRoad: 60, highway: 90, rural: 70 },
  },
  navigation: {
    etaPaceFactor: 0.8,
  },
  weather: {
    initialWeatherId: 'clear',
    clearWeatherId: 'clear',
    changes: true,
    transitionSeconds: 25,
  },
  timeOfDay: {
    // An Aegean coast: the sun highest just before one o'clock (the time zone runs ahead of it).
    latitudeDegrees: 39,
    solarNoonHours: 12.8,
    gameSecondsPerSecond: 20,
    startMinutes: 10 * 60,
    dayFromDegrees: 12,
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
  const { simulation, rendering, missions, economy, fuel, traffic, navigation, weather, timeOfDay, company, newGame, debug } =
    config;

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
  validator.oneOf(rendering.quality, QUALITY_LEVELS, 'rendering.quality');
  validator.positiveNumber(rendering.maxPixelRatio, 'rendering.maxPixelRatio');
  validator.boolean(rendering.antialias, 'rendering.antialias');
  validator.check(
    Number.isFinite(rendering.minResolutionScale) && rendering.minResolutionScale > 0 && rendering.minResolutionScale <= 1,
    'rendering.minResolutionScale',
    'must be greater than 0 and at most 1',
  );
  validator.fraction(rendering.rainDensity, 'rendering.rainDensity');
  validator.fraction(rendering.particleDensity, 'rendering.particleDensity');
  validator.fraction(rendering.vegetationDensity, 'rendering.vegetationDensity');
  validator.boolean(rendering.lampGlows, 'rendering.lampGlows');
  validator.boolean(rendering.postProcessing, 'rendering.postProcessing');
  validator.boolean(rendering.bloom, 'rendering.bloom');
  validator.check(
    Number.isInteger(rendering.msaaSamples) && rendering.msaaSamples >= 0 && rendering.msaaSamples <= 8,
    'rendering.msaaSamples',
    'must be a whole number from 0 to 8',
  );
  validator.check(
    rendering.shadowMapSize === 0 ||
      (Number.isInteger(Math.log2(rendering.shadowMapSize)) && rendering.shadowMapSize >= 256 && rendering.shadowMapSize <= 4096),
    'rendering.shadowMapSize',
    'must be 0 or a power of two from 256 to 4096',
  );
  validator.check(
    Number.isFinite(missions.loadingSeconds) && missions.loadingSeconds > 0 && missions.loadingSeconds <= 30,
    'missions.loadingSeconds',
    'must be greater than 0 and at most 30',
  );
  const daily = missions.dailyContracts;
  validator.check(
    Number.isInteger(daily.count) && daily.count >= 0 && daily.count <= 12,
    'missions.dailyContracts.count',
    'must be a whole number from 0 to 12',
  );
  validator.check(
    Number.isFinite(daily.refreshHours) && daily.refreshHours >= 1,
    'missions.dailyContracts.refreshHours',
    'must be at least 1',
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
  validator.check(
    Number.isInteger(traffic.maxVehicles) && traffic.maxVehicles >= 0 && traffic.maxVehicles <= MAX_TRAFFIC_VEHICLES,
    'traffic.maxVehicles',
    `must be a whole number from 0 to ${MAX_TRAFFIC_VEHICLES}`,
  );
  validator.positiveNumber(traffic.minSpawnDistanceMeters, 'traffic.minSpawnDistanceMeters');
  validator.check(
    Number.isFinite(traffic.radiusMeters) && traffic.radiusMeters > traffic.minSpawnDistanceMeters,
    'traffic.radiusMeters',
    'must be greater than minSpawnDistanceMeters',
  );
  for (const kind of ROAD_KINDS) {
    validator.positiveNumber(traffic.speedLimitsKmh?.[kind], `traffic.speedLimitsKmh.${kind}`);
  }
  validator.check(
    Number.isFinite(navigation.etaPaceFactor) && navigation.etaPaceFactor > 0 && navigation.etaPaceFactor <= 1,
    'navigation.etaPaceFactor',
    'must be greater than 0 and at most 1',
  );
  validator.check(
    content.weather.has(weather.initialWeatherId),
    'weather.initialWeatherId',
    `unknown weather "${weather.initialWeatherId}"`,
  );
  validator.check(
    content.weather.has(weather.clearWeatherId),
    'weather.clearWeatherId',
    `unknown weather "${weather.clearWeatherId}"`,
  );
  validator.boolean(weather.changes, 'weather.changes');
  validator.positiveNumber(weather.transitionSeconds, 'weather.transitionSeconds');
  validator.check(
    Number.isFinite(timeOfDay.latitudeDegrees) && Math.abs(timeOfDay.latitudeDegrees) <= 66,
    'timeOfDay.latitudeDegrees',
    'must be from -66 to 66 (the sun rises and sets every day)',
  );
  validator.check(
    Number.isFinite(timeOfDay.solarNoonHours) && timeOfDay.solarNoonHours >= 10 && timeOfDay.solarNoonHours <= 14,
    'timeOfDay.solarNoonHours',
    'must be from 10 to 14',
  );
  validator.positiveNumber(timeOfDay.gameSecondsPerSecond, 'timeOfDay.gameSecondsPerSecond');
  validator.check(
    Number.isFinite(timeOfDay.startMinutes) && timeOfDay.startMinutes >= 0 && timeOfDay.startMinutes < MINUTES_PER_DAY,
    'timeOfDay.startMinutes',
    'must be from 0 to under 1440',
  );
  validator.check(
    Number.isFinite(timeOfDay.dayFromDegrees) && timeOfDay.dayFromDegrees > 0 && timeOfDay.dayFromDegrees <= 30,
    'timeOfDay.dayFromDegrees',
    'must be greater than 0 and at most 30',
  );
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
  content.events.all.forEach((event, index) => {
    checkReachable(event.id, event.requiredCompanyLevel, `content.events[${index}].requiredCompanyLevel`);
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
