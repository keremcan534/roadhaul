import type { EventBus, Unsubscribe } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import { err, ok, type Result } from '../../core/Result';
import type { Clock } from '../../core/time/Clock';
import type { GameConfig } from '../../data/config/GameConfig';
import type { ContentCatalog } from '../../data/ContentCatalog';
import { validateCompanyName, type CompanyNameError } from '../../domain/company/companyName';
import { createNewSaveGameData } from '../../domain/save/createNewSaveGameData';
import { CURRENT_SAVE_VERSION, type SaveGameData } from '../../domain/save/SaveGameData';
import type { CompanyService } from '../company/CompanyService';
import type { DrivingService } from '../driving/DrivingService';
import type { EconomyService } from '../economy/EconomyService';
import type { EventService } from '../events/EventService';
import type { FleetService } from '../fleet/FleetService';
import type { GameEvents } from '../GameEvents';
import type { MissionService } from '../missions/MissionService';
import type { LoadProblem, SaveProblem, SaveService } from '../save/SaveService';
import type { TutorialService } from '../tutorial/TutorialService';
import type { GarageService } from '../vehicles/GarageService';

/** While driving, the game saves itself this often (seconds of driving). */
export const AUTOSAVE_INTERVAL_SECONDS = 20;

export interface GameSessionDependencies {
  readonly content: ContentCatalog;
  readonly config: GameConfig;
  readonly clock: Clock;
  readonly events: EventBus<GameEvents>;
  readonly saves: SaveService;
  readonly driving: DrivingService;
  readonly missions: MissionService;
  readonly economy: EconomyService;
  readonly company: CompanyService;
  readonly garage: GarageService;
  /** The hired drivers and their trucks (spec §27). */
  readonly fleet: FleetService;
  /** The company's progress in the special events (spec §22). */
  readonly specialEvents: EventService;
  readonly tutorial: TutorialService;
  readonly logger: Logger;
}

/**
 * The company being played (spec §41 onboarding, §32 saving): starts a new
 * game or continues the saved one, hands each part of the save to the
 * service that owns it, and writes it back. It saves after every delivery,
 * failure, purchase and truck change, every change in the fleet and each of
 * its deliveries, when the player leaves the road for a menu, and every 20 s
 * of driving, so closing the tab loses little. A company continued after a
 * while away finds its fleet has worked on meanwhile (FleetService.catchUp).
 */
export class GameSessionService {
  private active = false;
  private createdAtMs = 0;
  private distanceBeforeThisDrive = 0;
  private sinceAutosave = 0;
  private readonly unsubscribe: Unsubscribe[];

  constructor(private readonly deps: GameSessionDependencies) {
    const { events } = deps;
    const saveNow = (): void => {
      if (this.active) {
        this.save();
      }
    };
    // Subscribed after the services that apply these events, so their changes are in the save.
    // Purchases save on the event that completes them, not on MoneyChanged: when the
    // money moves, the fuel, repair, truck or upgrade bought is not in place yet.
    this.unsubscribe = [
      events.on('MissionCompleted', saveNow),
      events.on('MissionFailed', saveNow),
      events.on('Refuelled', saveNow),
      events.on('VehicleRepaired', saveNow),
      events.on('VehiclePurchased', saveNow),
      events.on('UpgradePurchased', saveNow),
      events.on('VehiclePainted', saveNow),
      events.on('ActiveVehicleChanged', saveNow),
      events.on('TutorialStepChanged', saveNow),
      events.on('DriverHired', saveNow),
      events.on('DriverDismissed', saveNow),
      events.on('FleetTruckAssigned', saveNow),
      events.on('FleetTruckRepaired', saveNow),
      events.on('FleetCaughtUp', saveNow),
      // While catching up, once at the end (FleetCaughtUp).
      events.on('FleetJobCompleted', ({ away }) => {
        if (!away) {
          saveNow();
        }
      }),
      events.on('GameStateChanged', ({ previous }) => {
        if (previous === 'driving') {
          saveNow();
        }
      }),
    ];
  }

  /** A company is loaded (new or continued). */
  get isActive(): boolean {
    return this.active;
  }

  hasSavedGame(): boolean {
    return this.deps.saves.hasSave();
  }

  /** Founds a new company with the player's name, replacing any saved game. */
  startNewGame(companyName: string): Result<void, CompanyNameError> {
    const name = validateCompanyName(companyName);
    if (!name.ok) {
      return err(name.error);
    }
    const { config, content, clock } = this.deps;
    const save = createNewSaveGameData({
      companyName: name.value,
      startingCredits: config.newGame.startingCredits,
      startingVehicle: content.vehicles.get(config.newGame.startingVehicleId),
      startingMapId: config.newGame.startingMapId,
      nowMs: clock.now(),
    });
    this.apply(save);
    this.deps.logger.info(`New company "${name.value}".`);
    this.save();
    return ok(undefined);
  }

  /**
   * Loads the saved game. On any problem the current state is left as it
   * was. The fleet then works through the time since the save was written
   * (at most GameConfig.fleet.awayHours), as it would have on the road.
   */
  continueGame(): Result<void, LoadProblem> {
    const loaded = this.deps.saves.load();
    if (!loaded.ok) {
      return err(loaded.error);
    }
    this.apply(loaded.value);
    this.deps.logger.info(`Continuing "${loaded.value.profile.companyName}".`);
    this.deps.fleet.catchUp((this.deps.clock.now() - loaded.value.updatedAtMs) / 1000);
    return ok(undefined);
  }

  /** Writes the current game. Does nothing (successfully) before a game is loaded. */
  save(): Result<void, SaveProblem> {
    if (!this.active) {
      return ok(undefined);
    }
    this.sinceAutosave = 0;
    return this.deps.saves.save(this.snapshot());
  }

  /** Counts driving time and saves every AUTOSAVE_INTERVAL_SECONDS. Call every fixed step while driving. */
  update(dt: number): void {
    if (!this.active) {
      return;
    }
    this.sinceAutosave += dt;
    if (this.sinceAutosave >= AUTOSAVE_INTERVAL_SECONDS) {
      this.save();
    }
  }

  /** The whole game as save data. */
  snapshot(): SaveGameData {
    const { driving, missions, economy, company, garage, fleet, specialEvents, tutorial } = this.deps;
    const vehicle = driving.vehicle;
    const progress = company.levelProgress;
    return {
      version: CURRENT_SAVE_VERSION,
      createdAtMs: this.createdAtMs,
      updatedAtMs: this.deps.clock.now(),
      profile: { companyName: company.companyName },
      company: { level: progress.level, xp: company.xp, reputation: company.reputation },
      economy: { credits: economy.credits },
      garage: garage.snapshot(),
      world: {
        mapId: driving.world.id,
        truck: { x: vehicle.x, z: vehicle.z, headingRadians: vehicle.heading },
      },
      missions: { active: missions.snapshot() },
      stats: {
        ...company.stats,
        distanceDrivenMeters: this.distanceBeforeThisDrive + vehicle.odometerMeters,
      },
      events: { runs: specialEvents.snapshot() },
      tutorial: { step: tutorial.step },
      fleet: fleet.snapshot(),
    };
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribe) {
      unsubscribe();
    }
  }

  /** Hands every part of `save` to the service that owns it. */
  private apply(save: SaveGameData): void {
    const { driving, missions, economy, company, garage, fleet, specialEvents, tutorial } = this.deps;
    const truck = save.garage.vehicles.find((vehicle) => vehicle.instanceId === save.garage.activeVehicleInstanceId);
    if (truck === undefined) {
      throw new Error('The save has no active truck.'); // validateSaveGameData guarantees one.
    }
    driving.start(truck.definitionId, save.world.mapId);
    const placement = save.world.truck;
    if (placement !== null) {
      driving.placeTruck(placement.x, placement.z, placement.headingRadians);
    }
    economy.restore(save.economy.credits);
    company.restore(save.profile, save.company, save.stats);
    garage.restore(save.garage);
    fleet.restore(save.fleet);
    missions.restore(save.missions.active);
    specialEvents.restore(save.events.runs);
    tutorial.restore(save.tutorial.step);
    this.createdAtMs = save.createdAtMs;
    this.distanceBeforeThisDrive = save.stats.distanceDrivenMeters;
    this.sinceAutosave = 0;
    this.active = true;
  }
}
