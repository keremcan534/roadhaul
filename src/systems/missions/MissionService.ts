import type { EventBus, Unsubscribe } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import { err, ok, type Result } from '../../core/Result';
import type { GameConfig } from '../../data/config/GameConfig';
import type { ContentCatalog } from '../../data/ContentCatalog';
import type { CargoDefinition } from '../../data/definitions/CargoDefinition';
import type { DepotDefinition } from '../../data/definitions/MapDefinition';
import { vehicleCanHaul, type MissionDefinition } from '../../data/definitions/MissionDefinition';
import type { Credits } from '../../data/units';
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
import { calculateMissionReward, missionBasePay } from '../../domain/missions/missionReward';
import { createRouteGuidance, routeAlongRoads, type RouteGuidance } from '../../domain/world/roadRoute';
import type { DrivingService } from '../driving/DrivingService';
import type { GameEvents } from '../GameEvents';

export type AcceptMissionError = 'missionInProgress' | 'notOffered';

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
 * the UI reads `active`, `target` and guide().
 */
export class MissionService {
  private mission: MissionInstance | null = null;
  private definition: MissionDefinition | null = null;
  private currentTarget: MissionTarget | null = null;
  private readonly unsubscribeCollisions: Unsubscribe;

  constructor(
    private readonly content: ContentCatalog,
    private readonly driving: DrivingService,
    private readonly events: EventBus<GameEvents>,
    private readonly config: GameConfig['missions'],
    private readonly logger: Logger,
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
   * Contracts the truck being driven can take on this map (spec §28): the
   * right body and payload, with both depots on the map. Hand-authored for
   * now; the mission generator comes later.
   */
  jobBoard(): readonly JobOffer[] {
    const offers: JobOffer[] = [];
    for (const mission of this.content.missions.all) {
      const offer = this.offerFor(mission);
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
    const definition = this.content.missions.find(missionId);
    if (definition === undefined || this.offerFor(definition) === null) {
      return err('notOffered');
    }
    const mission = createMissionInstance(missionId);
    this.mission = mission;
    this.definition = definition;
    this.updateTarget();
    this.logger.info(`Accepted ${missionId}.`);
    this.events.emit('MissionStateChanged', { missionId, previous: null, current: mission.state });
    return ok(mission);
  }

  /** Gives up the active contract: it fails and the cargo is gone. Does nothing without one. */
  abandon(): void {
    if (this.mission !== null) {
      this.fail(this.mission, 'abandoned');
    }
  }

  /**
   * Writes the route from the truck to the target bay into `out` and returns
   * true, or returns false without a target. Allocation-free.
   */
  guide(out: RouteGuidance): boolean {
    const target = this.currentTarget;
    if (target === null || !this.driving.isDriving) {
      return false;
    }
    const truck = this.driving.vehicle;
    routeAlongRoads(this.driving.world.roads, truck.x, truck.z, target.depot.bay.x, target.depot.bay.z, out);
    return true;
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

  private offerFor(mission: MissionDefinition): JobOffer | null {
    if (!this.driving.isDriving) {
      return null;
    }
    const world = this.driving.world;
    const cargo = this.content.cargo.get(mission.cargoId);
    const originDepot = world.depotOf(mission.originCityId);
    const destinationDepot = world.depotOf(mission.destinationCityId);
    if (
      originDepot === undefined ||
      destinationDepot === undefined ||
      !vehicleCanHaul(this.driving.definition, mission, cargo)
    ) {
      return null;
    }
    const route = routeAlongRoads(
      world.roads,
      originDepot.bay.x,
      originDepot.bay.z,
      destinationDepot.bay.x,
      destinationDepot.bay.z,
      createRouteGuidance(),
    );
    return {
      mission,
      cargo,
      originDepot,
      destinationDepot,
      basePay: missionBasePay(mission.baseReward, cargo.rewardMultiplier),
      distanceMeters: route.distanceMeters,
    };
  }

  /** Counts up the loading time while the truck stands in the target bay; true once it is done. */
  private standsInTargetBay(mission: MissionInstance, dt: number): boolean {
    const target = this.currentTarget;
    if (target === null || !isParkedInBay(target.depot.bay, this.driving.vehicle, this.driving.definition.body)) {
      mission.handlingSeconds = 0;
      return false;
    }
    mission.handlingSeconds += dt;
    return mission.handlingSeconds >= this.config.loadingSeconds;
  }

  private damageCargo(impactSpeedMetersPerSecond: number): void {
    const mission = this.mission;
    const definition = this.definition;
    if (mission === null || definition === null || !isCargoAboard(mission)) {
      return;
    }
    const cargo = this.content.cargo.get(definition.cargoId);
    const addedDamage = cargoDamageFromImpact(impactSpeedMetersPerSecond, cargo.damageSensitivity);
    if (addedDamage <= 0) {
      return;
    }
    mission.cargoDamage = addCargoDamage(mission.cargoDamage, addedDamage);
    this.events.emit('CargoDamaged', { missionId: mission.missionId, addedDamage, cargoDamage: mission.cargoDamage });
    if (!isWithinTolerance(mission.cargoDamage, definition.damageTolerance)) {
      this.fail(mission, 'cargoDamaged');
    }
  }

  private changeState(mission: MissionInstance, next: MissionState): void {
    const previous = mission.state;
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
    const previous = mission.state;
    transitionMission(mission, 'completed');
    // Clear first, so handlers of both events already see no active mission and no target.
    this.clear();
    this.logger.info(`${mission.missionId}: ${previous} -> completed, paid ${reward.total}`);
    this.events.emit('MissionStateChanged', { missionId: mission.missionId, previous, current: 'completed' });
    this.events.emit('MissionCompleted', {
      missionId: mission.missionId,
      reward,
      deliverySeconds: mission.deliverySeconds,
      cargoDamage: mission.cargoDamage,
    });
  }

  private fail(mission: MissionInstance, reason: MissionFailureReason): void {
    const previous = mission.state;
    failMission(mission, reason);
    this.clear();
    this.logger.info(`${mission.missionId}: ${previous} -> failed (${reason})`);
    this.events.emit('MissionStateChanged', { missionId: mission.missionId, previous, current: 'failed' });
    this.events.emit('MissionFailed', { missionId: mission.missionId, reason });
  }

  /** Ends the active mission: no contract, no target, no cargo on the truck. */
  private clear(): void {
    this.mission = null;
    this.definition = null;
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
