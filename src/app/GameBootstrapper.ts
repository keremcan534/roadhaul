import { EventBus } from '../core/events/EventBus';
import type { Logger } from '../core/logging/Logger';
import { ServiceContainer } from '../core/services/ServiceContainer';
import type { KeyValueStorage } from '../core/storage/KeyValueStorage';
import type { Clock } from '../core/time/Clock';
import { ValidationError } from '../core/validation/Validator';
import { validateGameConfig, type GameConfig } from '../data/config/GameConfig';
import { ContentCatalog } from '../data/ContentCatalog';
import type { GameContent } from '../data/GameContent';
import { CompanyService } from '../systems/company/CompanyService';
import { DrivingService } from '../systems/driving/DrivingService';
import { EconomyService } from '../systems/economy/EconomyService';
import { EventService } from '../systems/events/EventService';
import { DepotRoads } from '../systems/fleet/DepotRoads';
import { FleetService } from '../systems/fleet/FleetService';
import type { GameEvents } from '../systems/GameEvents';
import { GameStateService } from '../systems/gameState/GameStateService';
import { CombinedContracts } from '../systems/missions/CombinedContracts';
import { DailyContracts } from '../systems/missions/DailyContracts';
import { MissionService } from '../systems/missions/MissionService';
import { NavigationService } from '../systems/navigation/NavigationService';
import { RivalService } from '../systems/rivals/RivalService';
import { TenderBoard } from '../systems/rivals/TenderBoard';
import { SaveService } from '../systems/save/SaveService';
import { GameSessionService } from '../systems/session/GameSessionService';
import { TrafficService } from '../systems/traffic/TrafficService';
import { TutorialService } from '../systems/tutorial/TutorialService';
import { TimeOfDayService } from '../systems/weather/TimeOfDayService';
import { WeatherService } from '../systems/weather/WeatherService';
import { DamageService } from '../systems/vehicles/DamageService';
import { FuelService } from '../systems/vehicles/FuelService';
import { GarageService } from '../systems/vehicles/GarageService';
import { UpgradeService } from '../systems/vehicles/UpgradeService';
import { ServiceKeys } from './ServiceKeys';

export interface BootstrapOptions {
  readonly config: GameConfig;
  readonly content: GameContent;
  readonly logger: Logger;
  readonly clock: Clock;
  /** Where saves go: localStorage in the browser, MemoryStorage in tests. */
  readonly storage: KeyValueStorage;
  /** Minutes the device's time zone runs ahead of UTC, for a clock that keeps the device's time. Default: 0. */
  readonly localTimeOffsetMinutes?: number;
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
    const { config, content, logger, clock, storage } = this.options;
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
      const driving = container.register(
        ServiceKeys.driving,
        new DrivingService(catalog, events, logger.withCategory('Driving')),
      );
      const traffic = container.register(
        ServiceKeys.traffic,
        new TrafficService(driving, catalog, config.traffic, logger.withCategory('Traffic')),
      );
      const timeOfDay = container.register(
        ServiceKeys.timeOfDay,
        new TimeOfDayService(catalog, clock, config.timeOfDay, this.options.localTimeOffsetMinutes ?? 0),
      );
      container.register(
        ServiceKeys.weather,
        new WeatherService(catalog, driving, traffic, events, config.weather, logger.withCategory('Weather'), timeOfDay),
      );
      // Subscription order matters: the economy and the company apply a delivery before the session saves it,
      // and the garage must be created after the services it drives (missions, damage, fuel).
      const economy = container.register(
        ServiceKeys.economy,
        new EconomyService(events, config.economy, logger.withCategory('Economy')),
      );
      const company = container.register(
        ServiceKeys.company,
        new CompanyService(events, config.company, logger.withCategory('Company')),
      );
      const dailyContracts = container.register(
        ServiceKeys.dailyContracts,
        new DailyContracts(catalog, driving, clock, config.missions.dailyContracts),
      );
      // The tenders go up on the job board beside the contracts of the day (RivalService puts them there).
      const tenders = new TenderBoard();
      const missions = container.register(
        ServiceKeys.missions,
        new MissionService(
          catalog,
          driving,
          company,
          events,
          config.missions,
          logger.withCategory('Missions'),
          new CombinedContracts([dailyContracts, tenders]),
        ),
      );
      container.register(
        ServiceKeys.navigation,
        new NavigationService(
          driving,
          missions,
          config.traffic.speedLimitsKmh,
          config.navigation,
          logger.withCategory('Navigation'),
        ),
      );
      const damage = container.register(
        ServiceKeys.damage,
        new DamageService(driving, economy, events, logger.withCategory('Damage')),
      );
      const fuel = container.register(
        ServiceKeys.fuel,
        new FuelService(driving, damage, economy, events, config.fuel, logger.withCategory('Fuel')),
      );
      const garage = container.register(
        ServiceKeys.garage,
        new GarageService(
          catalog,
          driving,
          missions,
          fuel,
          damage,
          economy,
          company,
          events,
          logger.withCategory('Garage'),
          config.fleet.garageSlots,
        ),
      );
      container.register(
        ServiceKeys.upgrades,
        new UpgradeService(catalog, garage, economy, company, events, logger.withCategory('Upgrades')),
      );
      const depotRoads = container.register(ServiceKeys.depotRoads, new DepotRoads(catalog, driving));
      const fleet = container.register(
        ServiceKeys.fleet,
        new FleetService(
          catalog,
          depotRoads,
          garage,
          economy,
          company,
          events,
          config.fleet,
          config.economy,
          config.fuel,
          logger.withCategory('Fleet'),
        ),
      );
      // After the economy and the company: a delivery is paid and scored before its event bonus.
      const specialEvents = container.register(
        ServiceKeys.specialEvents,
        new EventService(catalog, company, economy, clock, events, logger.withCategory('Events')),
      );
      // After the events: the leader's bonus comes on top of a delivery's pay and its event bonus.
      const rivals = container.register(
        ServiceKeys.rivals,
        new RivalService(
          catalog,
          depotRoads,
          tenders,
          missions,
          garage,
          economy,
          company,
          clock,
          events,
          config.rivals,
          config.fleet,
          config.economy,
          config.fuel,
          config.missions.loadingSeconds,
          logger.withCategory('Rivals'),
        ),
      );
      const tutorial = container.register(ServiceKeys.tutorial, new TutorialService(events, logger.withCategory('Tutorial')));
      const saves = container.register(
        ServiceKeys.saves,
        new SaveService(
          storage,
          catalog,
          {
            migration: { defaultMapId: config.newGame.startingMapId },
            maxCompanyLevel: config.company.levelXp.length,
          },
          logger.withCategory('Save'),
        ),
      );
      container.register(
        ServiceKeys.session,
        new GameSessionService({
          content: catalog,
          config,
          clock,
          events,
          saves,
          driving,
          missions,
          economy,
          company,
          garage,
          fleet,
          rivals,
          specialEvents,
          tutorial,
          logger: logger.withCategory('Session'),
        }),
      );

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
    `upgrades ${catalog.upgrades.size}`,
    `traffic vehicles ${catalog.trafficVehicles.size}`,
    `weather ${catalog.weather.size}`,
    `times of day ${catalog.daylight.size}`,
    `events ${catalog.events.size}`,
    `drivers ${catalog.drivers.size}`,
    `rivals ${catalog.rivals.size}`,
  ].join(', ');
}
