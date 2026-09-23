import type { EventBus } from '../core/events/EventBus';
import type { Logger } from '../core/logging/Logger';
import { serviceKey } from '../core/services/ServiceContainer';
import type { Clock } from '../core/time/Clock';
import type { GameConfig } from '../data/config/GameConfig';
import type { ContentCatalog } from '../data/ContentCatalog';
import type { CompanyService } from '../systems/company/CompanyService';
import type { DrivingService } from '../systems/driving/DrivingService';
import type { EconomyService } from '../systems/economy/EconomyService';
import type { GameEvents } from '../systems/GameEvents';
import type { GameStateService } from '../systems/gameState/GameStateService';
import type { MissionService } from '../systems/missions/MissionService';
import type { NavigationService } from '../systems/navigation/NavigationService';
import type { SaveService } from '../systems/save/SaveService';
import type { GameSessionService } from '../systems/session/GameSessionService';
import type { TrafficService } from '../systems/traffic/TrafficService';
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
  missions: serviceKey<MissionService>('MissionService'),
  navigation: serviceKey<NavigationService>('NavigationService'),
  economy: serviceKey<EconomyService>('EconomyService'),
  company: serviceKey<CompanyService>('CompanyService'),
  damage: serviceKey<DamageService>('DamageService'),
  fuel: serviceKey<FuelService>('FuelService'),
  garage: serviceKey<GarageService>('GarageService'),
  upgrades: serviceKey<UpgradeService>('UpgradeService'),
  saves: serviceKey<SaveService>('SaveService'),
  session: serviceKey<GameSessionService>('GameSessionService'),
});
