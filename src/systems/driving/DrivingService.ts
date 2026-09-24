import type { EventBus } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import type { ContentCatalog } from '../../data/ContentCatalog';
import type { VehicleDefinition } from '../../data/definitions/VehicleDefinition';
import type { PerformanceFactors } from '../../domain/vehicles/performance';
import { VehicleDynamics } from '../../domain/vehicles/VehicleDynamics';
import { createVehicleFootprint, type VehicleFootprint } from '../../domain/vehicles/VehicleFootprint';
import type { VehicleInput } from '../../domain/vehicles/VehicleInput';
import type { VehicleRuntimeState } from '../../domain/vehicles/VehicleRuntimeState';
import { DrivingWorld, type MovingObstacles, type ServicePoint } from '../../domain/world/DrivingWorld';
import { laneOffsetMeters } from '../../domain/world/lanes';
import type { Surface } from '../../domain/world/Surface';
import type { GameEvents } from '../GameEvents';

/** Rear-axle position and heading. */
export interface VehiclePose {
  x: number;
  z: number;
  heading: number;
}

/**
 * Writes the pose `alpha` (0..1) of the way from `previous` to `current` into
 * `out`. Rendering uses it between fixed steps. Headings are never wrapped,
 * so interpolating them linearly is safe. Allocation-free.
 */
export function interpolatePose(
  out: VehiclePose,
  previous: Readonly<VehiclePose>,
  current: Readonly<VehiclePose>,
  alpha: number,
): VehiclePose {
  out.x = previous.x + (current.x - previous.x) * alpha;
  out.z = previous.z + (current.z - previous.z) * alpha;
  out.heading = previous.heading + (current.heading - previous.heading) * alpha;
  return out;
}

/**
 * Impacts slower than this (m/s into the obstacle, about 5 km/h) are scrapes,
 * not collisions. While the truck is still touching what it hit, only an
 * impact this much harder than the previous step's counts, so one crash is
 * one event.
 */
export const COLLISION_EVENT_MIN_SPEED = 1.5;

interface DrivingSession {
  readonly definition: VehicleDefinition;
  readonly dynamics: VehicleDynamics;
  readonly footprint: VehicleFootprint;
  readonly world: DrivingWorld;
  readonly state: VehicleRuntimeState;
  readonly previousPose: VehiclePose;
  /** Impact speed of the previous step, 0 when the truck was not driving into anything. */
  lastImpactSpeed: number;
  cargoMassKg: number;
  /** The ground under the middle of the truck at the last step. */
  surface: Surface;
}

/** Engine, brake, tyre and body strength from one source (damage, upgrades): the service multiplies all sources. */
export type PerformanceModifier = PerformanceFactors;

/**
 * Owns the truck being driven and the world it drives in (roadmap steps 05
 * and 08). The browser entry calls step() every fixed step with the driver's
 * input; presentation reads `vehicle`, `previousPose` and `world` and never
 * writes to them.
 */
export class DrivingService {
  private session: DrivingSession | null = null;
  private readonly modifiers = new Map<string, PerformanceModifier>();
  private engineRunning = true;
  /** Vehicles the truck can hit besides the world's static obstacles (TrafficService). */
  private obstacles: MovingObstacles | null = null;

  constructor(
    private readonly content: ContentCatalog,
    private readonly events: EventBus<GameEvents>,
    private readonly logger: Logger,
  ) {}

  get isDriving(): boolean {
    return this.session !== null;
  }

  /** The live truck state. Throws when nothing is being driven. */
  get vehicle(): Readonly<VehicleRuntimeState> {
    return this.requireSession().state;
  }

  /** Where the truck was before the last fixed step, so rendering can interpolate. */
  get previousPose(): Readonly<VehiclePose> {
    return this.requireSession().previousPose;
  }

  get world(): DrivingWorld {
    return this.requireSession().world;
  }

  get definition(): VehicleDefinition {
    return this.requireSession().definition;
  }

  /** The truck's collision shape. */
  get footprint(): VehicleFootprint {
    return this.requireSession().footprint;
  }

  /** Cargo on board, kg. */
  get cargoMassKg(): number {
    return this.requireSession().cargoMassKg;
  }

  /** The ground under the middle of the truck at the last fixed step. */
  get surface(): Surface {
    return this.requireSession().surface;
  }

  /**
   * The depot yard or rest area lot the middle of the truck stands in, where
   * it can refuel at pump prices and be repaired; null elsewhere or when
   * nothing is driven. Allocation-free.
   */
  get servicePoint(): ServicePoint | null {
    const session = this.session;
    if (session === null) {
      return null;
    }
    const { state } = session;
    const centreAhead = session.definition.body.wheelbaseMeters / 2;
    return session.world.servicePointAt(
      state.x + Math.sin(state.heading) * centreAhead,
      state.z + Math.cos(state.heading) * centreAhead,
    );
  }

  get isEngineRunning(): boolean {
    return this.engineRunning;
  }

  /** Truck plus cargo, kg. */
  get totalMassKg(): number {
    return this.requireSession().dynamics.totalMassKg;
  }

  /** Puts `vehicleId` at the spawn point of `mapId`. Replaces any current session. */
  start(vehicleId: string, mapId: string, cargoMassKg = 0): void {
    const definition = this.content.vehicles.get(vehicleId);
    const world = new DrivingWorld(this.content.maps.get(mapId));
    const dynamics = new VehicleDynamics(definition, cargoMassKg);
    const state = dynamics.createState(world.spawn.x, world.spawn.z, world.spawn.heading);
    this.session = {
      definition,
      dynamics,
      footprint: createVehicleFootprint(definition.body),
      world,
      state,
      previousPose: { x: state.x, z: state.z, heading: state.heading },
      lastImpactSpeed: 0,
      cargoMassKg: Math.max(0, cargoMassKg),
      surface: world.surfaceAt(state.x, state.z),
    };
    this.applyPerformance();
    this.logger.info(`Driving ${vehicleId} on ${mapId}: ${world.trees.length} trees, ${world.buildings.length} buildings.`);
  }

  /**
   * Swaps the truck being driven for `vehicleId`, standing where the old one
   * stood (GarageService). The world, pose, cargo and odometer stay; the new
   * truck starts at rest. Performance modifiers apply to it too.
   */
  switchVehicle(vehicleId: string): void {
    const session = this.requireSession();
    const definition = this.content.vehicles.get(vehicleId);
    const dynamics = new VehicleDynamics(definition, session.cargoMassKg);
    const { state } = session;
    Object.assign(state, dynamics.createState(state.x, state.z, state.heading), {
      odometerMeters: state.odometerMeters,
    });
    session.previousPose.x = state.x;
    session.previousPose.z = state.z;
    session.previousPose.heading = state.heading;
    this.session = {
      ...session,
      definition,
      dynamics,
      footprint: createVehicleFootprint(definition.body),
      lastImpactSpeed: 0,
    };
    this.applyPerformance();
    this.logger.info(`Switched to ${vehicleId}.`);
  }

  stop(): void {
    this.session = null;
  }

  /** Loading and unloading change how the truck accelerates, brakes and corners. */
  setCargoMass(cargoMassKg: number): void {
    const session = this.requireSession();
    session.cargoMassKg = Math.max(0, cargoMassKg);
    session.dynamics.setCargoMass(session.cargoMassKg);
  }

  /**
   * Sets the engine, brake, tyre and body strength that `source` (e.g.
   * "damage", "upgrades") imposes; all sources multiply. It carries over to
   * later drives and other trucks.
   */
  setPerformanceModifier(source: string, modifier: PerformanceModifier): void {
    this.modifiers.set(source, modifier);
    this.applyPerformance();
  }

  /** While false, the brake holds a stopped truck instead of engaging reverse (MissionService: loading). */
  setReverseAllowed(allowed: boolean): void {
    this.requireSession().dynamics.setReverseAllowed(allowed);
  }

  /** Moving things the truck collides with from now on, in every drive (traffic); null for none. */
  setMovingObstacles(obstacles: MovingObstacles | null): void {
    this.obstacles = obstacles;
  }

  /** Stalls or restarts the engine (FuelService: an empty tank). It carries over to later drives. */
  setEngineRunning(running: boolean): void {
    this.engineRunning = running;
    this.session?.dynamics.setEngineRunning(running);
  }

  /** Puts the truck at rest with its rear axle at (x, z), facing `heading` (radians). */
  placeTruck(x: number, z: number, heading: number): void {
    const session = this.requireSession();
    const odometerMeters = session.state.odometerMeters;
    Object.assign(session.state, session.dynamics.createState(x, z, heading), { odometerMeters });
    session.previousPose.x = x;
    session.previousPose.z = z;
    session.previousPose.heading = heading;
    session.lastImpactSpeed = 0;
  }

  /**
   * Gets a stuck truck going again: puts it at rest on the nearest road, in
   * the right-hand lane for the way along the road closest to its heading.
   */
  recover(): void {
    const { state, world } = this.requireSession();
    let road = world.roads[0]!;
    for (const candidate of world.roads) {
      if (candidate.distanceTo(state.x, state.z) < road.distanceTo(state.x, state.z)) {
        road = candidate;
      }
    }
    const index = road.nearestSampleIndex(state.x, state.z);
    const next = road.stepIndex(index, 1);
    const previous = road.stepIndex(index, -1);
    const along = Math.atan2(road.x(next) - road.x(previous), road.z(next) - road.z(previous));
    // Keep the heading unwrapped (interpolation relies on it), turning by at most a quarter turn.
    let turn = along - state.heading;
    turn -= Math.round(turn / (2 * Math.PI)) * 2 * Math.PI;
    if (Math.abs(turn) > Math.PI / 2) {
      turn -= Math.sign(turn) * Math.PI;
    }
    const heading = state.heading + turn;
    const lane = laneOffsetMeters(road.kind, road.widthMeters, 0);
    this.placeTruck(road.x(index) - Math.cos(heading) * lane, road.z(index) + Math.sin(heading) * lane, heading);
    this.logger.info(`Recovered the truck onto ${road.id}.`);
  }

  /** Advances the truck by one fixed step. Allocation-free unless it emits a collision event. */
  step(dt: number, input: Readonly<VehicleInput>): void {
    const session = this.session;
    if (session === null) {
      return;
    }
    const { state, previousPose, world } = session;
    previousPose.x = state.x;
    previousPose.z = state.z;
    previousPose.heading = state.heading;

    // The ground under the middle of the truck decides grip and rolling resistance.
    const centreAhead = session.definition.body.wheelbaseMeters / 2;
    const surface = world.surfaceAt(
      state.x + Math.sin(state.heading) * centreAhead,
      state.z + Math.cos(state.heading) * centreAhead,
    );
    session.surface = surface;
    session.dynamics.step(state, input, surface, dt);

    const impact = world.resolveCollisions(state, session.footprint, this.obstacles);
    if (impact >= COLLISION_EVENT_MIN_SPEED && impact >= session.lastImpactSpeed + COLLISION_EVENT_MIN_SPEED) {
      this.events.emit('VehicleCollided', { impactSpeedMetersPerSecond: impact });
    }
    session.lastImpactSpeed = impact;
  }

  dispose(): void {
    this.stop();
  }

  private applyPerformance(): void {
    const session = this.session;
    if (session === null) {
      return;
    }
    let torqueFactor = 1;
    let brakeFactor = 1;
    let gripFactor = 1;
    let stabilityFactor = 1;
    for (const modifier of this.modifiers.values()) {
      torqueFactor *= modifier.torqueFactor;
      brakeFactor *= modifier.brakeFactor;
      gripFactor *= modifier.gripFactor;
      stabilityFactor *= modifier.stabilityFactor;
    }
    session.dynamics.setPerformance({ torqueFactor, brakeFactor, gripFactor, stabilityFactor });
    session.dynamics.setEngineRunning(this.engineRunning);
  }

  private requireSession(): DrivingSession {
    if (this.session === null) {
      throw new Error('No truck is being driven.');
    }
    return this.session;
  }
}
