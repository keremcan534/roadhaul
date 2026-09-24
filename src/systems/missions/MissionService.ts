import type { EventBus, Unsubscribe } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import { finiteOr } from '../../core/math/scalar';
import { err, ok, type Result } from '../../core/Result';
import type { GameConfig } from '../../data/config/GameConfig';
import type { ContentCatalog } from '../../data/ContentCatalog';
import type { CargoDefinition } from '../../data/definitions/CargoDefinition';
import type { DepotDefinition } from '../../data/definitions/MapDefinition';
import { vehicleCanHaul, type MissionDefinition } from '../../data/definitions/MissionDefinition';
import type { VehicleDefinition } from '../../data/definitions/VehicleDefinition';
import type { Credits, Fraction } from '../../data/units';
import { addCargoDamage, cargoDamageFromImpact, isWithinTolerance } from '../../domain/missions/cargoDamage';
import { isParkedInBay, STOPPED_SPEED_METERS_PER_SECOND } from '../../domain/missions/loadingBay';
import {
  createMissionInstance,
  failMission,
  isCargoAboard,
  isMissionFinished,
  transitionMission,
  type MissionFailureReason,
  type MissionInstance,
  type MissionState,
} from '../../domain/missions/MissionInstance';
import { deliveryReputation, deliveryXp, FAILURE_REPUTATION_LOSS } from '../../domain/missions/missionProgress';
import { calculateMissionReward, missionBasePay } from '../../domain/missions/missionReward';
import type { ActiveMissionSaveData } from '../../domain/save/SaveGameData';
import { MAX_SAVING } from '../../domain/vehicles/upgradeBonuses';
import { createRouteGuidance } from '../../domain/world/roadRoute';
import type { DrivingService } from '../driving/DrivingService';
import type { GameEvents } from '../GameEvents';
import type { ContractSource } from './DailyContracts';

export type AcceptMissionError = 'missionInProgress' | 'notOffered' | 'locked' | 'needsAnotherTruck';

/** What keeps the company from taking a contract on the board: its level, or a truck that cannot haul it. */
export type JobBlocker = 'companyLevel' | 'truck';

/** Where the company's level comes from (CompanyService). */
export interface CompanyLevelSource {
  readonly level: number;
}

/** A contract on the job board, with what the player needs to choose it. */
export interface JobOffer {
  readonly mission: MissionDefinition;
  readonly cargo: CargoDefinition;
  readonly originDepot: DepotDefinition;
  readonly destinationDepot: DepotDefinition;
  /** Pay before bonuses and penalties. */
  readonly basePay: Credits;
  /** From the pickup bay to the delivery bay, by road. */
  readonly distanceMeters: number;
  /** The company level that unlocks it (spec §14). */
  readonly requiredCompanyLevel: number;
  /** Trucks with the body and payload for it (spec §29 step 4). */
  readonly suitableVehicles: readonly VehicleDefinition[];
  /** A contract of the day, from the generator, rather than one of the game's own. */
  readonly daily: boolean;
  /**
   * Null when it can be taken now. Otherwise it is shown but cannot be taken:
   * the company's level is too low, or the truck being driven cannot haul it.
   */
  readonly blockedBy: JobBlocker | null;
}

/** The bay the truck must reach next. */
export interface MissionTarget {
  readonly kind: 'pickup' | 'delivery';
  readonly depot: DepotDefinition;
}

/**
 * Runs the mission loop (spec §9, §12, §50; roadmap steps 10-12): offers
 * contracts, and takes the accepted one from the pickup bay to the delivery
 * bay. The browser entry calls update() every fixed step while driving, after
 * DrivingService.step(). It never touches the UI: it publishes
 * MissionStateChanged, CargoDamaged, MissionCompleted and MissionFailed, and
 * the UI reads `active` and `target` (NavigationService routes to the target).
 */
export class MissionService {
  private mission: MissionInstance | null = null;
  private definition: MissionDefinition | null = null;
  /** The active contract was generated: the save keeps its definition. */
  private generated = false;
  private currentTarget: MissionTarget | null = null;
  /** The truck stands in the target bay: the brake holds it instead of engaging reverse. */
  private holdingInBay = false;
  /** Share of collision damage the truck's suspension keeps away from the cargo. */
  private cargoProtection: Fraction = 0;
  private readonly unsubscribeCollisions: Unsubscribe;

  constructor(
    private readonly content: ContentCatalog,
    private readonly driving: DrivingService,
    private readonly company: CompanyLevelSource,
    private readonly events: EventBus<GameEvents>,
    private readonly config: Pick<GameConfig['missions'], 'loadingSeconds'>,
    private readonly logger: Logger,
    /** The contracts of the day, besides the game's own; none without it. */
    private readonly daily: ContractSource | null = null,
  ) {
    this.unsubscribeCollisions = events.on('VehicleCollided', ({ impactSpeedMetersPerSecond }) =>
      this.damageCargo(impactSpeedMetersPerSecond),
    );
  }

  /** The accepted contract until it is completed or failed; then null again. */
  get active(): Readonly<MissionInstance> | null {
    return this.mission;
  }

  /** Definition of the active contract. */
  get activeDefinition(): MissionDefinition | null {
    return this.definition;
  }

  /** The bay to drive to: the pickup until the cargo is loaded, then the delivery. */
  get target(): MissionTarget | null {
    return this.currentTarget;
  }

  /** How far loading or unloading has got, 0..1: it runs while the truck stands in the target bay. */
  get handlingProgress(): number {
    return this.mission === null ? 0 : Math.min(1, this.mission.handlingSeconds / this.config.loadingSeconds);
  }

  /**
   * Every contract between two depots of this map (spec §28): the game's own,
   * then the contracts of the day from the generator. Each says what keeps
   * the company from taking it: its level, or the truck being driven lacking
   * the body or payload.
   */
  jobBoard(): readonly JobOffer[] {
    const offers: JobOffer[] = [];
    for (const mission of this.content.missions.all) {
      const offer = this.offerFor(mission, false);
      if (offer !== null) {
        offers.push(offer);
      }
    }
    for (const mission of this.daily?.current() ?? []) {
      const offer = this.offerFor(mission, true);
      if (offer !== null) {
        offers.push(offer);
      }
    }
    return offers;
  }

  /** Takes a contract from the job board. The mission starts at the next update(). */
  accept(missionId: string): Result<Readonly<MissionInstance>, AcceptMissionError> {
    if (this.mission !== null) {
      return err('missionInProgress');
    }
    const own = this.content.missions.find(missionId);
    const definition = own ?? this.daily?.current().find((contract) => contract.id === missionId);
    const offer = definition === undefined ? null : this.offerFor(definition, own === undefined);
    if (definition === undefined || offer === null) {
      return err('notOffered');
    }
    if (offer.blockedBy === 'companyLevel') {
      return err('locked');
    }
    if (offer.blockedBy === 'truck') {
      return err('needsAnotherTruck');
    }
    const mission = createMissionInstance(missionId);
    this.mission = mission;
    this.definition = definition;
    this.generated = offer.daily;
    this.updateTarget();
    this.logger.info(`Accepted ${missionId}.`);
    this.events.emit('MissionStateChanged', { missionId, previous: null, current: mission.state });
    return ok(mission);
  }

  /**
   * Resumes a contract from a saved game (null clears any). The truck must
   * already be on the map. Cargo that was aboard is loaded again.
   */
  restore(saved: ActiveMissionSaveData | null): void {
    this.holdingInBay = false; // A new drive: its truck allows reverse.
    this.mission = null;
    this.definition = null;
    this.generated = false;
    this.currentTarget = null;
    if (saved === null) {
      if (this.driving.isDriving) {
        this.driving.setCargoMass(0);
      }
      return;
    }
    const { contract, ...instance } = saved;
    const definition = contract ?? this.content.missions.get(saved.missionId);
    this.mission = { ...instance };
    this.definition = definition;
    this.generated = contract !== null;
    this.updateTarget();
    this.driving.setCargoMass(isCargoAboard(this.mission) ? definition.cargoWeightTons * 1000 : 0);
    this.logger.info(`Resumed ${saved.missionId} (${saved.state}).`);
  }

  /** The active contract as save data, or null. A generated contract comes along whole. */
  snapshot(): ActiveMissionSaveData | null {
    return this.mission === null ? null : { ...this.mission, contract: this.generated ? this.definition : null };
  }

  /** The active truck's suspension upgrade (GarageService): the share of collision damage kept from the cargo. */
  setCargoProtection(protection: Fraction): void {
    this.cargoProtection = Math.min(MAX_SAVING, Math.max(0, finiteOr(protection, 0)));
  }

  /** Gives up the active contract: it fails and the cargo is gone. Does nothing without one. */
  abandon(): void {
    if (this.mission !== null && this.definition !== null) {
      this.fail(this.mission, this.definition, 'abandoned');
    }
  }

  /** Advances the active mission by one fixed step. Allocation-free unless the mission changes stage. */
  update(dt: number): void {
    const mission = this.mission;
    const definition = this.definition;
    if (mission === null || definition === null || !this.driving.isDriving) {
      return;
    }
    switch (mission.state) {
      case 'accepted':
        this.changeState(mission, 'travellingToPickup');
        return;
      case 'travellingToPickup':
        if (this.standsInTargetBay(mission, dt)) {
          this.driving.setCargoMass(definition.cargoWeightTons * 1000);
          this.changeState(mission, 'loaded');
        }
        return;
      case 'loaded':
        mission.deliverySeconds += dt;
        if (Math.abs(this.driving.vehicle.speed) >= STOPPED_SPEED_METERS_PER_SECOND) {
          this.changeState(mission, 'delivering');
        }
        return;
      case 'delivering':
        mission.deliverySeconds += dt;
        if (this.standsInTargetBay(mission, dt)) {
          this.complete(mission, definition);
        }
        return;
      case 'completed':
      case 'failed':
        return;
    }
  }

  dispose(): void {
    this.unsubscribeCollisions();
    this.mission = null;
    this.definition = null;
    this.currentTarget = null;
  }

  private offerFor(mission: MissionDefinition, daily: boolean): JobOffer | null {
    if (!this.driving.isDriving) {
      return null;
    }
    const world = this.driving.world;
    const cargo = this.content.cargo.get(mission.cargoId);
    const originDepot = world.depotOf(mission.originCityId);
    const destinationDepot = world.depotOf(mission.destinationCityId);
    if (originDepot === undefined || destinationDepot === undefined) {
      return null;
    }
    const route = world.network.guide(
      originDepot.bay.x,
      originDepot.bay.z,
      destinationDepot.bay.x,
      destinationDepot.bay.z,
      createRouteGuidance(),
    );
    const requiredCompanyLevel = mission.requiredCompanyLevel ?? 1;
    let blockedBy: JobBlocker | null = null;
    if (this.company.level < requiredCompanyLevel) {
      blockedBy = 'companyLevel';
    } else if (!vehicleCanHaul(this.driving.definition, mission, cargo)) {
      blockedBy = 'truck';
    }
    return {
      mission,
      cargo,
      originDepot,
      destinationDepot,
      basePay: missionBasePay(mission.baseReward, cargo.rewardMultiplier),
      distanceMeters: route.distanceMeters,
      requiredCompanyLevel,
      suitableVehicles: this.content.vehicles.all.filter((vehicle) => vehicleCanHaul(vehicle, mission, cargo)),
      blockedBy,
      daily,
    };
  }

  /**
   * Counts up the loading time while the truck stands in the target bay; true
   * once it is done. Meanwhile holding the brake keeps the truck in the bay:
   * players stop by holding it, and brake-to-reverse would back them out.
   */
  private standsInTargetBay(mission: MissionInstance, dt: number): boolean {
    const target = this.currentTarget;
    const parked =
      target !== null && isParkedInBay(target.depot.bay, this.driving.vehicle, this.driving.definition.body);
    this.holdInBay(parked);
    if (!parked) {
      mission.handlingSeconds = 0;
      return false;
    }
    mission.handlingSeconds += dt;
    return mission.handlingSeconds >= this.config.loadingSeconds;
  }

  private holdInBay(hold: boolean): void {
    if (hold !== this.holdingInBay) {
      this.holdingInBay = hold;
      if (this.driving.isDriving) {
        this.driving.setReverseAllowed(!hold);
      }
    }
  }

  private damageCargo(impactSpeedMetersPerSecond: number): void {
    const mission = this.mission;
    const definition = this.definition;
    if (mission === null || definition === null || !isCargoAboard(mission)) {
      return;
    }
    const cargo = this.content.cargo.get(definition.cargoId);
    const addedDamage =
      cargoDamageFromImpact(impactSpeedMetersPerSecond, cargo.damageSensitivity) * (1 - this.cargoProtection);
    if (addedDamage <= 0) {
      return;
    }
    mission.cargoDamage = addCargoDamage(mission.cargoDamage, addedDamage);
    this.events.emit('CargoDamaged', { missionId: mission.missionId, addedDamage, cargoDamage: mission.cargoDamage });
    if (!isWithinTolerance(mission.cargoDamage, definition.damageTolerance)) {
      this.fail(mission, definition, 'cargoDamaged');
    }
  }

  private changeState(mission: MissionInstance, next: MissionState): void {
    const previous = mission.state;
    this.holdInBay(false);
    transitionMission(mission, next);
    this.updateTarget();
    this.logger.info(`${mission.missionId}: ${previous} -> ${next}`);
    this.events.emit('MissionStateChanged', { missionId: mission.missionId, previous, current: next });
  }

  private complete(mission: MissionInstance, definition: MissionDefinition): void {
    const cargo = this.content.cargo.get(definition.cargoId);
    const reward = calculateMissionReward({
      baseReward: definition.baseReward,
      cargoRewardMultiplier: cargo.rewardMultiplier,
      timeSensitivity: cargo.timeSensitivity,
      timeLimitSeconds: definition.timeLimitSeconds,
      deliverySeconds: mission.deliverySeconds,
      cargoDamage: mission.cargoDamage,
      damageTolerance: definition.damageTolerance,
    });
    const xp = deliveryXp(reward, definition.difficulty);
    const reputation = deliveryReputation(reward, mission.cargoDamage, definition.damageTolerance);
    const previous = mission.state;
    transitionMission(mission, 'completed');
    // Clear first, so handlers of both events already see no active mission and no target.
    this.clear();
    this.logger.info(`${mission.missionId}: ${previous} -> completed, paid ${reward.total}`);
    this.events.emit('MissionStateChanged', { missionId: mission.missionId, previous, current: 'completed' });
    this.events.emit('MissionCompleted', {
      missionId: mission.missionId,
      mission: definition,
      reward,
      deliverySeconds: mission.deliverySeconds,
      cargoDamage: mission.cargoDamage,
      xp,
      reputation,
    });
  }

  private fail(mission: MissionInstance, definition: MissionDefinition, reason: MissionFailureReason): void {
    const previous = mission.state;
    failMission(mission, reason);
    this.clear();
    this.logger.info(`${mission.missionId}: ${previous} -> failed (${reason})`);
    this.events.emit('MissionStateChanged', { missionId: mission.missionId, previous, current: 'failed' });
    this.events.emit('MissionFailed', {
      missionId: mission.missionId,
      mission: definition,
      reason,
      reputationLost: FAILURE_REPUTATION_LOSS[reason],
    });
  }

  /** Ends the active mission: no contract, no target, no cargo on the truck. */
  private clear(): void {
    this.holdInBay(false);
    this.mission = null;
    this.definition = null;
    this.generated = false;
    this.currentTarget = null;
    if (this.driving.isDriving) {
      this.driving.setCargoMass(0);
    }
  }

  private updateTarget(): void {
    const mission = this.mission;
    const definition = this.definition;
    if (mission === null || definition === null || isMissionFinished(mission) || !this.driving.isDriving) {
      this.currentTarget = null;
      return;
    }
    const kind = isCargoAboard(mission) ? 'delivery' : 'pickup';
    const depot = this.driving.world.depotOf(kind === 'delivery' ? definition.destinationCityId : definition.originCityId);
    if (depot === undefined) {
      throw new Error(`Mission ${mission.missionId} has no ${kind} depot on ${this.driving.world.id}.`);
    }
    if (this.currentTarget?.depot !== depot) {
      this.currentTarget = { kind, depot };
    }
  }
}
