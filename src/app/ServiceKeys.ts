import type { EventBus } from '../core/events/EventBus';
import type { Logger } from '../core/logging/Logger';
import { serviceKey } from '../core/services/ServiceContainer';
import type { Clock } from '../core/time/Clock';
import type { GameConfig } from '../data/config/GameConfig';
import type { ContentCatalog } from '../data/ContentCatalog';
import type { CompanyService } from '../systems/company/CompanyService';
import type { DrivingService } from '../systems/driving/DrivingService';
import type { EconomyService } from '../systems/economy/EconomyService';
import type { EventService } from '../systems/events/EventService';
import type { DepotRoads } from '../systems/fleet/DepotRoads';
import type { FleetService } from '../systems/fleet/FleetService';
import type { GameEvents } from '../systems/GameEvents';
import type { GameStateService } from '../systems/gameState/GameStateService';
import type { DailyContracts } from '../systems/missions/DailyContracts';
import type { MissionService } from '../systems/missions/MissionService';
import type { NavigationService } from '../systems/navigation/NavigationService';
import type { RivalService } from '../systems/rivals/RivalService';
import type { SaveService } from '../systems/save/SaveService';
import type { GameSessionService } from '../systems/session/GameSessionService';
import type { CompanyTraffic } from '../systems/traffic/CompanyTraffic';
import type { TrafficService } from '../systems/traffic/TrafficService';
import type { TutorialService } from '../systems/tutorial/TutorialService';
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
  weather: serviceKey<WeatherService>('WeatherService'),
  /** The game's clock, and the sun, the moon and the stars it turns (spec §39). */
  timeOfDay: serviceKey<TimeOfDayService>('TimeOfDayService'),
  /** The timed events of spec §22 (not the event bus: that is `events`). */
  specialEvents: serviceKey<EventService>('EventService'),
  tutorial: serviceKey<TutorialService>('TutorialService'),
  missions: serviceKey<MissionService>('MissionService'),
  /** The contracts of the day (spec §28–29), which MissionService adds to the job board. */
  dailyContracts: serviceKey<DailyContracts>('DailyContracts'),
  navigation: serviceKey<NavigationService>('NavigationService'),
  economy: serviceKey<EconomyService>('EconomyService'),
  company: serviceKey<CompanyService>('CompanyService'),
  damage: serviceKey<DamageService>('DamageService'),
  fuel: serviceKey<FuelService>('FuelService'),
  garage: serviceKey<GarageService>('GarageService'),
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
