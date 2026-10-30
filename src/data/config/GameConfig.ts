import { isLogLevel, type LogLevel } from '../../core/logging/Logger';
import { frozenCopy } from '../../core/objects/frozenCopy';
import { MINUTES_PER_DAY } from '../../core/time/dayTime';
import { Validator, type ValidationIssue } from '../../core/validation/Validator';
import type { ContentCatalog } from '../ContentCatalog';
import { ROAD_KINDS, type RoadKind } from '../definitions/MapDefinition';
import { PAINT_RARITIES, type PaintRarity } from '../definitions/PaintDefinition';
import { SEASONS, type Season } from '../definitions/Season';
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
    /** Repairing a truck from 100% damage costs this share of its price; less damage costs proportionally less. */
    readonly fullRepairShare: Fraction;
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
  /**
   * Crashes (CrashService): lamps, bins, benches, bus shelters, speed signs
   * and hay bales the truck drives into hard enough go flying instead of
   * stopping it, and so do the cars and minibuses it wrecks; they tumble
   * about, and what was knocked over stands again once out of sight.
   */
  readonly crashes: {
    /** False: everything the truck hits stops it, as solid as a wall (tests). */
    readonly enabled: boolean;
    /** How hard what gives way is thrown: 1 as the knock's physics has it, more is funnier. */
    readonly throwFactor: number;
    /** What was knocked over and the wrecks lie about at least this long, seconds, and until out of sight. */
    readonly restoreAfterSeconds: number;
    /** How many knocked-over things and wrecks there are at once, at most: the oldest make way. */
    readonly maxDebris: number;
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
    /**
     * XP at which each company level starts, level 1 first (spec §14: five levels in the first version, which the
     * content's level requirements stay within; the ones above are for the long run, and their rewards).
     */
    readonly levelXp: readonly number[];
    /** What each level from the second brings when the player collects it (LevelRewardService), level 2 first. */
    readonly levelRewards: readonly LevelRewardConfig[];
  };
  /** The fleet (spec §27): the company's other trucks, on contracts of their own with hired drivers. */
  readonly fleet: {
    /** How many trucks the company may own at each company level, level 1 first: the garage's size. */
    readonly garageSlots: readonly number[];
    /** A fleet truck's average pace on the region's roads, km/h, before its driver's speed factor. */
    readonly averageSpeedKmh: number;
    /** Loading at one depot and unloading at the next, seconds of each fleet contract. */
    readonly handlingSeconds: number;
    /** A fleet contract pays this share of what the same contract of the day would pay. */
    readonly payFactor: number;
    /** An incident on a contract (a scrape, a kerb) adds this much damage to the truck. */
    readonly incidentDamage: Fraction;
    /** A truck this damaged goes to the workshop before its next contract, and the company pays the repair. */
    readonly repairAtDamage: Fraction;
    /** The workshop keeps it this long, seconds. */
    readonly repairSeconds: number;
    /** While the game was closed, the fleet (and the rivals) go on working for at most this many hours. */
    readonly awayHours: number;
  };
  /**
   * The rival companies (RivalService): standing in the cities and who
   * leads them, campaigns, tenders, and buying a rival out.
   */
  readonly rivals: {
    /** Standing a contract the player drives wins the company in the city it leaves and in the one it reaches. */
    readonly deliveryPoints: number;
    /** Standing a contract a fleet truck delivers (the company's or a rival's) wins in both its cities. */
    readonly fleetJobPoints: number;
    /** Standing halves over this many seconds of play: what was delivered lately counts most. */
    readonly pointsHalfLifeSeconds: number;
    /** A rival's standing in its home city at the start. */
    readonly startingHomePoints: number;
    /** A city's leader has the most standing there, and at least this share of it. */
    readonly leadShare: Fraction;
    /** Contracts from a city the company leads pay this share more (and a rival's, likewise). */
    readonly leaderBonus: Fraction;
    /** A rival's contracts pay this share of what the same contract of the day would (as the fleet's). */
    readonly payFactor: number;
    /** A rival's drivers keep this share of each contract's pay. */
    readonly driverPayShare: Fraction;
    /** A campaign in a city costs this… */
    readonly campaignCost: Credits;
    /** …wins this much standing there… */
    readonly campaignPoints: number;
    /** …and the same company can run the next one there after this many seconds. */
    readonly campaignCooldownSeconds: number;
    /** A rival thinks over buying a truck or running a campaign this often, seconds. */
    readonly decisionSeconds: number;
    /** A rival keeps this much money back when it buys a truck or runs a campaign. */
    readonly reserveCredits: Credits;
    /** The first tender comes to the job board this long after the start, seconds… */
    readonly firstTenderSeconds: number;
    /** …and each one stays there this long, until the next replaces it. */
    readonly tenderEverySeconds: number;
    /** Winning a tender pays this share of its pay on top. */
    readonly tenderPrize: Fraction;
    /** A tender wins its winner this much standing in both its cities. */
    readonly tenderPoints: number;
    /** The rival in a tender drives at this average pace, km/h, times its speed factor. */
    readonly tenderRivalSpeedKmh: number;
    /** Buying a rival out costs its value times this. */
    readonly acquisitionPremium: number;
  };
  readonly newGame: {
    readonly startingCredits: Credits;
    /** VehicleDefinition id of the truck every new company starts with. */
    readonly startingVehicleId: string;
    /** MapDefinition id the driving starts on. */
    readonly startingMapId: string;
  };
  /**
   * Ads and their rewards (spec §35): never forced on the player, never in the drive. A rewarded ad is the player's
   * choice, for a small bonus; an interstitial comes only between contracts, and seldom. MonetizationService owns them.
   */
  readonly monetization: {
    /** A rewarded ad after a delivery pays this share of its total on top… */
    readonly deliveryBonusShare: Fraction;
    /** …at least this much, and at most this much. */
    readonly deliveryBonusMinCredits: Credits;
    readonly deliveryBonusMaxCredits: Credits;
    /** A rewarded ad takes this share off a repair or a fill-up in a depot's yard or at a rest area… */
    readonly serviceDiscount: Fraction;
    /** …this many times a day. */
    readonly serviceDiscountsPerDay: number;
    /** No interstitial before this many deliveries since the game started… */
    readonly interstitialFirstAfterDeliveries: number;
    /** …then one after every this many deliveries… */
    readonly interstitialEveryDeliveries: number;
    /** …and never two closer than this, seconds (a rewarded ad counts too). */
    readonly interstitialMinSeconds: number;
    /** A rewarded ad from the main menu adds this share to every delivery's pay… */
    readonly earningsBoostShare: Fraction;
    /** …for this many minutes of the clock (the game open or not). */
    readonly earningsBoostMinutes: number;
  };
  /** The daily reward (DailyRewardService): credits for the first drive of each day, more for each day in a row. */
  readonly dailyReward: {
    /** What each day of the streak pays at company level 1, the first day first; after the last, the streak starts over. */
    readonly credits: readonly Credits[];
    /** Each company level above the first adds this share of it… */
    readonly levelBonus: Fraction;
    /** …up to this many levels above the first. */
    readonly bonusLevels: number;
  };
  /**
   * Crates (CrateService): earned, never sold, and opened for credits and, at times, one of the colours only crates
   * hold (PaintDefinition.crate). Cosmetic: nothing in them makes the game go faster.
   */
  readonly crates: {
    readonly tiers: Readonly<Record<CrateTier, CrateTierConfig>>;
    /**
     * A streak of perfect deliveries (three stars: on time, the cargo flawless) earns a crate on every `bronzeEvery`th
     * of them in a row, a silver one on every `silverEvery`th and a gold one on every `goldEvery`th instead.
     */
    readonly perfectStreak: { readonly bronzeEvery: number; readonly silverEvery: number; readonly goldEvery: number };
    /** The daily reward's last day brings this crate too. */
    readonly dailyStreakCrate: CrateTier;
  };
  /**
   * The truck stop's slot machine (CasinoService): played for the company's credits only, never for money; credits
   * are never sold. Three reels on one line, each reel the same weighted strip of symbols. Three alike pay `three`
   * times the bet, two alike `pair` times it; no win is ever less than the bet back. Content-free: the symbols' ids
   * name their pictures (the UI's).
   */
  readonly casino: {
    /** The bets on offer, smallest first. */
    readonly bets: readonly Credits[];
    readonly symbols: readonly SlotSymbolConfig[];
  };
  /** The sky's wonders (SkyWonderService): the northern lights some nights, and what counts as seeing them. */
  readonly skyWonders: {
    /** The share of the nights with the northern lights, by season (they also need a clear, dark sky). */
    readonly auroraChance: Readonly<Record<Season, Fraction>>;
    /** A shooting star counts as a sighting at most once in this many seconds of play (they fall often at night). */
    readonly meteorCountSeconds: number;
  };
  /** When the game asks the player to rate it on the store (ReviewService): seldom, after deliveries in good order. */
  readonly review: {
    /** Deliveries in good order before the first ask… */
    readonly firstAfterDeliveries: number;
    /** …a delivery in good order arriving with its cargo damaged no more than this… */
    readonly maxCargoDamage: Fraction;
    /** …then never again for this many days… */
    readonly daysBetween: number;
    /** …and never more than this many times. */
    readonly maxAsks: number;
  };
  readonly debug: {
    readonly logLevel: LogLevel;
    /** Shows FPS, draw calls and triangles (enable in the browser with `?debug`). */
    readonly showPerfOverlay: boolean;
  };
}

/** A crate's tier: the better, the more it holds. */
export const CRATE_TIERS = ['bronze', 'silver', 'gold'] as const;
export type CrateTier = (typeof CRATE_TIERS)[number];

export function isCrateTier(value: unknown): value is CrateTier {
  return typeof value === 'string' && (CRATE_TIERS as readonly string[]).includes(value);
}

/** What a crate of one tier holds. */
export interface CrateTierConfig {
  /** Credits, drawn evenly between the two. */
  readonly credits: readonly [Credits, Credits];
  /** How often it holds a crate colour the company has not got yet as well. */
  readonly paintChance: Fraction;
  /** Which rarity that colour is, by these weights against each other. */
  readonly rarityWeights: Readonly<Record<PaintRarity, number>>;
}

/** What a company level brings when it is collected. */
export interface LevelRewardConfig {
  readonly credits: Credits;
  readonly crate: CrateTier;
}

/** A symbol on the slot machine's reels. */
export interface SlotSymbolConfig {
  readonly id: string;
  /** How often it comes up on a reel, against the others' weights. */
  readonly weight: number;
  /** Three alike pay this many times the bet… */
  readonly three: number;
  /** …two alike this many (at least 1: the bet back). */
  readonly pair: number;
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
    fullRepairShare: 0.25,
  },
  fuel: {
    consumptionScale: 10,
    lowFuelFraction: 0.15,
  },
  traffic: {
    maxVehicles: 16,
    radiusMeters: 700,
    minSpawnDistanceMeters: 180,
    speedLimitsKmh: { street: 45, ringRoad: 60, highway: 90, rural: 70, lane: 40 },
  },
  crashes: {
    enabled: true,
    throwFactor: 1.3,
    restoreAfterSeconds: 45,
    maxDebris: 24,
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
    levelXp: [0, 1000, 3000, 6500, 12000, 20000, 30000, 43000, 60000, 80000],
    levelRewards: [
      { credits: 1500, crate: 'silver' },
      { credits: 2500, crate: 'silver' },
      { credits: 4000, crate: 'silver' },
      { credits: 6000, crate: 'gold' },
      { credits: 8000, crate: 'silver' },
      { credits: 10000, crate: 'gold' },
      { credits: 12000, crate: 'gold' },
      { credits: 15000, crate: 'gold' },
      { credits: 25000, crate: 'gold' },
    ],
  },
  fleet: {
    garageSlots: [2, 3, 4, 6, 8, 8, 9, 9, 10, 10],
    averageSpeedKmh: 45,
    handlingSeconds: 60,
    payFactor: 0.75,
    incidentDamage: 0.2,
    repairAtDamage: 0.5,
    repairSeconds: 120,
    awayHours: 2,
  },
  rivals: {
    deliveryPoints: 20,
    fleetJobPoints: 8,
    pointsHalfLifeSeconds: 1800,
    startingHomePoints: 60,
    leadShare: 0.35,
    leaderBonus: 0.15,
    payFactor: 0.75,
    driverPayShare: 0.25,
    campaignCost: 6000,
    campaignPoints: 40,
    campaignCooldownSeconds: 600,
    decisionSeconds: 60,
    reserveCredits: 3000,
    firstTenderSeconds: 180,
    tenderEverySeconds: 480,
    tenderPrize: 0.6,
    tenderPoints: 30,
    tenderRivalSpeedKmh: 40,
    acquisitionPremium: 1.25,
  },
  newGame: {
    startingCredits: 5000, // Placeholder until the economy step (roadmap step 14).
    startingVehicleId: 'rh_h1',
    startingMapId: 'north_valley',
  },
  monetization: {
    deliveryBonusShare: 0.25,
    deliveryBonusMinCredits: 100,
    deliveryBonusMaxCredits: 2500,
    serviceDiscount: 0.5,
    serviceDiscountsPerDay: 5,
    interstitialFirstAfterDeliveries: 3,
    interstitialEveryDeliveries: 3,
    interstitialMinSeconds: 480,
    earningsBoostShare: 0.25,
    earningsBoostMinutes: 60,
  },
  dailyReward: {
    credits: [300, 500, 800, 1200, 1600, 2200, 4000],
    levelBonus: 0.5,
    bonusLevels: 4,
  },
  crates: {
    tiers: {
      bronze: { credits: [300, 900], paintChance: 0.12, rarityWeights: { rare: 1, epic: 0.15, legendary: 0.02 } },
      silver: { credits: [900, 2400], paintChance: 0.3, rarityWeights: { rare: 1, epic: 0.4, legendary: 0.08 } },
      gold: { credits: [2500, 6000], paintChance: 0.6, rarityWeights: { rare: 0.6, epic: 0.6, legendary: 0.3 } },
    },
    perfectStreak: { bronzeEvery: 3, silverEvery: 5, goldEvery: 10 },
    dailyStreakCrate: 'silver',
  },
  skyWonders: {
    auroraChance: { spring: 0.15, summer: 0.08, autumn: 0.25, winter: 0.5 },
    meteorCountSeconds: 300,
  },
  review: {
    firstAfterDeliveries: 5,
    maxCargoDamage: 0.1,
    daysBetween: 60,
    maxAsks: 3,
  },
  casino: {
    bets: [50, 100, 250, 500],
    // Returns about 95.6% of what is bet in the long run; a win on about 46% of spins, ten times the bet or more on
    // 1.4% (tests/unit/domain/casino/slotMachine.test.ts works it out).
    symbols: [
      { id: 'wrench', weight: 7, three: 5, pair: 1 },
      { id: 'fuel', weight: 6, three: 8, pair: 1 },
      { id: 'wheels', weight: 5, three: 12, pair: 1 },
      { id: 'cargo', weight: 4, three: 20, pair: 1.5 },
      { id: 'engine', weight: 3, three: 40, pair: 2 },
      { id: 'truck', weight: 2, three: 100, pair: 5 },
      { id: 'trophy', weight: 1, three: 250, pair: 10 },
    ],
  },
  debug: {
    logLevel: 'info',
    showPerfOverlay: false,
  },
});

function validateRivals(validator: Validator, rivals: GameConfig['rivals']): void {
  for (const key of [
    'deliveryPoints',
    'fleetJobPoints',
    'pointsHalfLifeSeconds',
    'campaignPoints',
    'campaignCooldownSeconds',
    'decisionSeconds',
    'tenderEverySeconds',
    'tenderPoints',
    'tenderRivalSpeedKmh',
  ] as const) {
    validator.positiveNumber(rivals[key], `rivals.${key}`);
  }
  validator.check(
    Number.isFinite(rivals.startingHomePoints) && rivals.startingHomePoints >= 0,
    'rivals.startingHomePoints',
    'must be 0 or more',
  );
  validator.check(
    Number.isFinite(rivals.leadShare) && rivals.leadShare > 0 && rivals.leadShare <= 1,
    'rivals.leadShare',
    'must be greater than 0 and at most 1',
  );
  validator.fraction(rivals.leaderBonus, 'rivals.leaderBonus');
  validator.check(
    Number.isFinite(rivals.payFactor) && rivals.payFactor > 0 && rivals.payFactor <= 2,
    'rivals.payFactor',
    'must be greater than 0 and at most 2',
  );
  validator.check(
    Number.isFinite(rivals.driverPayShare) && rivals.driverPayShare >= 0 && rivals.driverPayShare < 1,
    'rivals.driverPayShare',
    'must be 0 or more and less than 1',
  );
  validator.nonNegativeInteger(rivals.campaignCost, 'rivals.campaignCost');
  validator.nonNegativeInteger(rivals.reserveCredits, 'rivals.reserveCredits');
  validator.check(
    Number.isFinite(rivals.firstTenderSeconds) && rivals.firstTenderSeconds >= 0,
    'rivals.firstTenderSeconds',
    'must be 0 or more',
  );
  validator.fraction(rivals.tenderPrize, 'rivals.tenderPrize');
  validator.check(
    Number.isFinite(rivals.acquisitionPremium) && rivals.acquisitionPremium >= 1,
    'rivals.acquisitionPremium',
    'must be 1 or more',
  );
}

/** Checks value ranges and that the config only references existing content. */
export function validateGameConfig(config: GameConfig, content: ContentCatalog): readonly ValidationIssue[] {
  const validator = new Validator();
  const {
    simulation,
    rendering,
    missions,
    economy,
    fuel,
    traffic,
    crashes,
    navigation,
    weather,
    timeOfDay,
    company,
    fleet,
    rivals,
    newGame,
    monetization,
    dailyReward,
    crates,
    casino,
    skyWonders,
    review,
    debug,
  } = config;

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
  validator.check(economy.fullRepairShare > 0 && economy.fullRepairShare <= 1, 'economy.fullRepairShare', 'must be greater than 0 and at most 1');
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
  validator.boolean(crashes.enabled, 'crashes.enabled');
  validator.check(
    Number.isFinite(crashes.throwFactor) && crashes.throwFactor > 0 && crashes.throwFactor <= 3,
    'crashes.throwFactor',
    'must be greater than 0 and at most 3',
  );
  validator.positiveNumber(crashes.restoreAfterSeconds, 'crashes.restoreAfterSeconds');
  validator.check(
    Number.isInteger(crashes.maxDebris) && crashes.maxDebris >= 1 && crashes.maxDebris <= 64,
    'crashes.maxDebris',
    'must be a whole number from 1 to 64',
  );
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
  content.drivers.all.forEach((driver, index) => {
    checkReachable(driver.id, driver.requiredCompanyLevel, `content.drivers[${index}].requiredCompanyLevel`);
  });
  content.facilities.all.forEach((facility, facilityIndex) => {
    facility.levels.forEach((level, index) => {
      checkReachable(
        facility.id,
        level.requiredCompanyLevel,
        `content.facilities[${facilityIndex}].levels[${index}].requiredCompanyLevel`,
      );
    });
    // The job board holds at most a dozen contracts of the day, the facilities' extra ones included.
    if (facility.effect === 'extraContracts') {
      const most = Math.max(...facility.levels.map((level) => level.value));
      validator.check(
        missions.dailyContracts.count + most <= 12,
        `content.facilities[${facilityIndex}].levels`,
        `"${facility.id}" adds up to ${most} contracts to the ${missions.dailyContracts.count} of the day: more than 12`,
      );
    }
  });
  const slots = fleet.garageSlots;
  validator.check(
    Array.isArray(slots) &&
      Array.isArray(levels) &&
      slots.length === levels.length &&
      slots.every((count, index) => Number.isInteger(count) && count >= 1 && (index === 0 || count >= slots[index - 1]!)),
    'fleet.garageSlots',
    'must give each company level a whole number of trucks, 1 or more, never fewer than the level before',
  );
  validator.positiveNumber(fleet.averageSpeedKmh, 'fleet.averageSpeedKmh');
  validator.check(
    Number.isFinite(fleet.handlingSeconds) && fleet.handlingSeconds >= 0,
    'fleet.handlingSeconds',
    'must be 0 or more',
  );
  validator.check(
    Number.isFinite(fleet.payFactor) && fleet.payFactor > 0 && fleet.payFactor <= 2,
    'fleet.payFactor',
    'must be greater than 0 and at most 2',
  );
  validator.fraction(fleet.incidentDamage, 'fleet.incidentDamage');
  validator.check(
    Number.isFinite(fleet.repairAtDamage) && fleet.repairAtDamage > 0 && fleet.repairAtDamage <= 1,
    'fleet.repairAtDamage',
    'must be greater than 0 and at most 1',
  );
  validator.positiveNumber(fleet.repairSeconds, 'fleet.repairSeconds');
  validator.check(
    Number.isFinite(fleet.awayHours) && fleet.awayHours >= 0 && fleet.awayHours <= 24,
    'fleet.awayHours',
    'must be from 0 to 24',
  );
  validateRivals(validator, rivals);
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
  validateMonetization(validator, monetization);
  validator.check(dailyReward.credits.length > 0, 'dailyReward.credits', 'must have at least one day');
  dailyReward.credits.forEach((credits, index) => validator.positiveInteger(credits, `dailyReward.credits[${index}]`));
  validator.fraction(dailyReward.levelBonus, 'dailyReward.levelBonus');
  validator.nonNegativeInteger(dailyReward.bonusLevels, 'dailyReward.bonusLevels');
  validateCrates(validator, crates);
  validator.check(
    company.levelRewards.length === levels.length - 1,
    'company.levelRewards',
    'must give each level from the second a reward',
  );
  company.levelRewards.forEach((reward, index) => {
    validator.positiveInteger(reward.credits, `company.levelRewards[${index}].credits`);
    validator.check(isCrateTier(reward.crate), `company.levelRewards[${index}].crate`, `unknown crate "${String(reward.crate)}"`);
  });
  validateCasino(validator, casino);
  for (const season of SEASONS) {
    validator.fraction(skyWonders.auroraChance[season], `skyWonders.auroraChance.${season}`);
  }
  validator.positiveNumber(skyWonders.meteorCountSeconds, 'skyWonders.meteorCountSeconds');
  validator.positiveInteger(review.firstAfterDeliveries, 'review.firstAfterDeliveries');
  validator.fraction(review.maxCargoDamage, 'review.maxCargoDamage');
  validator.positiveInteger(review.daysBetween, 'review.daysBetween');
  validator.nonNegativeInteger(review.maxAsks, 'review.maxAsks');
  validator.check(isLogLevel(debug.logLevel), 'debug.logLevel', `unknown log level "${debug.logLevel}"`);
  validator.boolean(debug.showPerfOverlay, 'debug.showPerfOverlay');
  return validator.issues;
}

function validateMonetization(validator: Validator, monetization: GameConfig['monetization']): void {
  validator.fraction(monetization.deliveryBonusShare, 'monetization.deliveryBonusShare');
  validator.positiveInteger(monetization.deliveryBonusMinCredits, 'monetization.deliveryBonusMinCredits');
  validator.check(
    Number.isInteger(monetization.deliveryBonusMaxCredits) &&
      monetization.deliveryBonusMaxCredits >= monetization.deliveryBonusMinCredits,
    'monetization.deliveryBonusMaxCredits',
    'must be a whole number, at least deliveryBonusMinCredits',
  );
  validator.check(
    Number.isFinite(monetization.serviceDiscount) && monetization.serviceDiscount > 0 && monetization.serviceDiscount < 1,
    'monetization.serviceDiscount',
    'must be greater than 0 and less than 1',
  );
  validator.nonNegativeInteger(monetization.serviceDiscountsPerDay, 'monetization.serviceDiscountsPerDay');
  validator.nonNegativeInteger(monetization.interstitialFirstAfterDeliveries, 'monetization.interstitialFirstAfterDeliveries');
  validator.positiveInteger(monetization.interstitialEveryDeliveries, 'monetization.interstitialEveryDeliveries');
  validator.check(
    Number.isFinite(monetization.interstitialMinSeconds) && monetization.interstitialMinSeconds >= 0,
    'monetization.interstitialMinSeconds',
    'must be zero or more',
  );
  validator.check(
    monetization.earningsBoostShare > 0 && monetization.earningsBoostShare <= 1,
    'monetization.earningsBoostShare',
    'must be greater than 0 and at most 1',
  );
  validator.positiveInteger(monetization.earningsBoostMinutes, 'monetization.earningsBoostMinutes');
}

function validateCrates(validator: Validator, crates: GameConfig['crates']): void {
  for (const tier of CRATE_TIERS) {
    const config = crates.tiers[tier];
    const [least, most] = config.credits;
    validator.check(
      Number.isInteger(least) && Number.isInteger(most) && least > 0 && most >= least,
      `crates.tiers.${tier}.credits`,
      'must be two whole numbers above 0, the second at least the first',
    );
    validator.fraction(config.paintChance, `crates.tiers.${tier}.paintChance`);
    for (const rarity of PAINT_RARITIES) {
      const weight = config.rarityWeights[rarity];
      validator.check(Number.isFinite(weight) && weight >= 0, `crates.tiers.${tier}.rarityWeights.${rarity}`, 'must be 0 or more');
    }
  }
  const streak = crates.perfectStreak;
  validator.positiveInteger(streak.bronzeEvery, 'crates.perfectStreak.bronzeEvery');
  validator.positiveInteger(streak.silverEvery, 'crates.perfectStreak.silverEvery');
  validator.positiveInteger(streak.goldEvery, 'crates.perfectStreak.goldEvery');
  validator.check(isCrateTier(crates.dailyStreakCrate), 'crates.dailyStreakCrate', `unknown crate "${String(crates.dailyStreakCrate)}"`);
}

function validateCasino(validator: Validator, casino: GameConfig['casino']): void {
  validator.check(casino.bets.length > 0, 'casino.bets', 'must offer at least one bet');
  casino.bets.forEach((bet, index) => {
    validator.positiveInteger(bet, `casino.bets[${index}]`);
    validator.check(index === 0 || bet > casino.bets[index - 1]!, `casino.bets[${index}]`, 'must be more than the bet before');
  });
  validator.check(casino.symbols.length >= 3, 'casino.symbols', 'must have at least three symbols');
  casino.symbols.forEach((symbol, index) => {
    const path = `casino.symbols[${index}]`;
    validator.check(casino.symbols.findIndex((other) => other.id === symbol.id) === index, `${path}.id`, `"${symbol.id}" is there twice`);
    validator.positiveInteger(symbol.weight, `${path}.weight`);
    validator.check(Number.isFinite(symbol.pair) && symbol.pair >= 1, `${path}.pair`, 'must be at least 1: never less than the bet back');
    validator.check(Number.isFinite(symbol.three) && symbol.three > symbol.pair, `${path}.three`, 'must be more than its pair');
  });
}
