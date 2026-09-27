import type { EventBus, Unsubscribe } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import { err, ok, type Result } from '../../core/Result';
import { degreesToRadians } from '../../core/math/scalar';
import type { Clock } from '../../core/time/Clock';
import type { GameConfig } from '../../data/config/GameConfig';
import type { ContentCatalog } from '../../data/ContentCatalog';
import type { MapDefinition } from '../../data/definitions/MapDefinition';
import type { VehicleBody } from '../../data/definitions/VehicleDefinition';
import { PLAYER_COMPANY_ID } from '../../data/definitions/RivalCompanyDefinition';
import { validateCompanyName, type CompanyNameError } from '../../domain/company/companyName';
import type { TruckPose } from '../../domain/missions/loadingBay';
import { createNewSaveGameData } from '../../domain/save/createNewSaveGameData';
import { CURRENT_SAVE_VERSION, type SaveGameData } from '../../domain/save/SaveGameData';
import { summarizeSave, type SaveSummary } from '../../domain/save/saveSummary';
import { HOME_START_ID, LEFT_START_ID, startPlaces, type StartPlace } from '../../domain/world/startPlaces';
import type { CompanyService } from '../company/CompanyService';
import type { FacilityService } from '../company/FacilityService';
import type { DrivingService } from '../driving/DrivingService';
import type { EconomyService } from '../economy/EconomyService';
import type { EventService } from '../events/EventService';
import type { FleetService } from '../fleet/FleetService';
import type { GameEvents } from '../GameEvents';
import type { MissionService } from '../missions/MissionService';
import type { RivalService } from '../rivals/RivalService';
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
  /** The rival companies and the cities' standing. */
  readonly rivals: RivalService;
  /** What the company has built for itself. */
  readonly facilities: FacilityService;
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
 * its deliveries, every campaign, buy-out, facility built and change of a
 * city's leader,
 * when the player leaves the road for a menu, and every 20 s of driving, so
 * closing the tab loses little. A company continued after a while away finds
 * the rivals and its fleet have worked on meanwhile (RivalService.catchUp,
 * FleetService.catchUp).
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
      events.on('RivalAcquired', saveNow),
      events.on('FacilityBuilt', saveNow),
      events.on('CampaignRun', ({ companyId, away }) => {
        if (companyId === PLAYER_COMPANY_ID && !away) {
          saveNow();
        }
      }),
      events.on('CityLeaderChanged', ({ away }) => {
        if (!away) {
          saveNow();
        }
      }),
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

  /**
   * The saved company at a glance (the main menu's card), read without
   * loading it; the problem that keeps it from being continued otherwise.
   */
  readSave(): Result<SaveSummary, LoadProblem> {
    const loaded = this.deps.saves.load();
    return loaded.ok ? ok(summarizeSave(loaded.value, this.deps.content)) : err(loaded.error);
  }

  /**
   * Where a drive can start: on the map of `saved`, where its truck was
   * left (at the map's own start if it was never parked), or for a new
   * company (`saved` null) at the starting map's own start; then each depot
   * and rest area (startPlaces), parked for the truck `saved` drives (the
   * starting truck for a new company).
   */
  startPlaces(saved: SaveSummary | null): StartPlace[] {
    const { content, config } = this.deps;
    const left =
      saved === null
        ? null
        : saved.truck === null
          ? mapStart(content.maps.get(saved.mapId))
          : { x: saved.truck.x, z: saved.truck.z, heading: saved.truck.headingRadians };
    return this.placesOn(
      saved?.mapId ?? config.newGame.startingMapId,
      content.vehicles.get(saved?.truckModelId ?? config.newGame.startingVehicleId).body,
      left,
    );
  }

  /**
   * Founds a new company with the player's name, replacing any saved game.
   * Its truck starts at the map's own start, or at the depot or rest area
   * `startId` picks (startPlaces).
   */
  startNewGame(companyName: string, startId: string = HOME_START_ID): Result<void, CompanyNameError> {
    const name = validateCompanyName(companyName);
    if (!name.ok) {
      return err(name.error);
    }
    this.checkStart(startId, this.deps.config.newGame.startingMapId);
    const { config, content, clock } = this.deps;
    const save = createNewSaveGameData({
      companyName: name.value,
      startingCredits: config.newGame.startingCredits,
      startingVehicle: content.vehicles.get(config.newGame.startingVehicleId),
      startingMapId: config.newGame.startingMapId,
      nowMs: clock.now(),
    });
    this.apply(save);
    this.startAt(startId);
    this.deps.logger.info(`New company "${name.value}".`);
    this.save();
    return ok(undefined);
  }

  /**
   * Loads the saved game. On any problem the current state is left as it
   * was. The truck is where it was left, or at the depot or rest area
   * `startId` picks (startPlaces): not with a contract under way, which
   * goes on from where the truck was. The rivals, then the fleet, work
   * through the time since the save was written (at most
   * GameConfig.fleet.awayHours), as they would have on the road.
   */
  continueGame(startId: string = LEFT_START_ID): Result<void, LoadProblem> {
    const loaded = this.deps.saves.load();
    if (!loaded.ok) {
      return err(loaded.error);
    }
    if (startId !== LEFT_START_ID && loaded.value.missions.active !== null) {
      throw new Error(`A contract is under way: the drive goes on where the truck was left, not at ${startId}.`);
    }
    this.checkStart(startId, loaded.value.world.mapId);
    this.apply(loaded.value);
    this.startAt(startId);
    this.deps.logger.info(`Continuing "${loaded.value.profile.companyName}".`);
    const awaySeconds = (this.deps.clock.now() - loaded.value.updatedAtMs) / 1000;
    this.deps.rivals.catchUp(awaySeconds);
    this.deps.fleet.catchUp(awaySeconds);
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
    const { driving, missions, economy, company, garage, fleet, rivals, facilities, specialEvents, tutorial } = this.deps;
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
      rivals: rivals.snapshot(),
      facilities: facilities.snapshot(),
    };
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribe) {
      unsubscribe();
    }
  }

  /** The start places on map `mapId`, parked for a truck of `body`; `left` as in startPlaces. */
  private placesOn(mapId: string, body: VehicleBody, left: TruckPose | null): StartPlace[] {
    const map = this.deps.content.maps.get(mapId);
    return startPlaces({ spawn: mapStart(map), depots: map.depots, restAreas: map.restAreas }, body, left);
  }

  /**
   * Throws for a place to start at that is not one of map `mapId`'s start
   * places: a bug in the caller. Before anything is loaded.
   */
  private checkStart(startId: string, mapId: string): void {
    const map = this.deps.content.maps.get(mapId);
    const known =
      startId === LEFT_START_ID ||
      startId === HOME_START_ID ||
      map.depots.some((depot) => depot.id === startId) ||
      map.restAreas.some((restArea) => restArea.id === startId);
    if (!known) {
      throw new Error(`No place to start at is called ${startId}.`);
    }
  }

  /**
   * Parks the truck at the depot or rest area `startId` names (checked
   * already), parked for the truck now driven; for `left` and `home` it
   * stays where the save put it.
   */
  private startAt(startId: string): void {
    const { driving, logger } = this.deps;
    const place = this.placesOn(driving.world.id, driving.definition.body, null).find((candidate) => candidate.id === startId);
    if (place === undefined || place.kind === 'home') {
      return;
    }
    driving.placeTruck(place.x, place.z, place.heading);
    logger.info(`Starting at ${startId}.`);
  }

  /** Hands every part of `save` to the service that owns it. */
  private apply(save: SaveGameData): void {
    const { driving, missions, economy, company, garage, fleet, rivals, facilities, specialEvents, tutorial } = this.deps;
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
    facilities.restore(save.facilities); // Before the garage: a yard built makes room for more trucks.
    garage.restore(save.garage);
    fleet.restore(save.fleet);
    missions.restore(save.missions.active);
    rivals.restore(save.rivals); // After the contract under way: a tender being raced must be it.
    specialEvents.restore(save.events.runs);
    tutorial.restore(save.tutorial.step);
    this.createdAtMs = save.createdAtMs;
    this.distanceBeforeThisDrive = save.stats.distanceDrivenMeters;
    this.sinceAutosave = 0;
    this.active = true;
  }
}

/** Where a truck starts on `map` unless it was parked: its spawn, the heading in radians. */
function mapStart(map: MapDefinition): TruckPose {
  return { x: map.spawn.x, z: map.spawn.z, heading: degreesToRadians(map.spawn.headingDegrees) };
}
