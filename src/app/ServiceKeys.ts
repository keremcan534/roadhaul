import type { EventBus } from '../core/events/EventBus';
import type { Logger } from '../core/logging/Logger';
import { serviceKey } from '../core/services/ServiceContainer';
import type { Clock } from '../core/time/Clock';
import type { GameConfig } from '../data/config/GameConfig';
import type { ContentCatalog } from '../data/ContentCatalog';
import type { GameEvents } from '../systems/GameEvents';
import type { GameStateService } from '../systems/gameState/GameStateService';

/** Keys of every service registered by GameBootstrapper. Only composition code resolves them. */
export const ServiceKeys = Object.freeze({
  logger: serviceKey<Logger>('Logger'),
  clock: serviceKey<Clock>('Clock'),
  config: serviceKey<GameConfig>('GameConfig'),
  content: serviceKey<ContentCatalog>('ContentCatalog'),
  events: serviceKey<EventBus<GameEvents>>('EventBus'),
  gameState: serviceKey<GameStateService>('GameStateService'),
});
