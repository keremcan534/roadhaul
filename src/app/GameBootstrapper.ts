import { EventBus } from '../core/events/EventBus';
import type { Logger } from '../core/logging/Logger';
import { ServiceContainer } from '../core/services/ServiceContainer';
import type { Clock } from '../core/time/Clock';
import { ValidationError } from '../core/validation/Validator';
import { validateGameConfig, type GameConfig } from '../data/config/GameConfig';
import { ContentCatalog } from '../data/ContentCatalog';
import type { GameContent } from '../data/GameContent';
import { DrivingService } from '../systems/driving/DrivingService';
import type { GameEvents } from '../systems/GameEvents';
import { GameStateService } from '../systems/gameState/GameStateService';
import { ServiceKeys } from './ServiceKeys';

export interface BootstrapOptions {
  readonly config: GameConfig;
  readonly content: GameContent;
  readonly logger: Logger;
  readonly clock: Clock;
}

/**
 * Composition root for the headless game: creates, wires and initializes every
 * engine-agnostic service, then enters the main menu. It never touches the
 * DOM or three.js. The browser entry point (src/main.ts) adds rendering on top,
 * and tests or a future server can boot the same services without a browser.
 */
export class GameBootstrapper {
  private container: ServiceContainer | null = null;
  private booting = false;

  constructor(private readonly options: BootstrapOptions) {}

  /**
   * Boots the game and returns the service container. Throws a ValidationError
   * for invalid content or config, after releasing anything already created.
   */
  async boot(): Promise<ServiceContainer> {
    if (this.booting || this.container !== null) {
      throw new Error('The game is already booted or booting.');
    }
    this.booting = true;
    try {
      this.container = await this.createServices();
      return this.container;
    } finally {
      this.booting = false;
    }
  }

  /** Disposes every service in reverse registration order. Safe to call more than once. */
  shutdown(): void {
    const container = this.container;
    this.container = null;
    container?.disposeAll();
  }

  private async createServices(): Promise<ServiceContainer> {
    const { config, content, logger, clock } = this.options;
    const log = logger.withCategory('Boot');
    const startedAtMs = clock.now();
    const container = new ServiceContainer();

    try {
      container.register(ServiceKeys.logger, logger);
      container.register(ServiceKeys.clock, clock);
      const catalog = container.register(ServiceKeys.content, ContentCatalog.create(content));
      const configIssues = validateGameConfig(config, catalog);
      if (configIssues.length > 0) {
        throw new ValidationError('Game config', configIssues);
      }
      container.register(ServiceKeys.config, config);

      const events = container.register(
        ServiceKeys.events,
        new EventBus<GameEvents>(logger.withCategory('Events')),
      );
      const gameState = container.register(
        ServiceKeys.gameState,
        new GameStateService(events, logger.withCategory('GameState')),
      );
      container.register(ServiceKeys.driving, new DrivingService(catalog, events, logger.withCategory('Driving')));

      await container.initializeAll();
      gameState.transitionTo('mainMenu');
      log.info(`Ready in ${clock.now() - startedAtMs} ms: ${describeContent(catalog)}.`);
    } catch (error) {
      releaseAfterFailedBoot(container, log);
      throw error;
    }
    return container;
  }
}

function releaseAfterFailedBoot(container: ServiceContainer, log: Logger): void {
  try {
    container.disposeAll();
  } catch (disposeError) {
    log.error('Cleanup after a failed boot also failed.', disposeError);
  }
}

function describeContent(catalog: ContentCatalog): string {
  return [
    `vehicles ${catalog.vehicles.size}`,
    `cargo types ${catalog.cargo.size}`,
    `cities ${catalog.cities.size}`,
    `missions ${catalog.missions.size}`,
    `maps ${catalog.maps.size}`,
  ].join(', ');
}
