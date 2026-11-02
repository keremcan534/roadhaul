import type { EventBus, Unsubscribe } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import { err, ok, type Result } from '../../core/Result';
import { degreesToRadians } from '../../core/math/scalar';
import type { Clock } from '../../core/time/Clock';
import type { GameConfig } from '../../data/config/GameConfig';
import type { ContentCatalog } from '../../data/ContentCatalog';
import type { MapDefinition } from '../../data/definitions/MapDefinition';
import type { VehicleDefinition } from '../../data/definitions/VehicleDefinition';
import { PLAYER_COMPANY_ID } from '../../data/definitions/RivalCompanyDefinition';
import { validateCompanyName, type CompanyNameError } from '../../domain/company/companyName';
import type { TruckPose } from '../../domain/missions/loadingBay';
import { createNewSaveGameData } from '../../domain/save/createNewSaveGameData';
import { CURRENT_SAVE_VERSION, type SaveGameData } from '../../domain/save/SaveGameData';
import { summarizeSave, type SaveSummary } from '../../domain/save/saveSummary';
import { HOME_START_ID, LEFT_START_ID, startPlaces, type StartPlace } from '../../domain/world/startPlaces';
import type { CompanyService } from '../company/CompanyService';
import type { FacilityService } from '../company/FacilityService';
import type { ResearchService } from '../company/ResearchService';
import type { CareerService } from '../company/CareerService';
import type { RoadEventService } from '../world/RoadEventService';
import type { UsedTruckMarket } from '../vehicles/UsedTruckMarket';
import type { WeeklyCupService } from '../rivals/WeeklyCupService';
import type { RoadPassService } from '../rewards/RoadPassService';
import type { DailyRewardService } from '../rewards/DailyRewardService';
import type { AchievementService } from '../achievements/AchievementService';
import type { LevelRewardService } from '../company/LevelRewardService';
import type { CrateService } from '../rewards/CrateService';
import type { QuestService } from '../rewards/QuestService';
import type { SupplyService } from '../rewards/SupplyService';
import type { LiveryService } from '../vehicles/LiveryService';
import type { DrivingService } from '../driving/DrivingService';
import type { EconomyService } from '../economy/EconomyService';
import type { EventService } from '../events/EventService';
import type { FleetService } from '../fleet/FleetService';
import type { GameEvents } from '../GameEvents';
import type { MissionService } from '../missions/MissionService';
import type { RivalService } from '../rivals/RivalService';
import type { BackupProblem, LoadProblem, SaveProblem, SaveService } from '../save/SaveService';
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
  /** The research tree. */
  readonly research: ResearchService;
  /** The career's records. */
  readonly career: CareerService;
  /** The road's events: the warning given, the contract's fines and knocks. */
  readonly roadEvents: RoadEventService;
  /** The used-truck market: the trucks bought from its list. */
  readonly usedTrucks: UsedTruckMarket;
  /** The weekly cup: the week's points, the last cup's result. */
  readonly weeklyCup: WeeklyCupService;
  /** The Road Pass: the season's points, the tiers collected, the colours kept. */
  readonly roadPass: RoadPassService;
  /** The daily reward's streak. */
  readonly dailyReward: DailyRewardService;
  /** The company's goals. */
  readonly achievements: AchievementService;
  /** The crates, the colours they gave and the perfect streak. */
  readonly crates: CrateService;
  /** The company levels' rewards collected. */
  readonly levelRewards: LevelRewardService;
  /** The parts and boosters crates gave. */
  readonly supplies: SupplyService;
  /** The day's quests. */
  readonly quests: QuestService;
  /** The trucks' designs and the trailer text. */
  readonly liveries: LiveryService;
  /** The company's progress in the special events (spec §22). */
  readonly specialEvents: EventService;
  readonly tutorial: TutorialService;
  readonly logger: Logger;
}

/** Why the company cannot travel: nothing loaded, a contract under way, no such gate, or the save could not be written. */
export type TravelProblem = 'noCompany' | 'contractUnderWay' | 'unknownGate' | 'storageFailed';

/**
 * The company being played (spec §41 onboarding, §32 saving): starts a new
 * game or continues the saved one, hands each part of the save to the
 * service that owns it, and writes it back. It saves after every delivery,
 * failure, purchase and truck change, every change in the fleet and each of
 * its deliveries, every campaign, buy-out, facility built, daily reward and change of a
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
      events.on('VehicleSold', saveNow),
      events.on('WeeklyCupEnded', saveNow),
      events.on('RoadPassClaimed', saveNow),
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
      events.on('ResearchCompleted', saveNow),
      events.on('DailyRewardClaimed', saveNow),
      events.on('AchievementClaimed', saveNow),
      events.on('CrateOpened', saveNow),
      events.on('LevelRewardCollected', saveNow),
      events.on('CrateEarned', saveNow),
      events.on('SuppliesChanged', saveNow),
      events.on('LiveryChanged', saveNow),
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

  /** Metres the company's trucks were driven by the player, this drive's included. */
  get distanceDrivenMeters(): number {
    return this.active ? this.distanceBeforeThisDrive + this.deps.driving.vehicle.odometerMeters : 0;
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
      content.vehicles.get(saved?.truckModelId ?? config.newGame.startingVehicleId),
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

  /**
   * Takes the company to another region through gate `gateId` of the map it
   * is on (a ferry): the game is saved with the truck at the gate it
   * arrives at on the other map, then closed (nothing saves over it), for
   * the game to start again there. Not while a contract is under way (its
   * depots are in this region), nor while nothing is loaded.
   */
  travel(gateId: string): Result<{ readonly mapId: string }, TravelProblem> {
    const { driving, content, missions, saves } = this.deps;
    if (!this.active) {
      return err('noCompany');
    }
    if (missions.active !== null) {
      return err('contractUnderWay');
    }
    const gate = driving.world.gates.find((candidate) => candidate.id === gateId);
    if (gate === undefined || !content.maps.has(gate.toMapId)) {
      return err('unknownGate');
    }
    const arrival = content.maps.get(gate.toMapId).gates?.find((candidate) => candidate.id === gate.toGateId);
    if (arrival === undefined) {
      return err('unknownGate');
    }
    const snapshot = this.snapshot();
    const saved = saves.save({
      ...snapshot,
      world: {
        mapId: gate.toMapId,
        truck: { x: arrival.arrival.x, z: arrival.arrival.z, headingRadians: (arrival.arrival.headingDegrees * Math.PI) / 180 },
      },
    });
    if (!saved.ok) {
      return err('storageFailed');
    }
    this.active = false;
    this.deps.logger.info(`Travelling to ${gate.toMapId} through ${gate.id}.`);
    return ok({ mapId: gate.toMapId });
  }

  /** Writes the current game. Does nothing (successfully) before a game is loaded. */
  save(): Result<void, SaveProblem> {
    if (!this.active) {
      return ok(undefined);
    }
    this.sinceAutosave = 0;
    return this.deps.saves.save(this.snapshot());
  }

  /**
   * The company as a backup file's text: the latest save, at this version
   * (written first if a company is loaded, so nothing since the last
   * autosave is left out).
   */
  exportBackup(): Result<string, LoadProblem> {
    this.save();
    return this.deps.saves.exportText();
  }

  /** What a backup holds, at a glance, for the player to confirm; or why it cannot be restored. */
  readBackup(text: string): Result<SaveSummary, BackupProblem> {
    const read = this.deps.saves.readText(text);
    return read.ok ? ok(summarizeSave(read.value, this.deps.content)) : err(read.error);
  }

  /**
   * Makes a backup's company the saved one, replacing the company saved
   * now. A company loaded is closed first (saved, then no longer saved
   * over): the game starts again after, to load the restored one.
   */
  restoreBackup(text: string): Result<void, BackupProblem | SaveProblem> {
    const read = this.deps.saves.readText(text);
    if (!read.ok) {
      return read;
    }
    this.save();
    const restored = this.deps.saves.importText(text);
    if (!restored.ok) {
      return restored;
    }
    this.active = false;
    this.deps.logger.info(`Restored "${restored.value.profile.companyName}" from a backup.`);
    return ok(undefined);
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
    const {
      driving,
      missions,
      economy,
      company,
      garage,
      fleet,
      rivals,
      facilities,
      research,
      career,
      roadEvents,
      usedTrucks,
      weeklyCup,
      roadPass,
      dailyReward,
      achievements,
      crates,
      levelRewards,
      supplies,
      quests,
      liveries,
      specialEvents,
      tutorial,
    } = this.deps;
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
      research: research.snapshot(),
      career: career.snapshot(),
      roadEvents: roadEvents.snapshot(),
      usedTrucks: usedTrucks.snapshot(),
      weeklyCup: weeklyCup.snapshot(),
      roadPass: roadPass.snapshot(),
      daily: dailyReward.snapshot(),
      achievements: achievements.snapshot(),
      crates: crates.snapshot(),
      levelRewards: levelRewards.snapshot(),
      supplies: supplies.snapshot(),
      quests: quests.snapshot(),
      liveries: liveries.snapshot(),
    };
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribe) {
      unsubscribe();
    }
  }

  /** The start places on map `mapId`, parked for a `truck` of the model (with its trailer); `left` as in startPlaces. */
  private placesOn(mapId: string, truck: VehicleDefinition, left: TruckPose | null): StartPlace[] {
    const map = this.deps.content.maps.get(mapId);
    return startPlaces({ spawn: mapStart(map), depots: map.depots, restAreas: map.restAreas }, truck, left);
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
    const place = this.placesOn(driving.world.id, driving.definition, null).find((candidate) => candidate.id === startId);
    if (place === undefined || place.kind === 'home') {
      return;
    }
    driving.placeTruck(place.x, place.z, place.heading);
    logger.info(`Starting at ${startId}.`);
  }

  /** Hands every part of `save` to the service that owns it. */
  private apply(save: SaveGameData): void {
    const {
      driving,
      missions,
      economy,
      company,
      garage,
      fleet,
      rivals,
      facilities,
      research,
      career,
      roadEvents,
      usedTrucks,
      weeklyCup,
      roadPass,
      dailyReward,
      achievements,
      crates,
      levelRewards,
      supplies,
      quests,
      liveries,
      specialEvents,
      tutorial,
    } = this.deps;
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
    research.restore(save.research);
    career.restore(save.career);
    roadEvents.restore(save.roadEvents);
    usedTrucks.restore(save.usedTrucks);
    weeklyCup.restore(save.weeklyCup);
    roadPass.restore(save.roadPass);
    dailyReward.restore(save.daily);
    crates.restore(save.crates); // Before the garage: a truck may wear a crate colour.
    levelRewards.restore(save.levelRewards);
    supplies.restore(save.supplies);
    garage.restore(save.garage);
    liveries.restore(save.liveries);
    fleet.restore(save.fleet);
    missions.restore(save.missions.active);
    rivals.restore(save.rivals); // After the contract under way: a tender being raced must be it.
    specialEvents.restore(save.events.runs);
    tutorial.restore(save.tutorial.step);
    this.createdAtMs = save.createdAtMs;
    this.distanceBeforeThisDrive = save.stats.distanceDrivenMeters;
    achievements.restore(save.achievements); // Last: the goals measure everything above.
    this.sinceAutosave = 0;
    this.active = true;
    quests.restore(save.quests); // Once active: the day's kilometres count from the distance driven.
  }
}

/** Where a truck starts on `map` unless it was parked: its spawn, the heading in radians. */
function mapStart(map: MapDefinition): TruckPose {
  return { x: map.spawn.x, z: map.spawn.z, heading: degreesToRadians(map.spawn.headingDegrees) };
}
