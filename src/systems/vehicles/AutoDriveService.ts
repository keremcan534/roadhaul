import type { EventBus } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import { err, ok, type Result } from '../../core/Result';
import type { GameConfig } from '../../data/config/GameConfig';
import type { VehicleDefinition } from '../../data/definitions/VehicleDefinition';
import type { PerkSource } from '../../domain/company/facilities';
import { AMBER_LIGHT, RED_LIGHT, signalLight, type TrafficSignals } from '../../domain/traffic/trafficSignals';
import { AutoPilot, PILOT_DECELERATION, type PilotRoute } from '../../domain/vehicles/autoPilot';
import type { VehicleInput } from '../../domain/vehicles/VehicleInput';
import type { VehicleRuntimeState } from '../../domain/vehicles/VehicleRuntimeState';
import type { DrivingWorld } from '../../domain/world/DrivingWorld';
import type { GameEvents } from '../GameEvents';

/** What auto-drive reads of the drive (DrivingService). */
export interface AutoDriveDriving {
  readonly isDriving: boolean;
  readonly vehicle: Readonly<VehicleRuntimeState>;
  readonly definition: VehicleDefinition;
  readonly world: DrivingWorld;
  readonly parkingBrake: boolean;
  setParkingBrake(applied: boolean): void;
}

/** The way to drive (NavigationService). */
export interface AutoDriveNavigation {
  readonly hasRoute: boolean;
  readonly route: (PilotRoute & { readonly distanceMeters: number }) | null;
}

/** The traffic round the truck and its lights (TrafficService). */
export interface AutoDriveTraffic {
  readonly simulation: {
    readonly capacity: number;
    readonly active: Uint8Array;
    readonly x: Float64Array;
    readonly z: Float64Array;
    readonly heading: Float64Array;
    readonly speed: Float64Array;
  } | null;
  signalsOf(world: DrivingWorld): TrafficSignals | null;
  readonly signalSeconds: number | null;
}

/** The limits the road's events set (RoadEventService): road works, and a camera ahead. */
export interface AutoDriveRoadEvents {
  readonly workZoneLimitKmh: number;
  readonly cameraAheadLimitKmh: number;
  readonly cameraAheadMeters: number;
}

/** Why auto-drive does not take the wheel. */
export type AutoDriveRefusal = 'locked' | 'noRoute' | 'offRoad';
/** Why it gave the wheel back. */
export type AutoDriveEnd = 'arrived' | 'takeover' | 'lostRoute' | 'stuck' | 'switchedOff';

/** It stops this far short of where the route leaves the road for the yard, and hands over there, meters. */
const HANDOVER_METERS = 60;
/** It takes the wheel only this near the route's start: on the road, not in a yard. */
const ON_ROUTE_METERS = 7;
/** A firm touch of a control hands the wheel back. */
const TAKEOVER_INPUT = 0.3;
/** Wanting to move this fast (m/s) but standing still this long, seconds, it gives up. */
const STUCK_WANTED_SPEED = 2;
const STUCK_SECONDS = 8;
/** It keeps this share under the limits. */
const LIMIT_SHARE = 0.95;
/** It looks for what is ahead this far, meters, and this wide either side of its line (more further on). */
const LOOK_METERS = 70;
const LANE_HALF_WIDTH = 2.1;
const LANE_WIDENING = 0.04;
/** Half a vehicle in the traffic, meters (the gap is to its back). */
const VEHICLE_HALF_LENGTH = 2.8;
/** It stops for a light this far ahead or more; nearer, amber is taken. */
const AMBER_STOP_METERS = 18;

/**
 * Auto-drive (the owner's request; earned in research, never sold): with a
 * contract's route, the truck drives itself in the right-hand lane at the
 * limits (the road's, road works', a camera's ahead), slows for bends,
 * keeps behind the traffic ahead and stops for red lights (AutoPilot), and
 * stops short of the yard to hand the wheel back there ('arrived'). A firm
 * touch of the steering or a pedal takes the wheel back ('takeover'); losing
 * the route or standing stuck behind something unseen hands it back too.
 * The lever stays in drive, so a held brake never backs the truck up.
 * AutoDriveChanged says each change. Unlocked by the `autoDrive` perk, or
 * for testing.
 *
 * Call update() every fixed step on the road, with the driver's input, before
 * the truck steps. Allocation-free there.
 */
export class AutoDriveService {
  private engagedValue = false;
  private readonly pilot = new AutoPilot();
  private stuckSeconds = 0;
  /** What is ahead this step: meters to it and its speed. */
  private obstacleMeters = Number.POSITIVE_INFINITY;
  private obstacleSpeed = 0;
  /** The truck as the pilot reads it, kept in step. */
  private readonly truck = { x: 0, z: 0, heading: 0, speed: 0, wheelbaseMeters: 1, maxSteerAngle: 0.6, steerLateralLimit: 3 };
  private readonly limits = { speedLimit: 0, obstacleMeters: Number.POSITIVE_INFINITY, obstacleSpeed: 0, stopAlongMeters: 0 };

  constructor(
    private readonly driving: AutoDriveDriving,
    private readonly navigation: AutoDriveNavigation,
    private readonly traffic: AutoDriveTraffic,
    private readonly roadEvents: AutoDriveRoadEvents,
    private readonly perks: PerkSource,
    private readonly speedLimitsKmh: GameConfig['traffic']['speedLimitsKmh'],
    /** Unlocked whatever the research (`?autodrive=1`, for testing). */
    private readonly unlockedForTesting: boolean,
    private readonly events: EventBus<GameEvents>,
    private readonly logger: Logger,
  ) {}

  /** The company has it: researched (or unlocked for testing). */
  get available(): boolean {
    return this.unlockedForTesting || this.perks.perks.autoDrive > 0;
  }

  /** It has the wheel. */
  get engaged(): boolean {
    return this.engagedValue;
  }

  /** Whether it could take the wheel now: available, with a route, the truck on it. */
  canEngage(): Result<void, AutoDriveRefusal> {
    if (!this.available) {
      return err('locked');
    }
    const route = this.navigation.route;
    if (!this.driving.isDriving || !this.navigation.hasRoute || route === null || route.count < 2) {
      return err('noRoute');
    }
    const truck = this.driving.vehicle;
    const dx = route.x[0]! - truck.x;
    const dz = route.z[0]! - truck.z;
    if (dx * dx + dz * dz > ON_ROUTE_METERS * ON_ROUTE_METERS || this.alongLeft(route) < HANDOVER_METERS + 20) {
      return err('offRoad');
    }
    return ok(undefined);
  }

  /** Takes the wheel (the parking brake let off), or says why not. */
  engage(): Result<void, AutoDriveRefusal> {
    if (this.engagedValue) {
      return ok(undefined);
    }
    const can = this.canEngage();
    if (!can.ok) {
      return can;
    }
    this.engagedValue = true;
    this.stuckSeconds = 0;
    if (this.driving.parkingBrake) {
      this.driving.setParkingBrake(false);
    }
    this.logger.info('Auto-drive on.');
    this.events.emit('AutoDriveChanged', { engaged: true, reason: null });
    return ok(undefined);
  }

  /** Gives the wheel back. */
  disengage(reason: AutoDriveEnd): void {
    if (!this.engagedValue) {
      return;
    }
    this.engagedValue = false;
    this.logger.info(`Auto-drive off (${reason}).`);
    this.events.emit('AutoDriveChanged', { engaged: false, reason });
  }

  /**
   * One fixed step: while it has the wheel, writes `input` (the driver's, a
   * firm touch of which takes the wheel back first).
   */
  update(stepSeconds: number, input: VehicleInput): void {
    if (!this.engagedValue) {
      return;
    }
    if (!this.driving.isDriving) {
      this.disengage('lostRoute');
      return;
    }
    if (Math.abs(input.steer) > TAKEOVER_INPUT || input.throttle > TAKEOVER_INPUT || input.brake > TAKEOVER_INPUT) {
      this.disengage('takeover');
      return;
    }
    const route = this.navigation.route;
    if (!this.navigation.hasRoute || route === null || route.count < 2) {
      this.disengage('lostRoute');
      return;
    }
    const vehicle = this.driving.vehicle;
    const definition = this.driving.definition;
    const truck = this.truck;
    truck.x = vehicle.x;
    truck.z = vehicle.z;
    truck.heading = vehicle.heading;
    truck.speed = vehicle.speed;
    truck.wheelbaseMeters = definition.body.wheelbaseMeters;
    truck.maxSteerAngle = (definition.handling.maxSteerAngleDegrees * Math.PI) / 180;
    truck.steerLateralLimit = definition.handling.maxLateralAccelerationG * 9.81;
    this.lookAhead(vehicle, definition);
    const limits = this.limits;
    limits.speedLimit = this.speedLimit(route, definition);
    limits.obstacleMeters = this.obstacleMeters;
    limits.obstacleSpeed = this.obstacleSpeed;
    limits.stopAlongMeters = route.along[route.count - 1]! - HANDOVER_METERS;
    const wanted = this.pilot.input(route, this.driving.world.roads, truck, limits, input);

    // Standing still where it stops for the yard: the wheel is the driver's again.
    if (Math.abs(vehicle.speed) < 0.3 && this.alongLeft(route) < HANDOVER_METERS + 12) {
      this.disengage('arrived');
      return;
    }
    this.stuckSeconds = wanted > STUCK_WANTED_SPEED && Math.abs(vehicle.speed) < 0.5 ? this.stuckSeconds + stepSeconds : 0;
    if (this.stuckSeconds > STUCK_SECONDS) {
      this.disengage('stuck');
    }
  }

  /** The road's limit where the truck is (its own top speed if lower), road works' inside them, and a camera's ahead in time. */
  private speedLimit(route: PilotRoute, definition: VehicleDefinition): number {
    const road = this.driving.world.roads[route.road[0]!];
    let limitKmh = Math.min(definition.maxSpeedKmh, road === undefined ? 50 : this.speedLimitsKmh[road.kind]);
    const works = this.roadEvents.workZoneLimitKmh;
    if (works > 0) {
      limitKmh = Math.min(limitKmh, works);
    }
    let limit = (limitKmh / 3.6) * LIMIT_SHARE;
    const cameraKmh = this.roadEvents.cameraAheadLimitKmh;
    if (cameraKmh > 0 && this.roadEvents.cameraAheadMeters >= 0) {
      const there = (cameraKmh / 3.6) * LIMIT_SHARE;
      limit = Math.min(limit, Math.sqrt(there * there + 2 * PILOT_DECELERATION * this.roadEvents.cameraAheadMeters));
    }
    return limit;
  }

  /** The nearest thing to stop behind ahead in the truck's lane: a vehicle (its back, its speed along the lane) or a red light's line. */
  private lookAhead(vehicle: Readonly<VehicleRuntimeState>, definition: VehicleDefinition): void {
    const { wheelbaseMeters, lengthMeters } = definition.body;
    // From the rear axle to the bumper.
    const front = wheelbaseMeters + (lengthMeters - wheelbaseMeters) / 2;
    const forwardX = Math.sin(vehicle.heading);
    const forwardZ = Math.cos(vehicle.heading);
    let nearest = Number.POSITIVE_INFINITY;
    let speed = 0;
    const traffic = this.traffic.simulation;
    if (traffic !== null) {
      for (let i = 0; i < traffic.capacity; i++) {
        if (traffic.active[i] === 0) {
          continue;
        }
        const dx = traffic.x[i]! - vehicle.x;
        const dz = traffic.z[i]! - vehicle.z;
        const ahead = dx * forwardX + dz * forwardZ;
        if (ahead < front || ahead > LOOK_METERS) {
          continue;
        }
        const side = dx * -forwardZ + dz * forwardX;
        if (Math.abs(side) > LANE_HALF_WIDTH + ahead * LANE_WIDENING) {
          continue;
        }
        const gap = ahead - front - VEHICLE_HALF_LENGTH;
        if (gap < nearest) {
          nearest = gap;
          speed = traffic.speed[i]! * Math.cos(traffic.heading[i]! - vehicle.heading);
        }
      }
    }
    const signals = this.traffic.signalsOf(this.driving.world);
    const seconds = this.traffic.signalSeconds;
    if (signals !== null && seconds !== null) {
      for (const line of signals.stopLines) {
        if (line.dirX * forwardX + line.dirZ * forwardZ < 0.7) {
          continue; // Another approach's.
        }
        const dx = line.x - vehicle.x;
        const dz = line.z - vehicle.z;
        const ahead = dx * forwardX + dz * forwardZ - front;
        if (ahead < 0 || ahead > LOOK_METERS || Math.abs(dx * -forwardZ + dz * forwardX) > line.halfWidth + 1.5) {
          continue;
        }
        const light = signalLight(seconds, line.group);
        if ((light === RED_LIGHT || (light === AMBER_LIGHT && ahead > AMBER_STOP_METERS)) && ahead < nearest) {
          nearest = ahead;
          speed = 0;
        }
      }
    }
    this.obstacleMeters = nearest;
    this.obstacleSpeed = Math.max(0, speed);
  }

  /** Meters along the route from the truck to where it leaves the road for the yard. */
  private alongLeft(route: PilotRoute): number {
    return route.along[route.count - 1]! - route.along[0]!;
  }
}
