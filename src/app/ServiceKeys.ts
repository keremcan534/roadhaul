import type { EventBus } from '../core/events/EventBus';
import type { Logger } from '../core/logging/Logger';
import { serviceKey } from '../core/services/ServiceContainer';
import type { Clock } from '../core/time/Clock';
import type { GameConfig } from '../data/config/GameConfig';
import type { ContentCatalog } from '../data/ContentCatalog';
import type { CompanyService } from '../systems/company/CompanyService';
import type { FacilityService } from '../systems/company/FacilityService';
import type { ResearchService } from '../systems/company/ResearchService';
import type { DailyRewardService } from '../systems/rewards/DailyRewardService';
import type { CasinoService } from '../systems/casino/CasinoService';
import type { ReviewService } from '../systems/review/ReviewService';
import type { AchievementService } from '../systems/achievements/AchievementService';
import type { CrateService } from '../systems/rewards/CrateService';
import type { QuestService } from '../systems/rewards/QuestService';
import type { SupplyService } from '../systems/rewards/SupplyService';
import type { LiveryService } from '../systems/vehicles/LiveryService';
import type { SkyWonderService } from '../systems/weather/SkyWonderService';
import type { LevelRewardService } from '../systems/company/LevelRewardService';
import type { CrashService } from '../systems/crash/CrashService';
import type { DrivingService } from '../systems/driving/DrivingService';
import type { EconomyService } from '../systems/economy/EconomyService';
import type { EventService } from '../systems/events/EventService';
import type { DepotRoads } from '../systems/fleet/DepotRoads';
import type { FleetService } from '../systems/fleet/FleetService';
import type { GameEvents } from '../systems/GameEvents';
import type { GameStateService } from '../systems/gameState/GameStateService';
import type { DailyContracts } from '../systems/missions/DailyContracts';
import type { MissionService } from '../systems/missions/MissionService';
import type { MonetizationService } from '../systems/monetization/MonetizationService';
import type { NavigationService } from '../systems/navigation/NavigationService';
import type { RivalService } from '../systems/rivals/RivalService';
import type { SaveService } from '../systems/save/SaveService';
import type { GameSessionService } from '../systems/session/GameSessionService';
import type { CompanyTraffic } from '../systems/traffic/CompanyTraffic';
import type { TrafficService } from '../systems/traffic/TrafficService';
import type { TutorialService } from '../systems/tutorial/TutorialService';
import type { SeasonService } from '../systems/weather/SeasonService';
import type { TimeOfDayService } from '../systems/weather/TimeOfDayService';
import type { WeatherService } from '../systems/weather/WeatherService';
import type { DamageService } from '../systems/vehicles/DamageService';
import type { FuelService } from '../systems/vehicles/FuelService';
import type { GarageService } from '../systems/vehicles/GarageService';
import type { UpgradeService } from '../systems/vehicles/UpgradeService';

/** Keys of every service registered by GameBootstrapper. Only composition code resolves them. */
export const ServiceKeys = Object.freeze({
  logger: serviceKey<Logger>('Logger'),
  clock: serviceKey<Clock>('Clock'),
  config: serviceKey<GameConfig>('GameConfig'),
  content: serviceKey<ContentCatalog>('ContentCatalog'),
  events: serviceKey<EventBus<GameEvents>>('EventBus'),
  gameState: serviceKey<GameStateService>('GameStateService'),
  driving: serviceKey<DrivingService>('DrivingService'),
  traffic: serviceKey<TrafficService>('TrafficService'),
  /** What the truck's crashes leave about: things knocked over, wrecks. */
  crashes: serviceKey<CrashService>('CrashService'),
  weather: serviceKey<WeatherService>('WeatherService'),
  /** The game's clock, and the sun, the moon and the stars it turns (spec §39). */
  timeOfDay: serviceKey<TimeOfDayService>('TimeOfDayService'),
  season: serviceKey<SeasonService>('SeasonService'),
  /** The northern lights some nights, and the sky's wonders the player has seen. */
  skyWonders: serviceKey<SkyWonderService>('SkyWonderService'),
  /** The timed events of spec §22 (not the event bus: that is `events`). */
  specialEvents: serviceKey<EventService>('EventService'),
  tutorial: serviceKey<TutorialService>('TutorialService'),
  missions: serviceKey<MissionService>('MissionService'),
  /** The contracts of the day (spec §28–29), which MissionService adds to the job board. */
  dailyContracts: serviceKey<DailyContracts>('DailyContracts'),
  navigation: serviceKey<NavigationService>('NavigationService'),
  economy: serviceKey<EconomyService>('EconomyService'),
  company: serviceKey<CompanyService>('CompanyService'),
  /** What the company builds for itself: a workshop, a fuel depot, a truck yard… */
  facilities: serviceKey<FacilityService>('FacilityService'),
  /** The daily reward: credits for each day's first claim, more for days in a row. */
  dailyReward: serviceKey<DailyRewardService>('DailyRewardService'),
  /** The truck stop's slot machine, for the company's credits. */
  casino: serviceKey<CasinoService>('CasinoService'),
  /** Asks for a rating on the store, seldom, after deliveries in good order. */
  review: serviceKey<ReviewService>('ReviewService'),
  /** The company's goals and their rewards. */
  achievements: serviceKey<AchievementService>('AchievementService'),
  /** Crates: earned for perfect streaks, levels and the daily streak; opened for credits and crate colours. */
  crates: serviceKey<CrateService>('CrateService'),
  /** What crates give besides credits and looks: upgrade parts and boosters. */
  supplies: serviceKey<SupplyService>('SupplyService'),
  /** The day's quests, each a crate. */
  quests: serviceKey<QuestService>('QuestService'),
  /** The trucks' designs and the trailer text. */
  liveries: serviceKey<LiveryService>('LiveryService'),
  /** The research tree: points from deliveries, perks for the whole company. */
  research: serviceKey<ResearchService>('ResearchService'),
  /** The company levels' rewards, waiting to be collected. */
  levelRewards: serviceKey<LevelRewardService>('LevelRewardService'),
  damage: serviceKey<DamageService>('DamageService'),
  fuel: serviceKey<FuelService>('FuelService'),
  garage: serviceKey<GarageService>('GarageService'),
  /** Ads and purchases (spec §35–36), behind the platform's AdService and PurchaseStore. */
  monetization: serviceKey<MonetizationService>('MonetizationService'),
  upgrades: serviceKey<UpgradeService>('UpgradeService'),
  /** The cities' depots and the roads between them, for the fleet's and the rivals' contracts. */
  depotRoads: serviceKey<DepotRoads>('DepotRoads'),
  /** The hired drivers and the trucks they take out on contracts (spec §27). */
  fleet: serviceKey<FleetService>('FleetService'),
  /** The rival companies, the cities' standing, campaigns and tenders (spec §65 V3). */
  rivals: serviceKey<RivalService>('RivalService'),
  /** The fleet's and the rivals' trucks in the traffic around the truck. */
  companyTraffic: serviceKey<CompanyTraffic>('CompanyTraffic'),
  saves: serviceKey<SaveService>('SaveService'),
  session: serviceKey<GameSessionService>('GameSessionService'),
});
