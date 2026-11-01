import type { EventBus } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import type { ContentCatalog } from '../../data/ContentCatalog';
import type { TrailerBody, VehicleDefinition } from '../../data/definitions/VehicleDefinition';
import type { PerformanceFactors } from '../../domain/vehicles/performance';
import { footprintBuild, type BodyBuild } from '../../domain/vehicles/bodyMotion';
import {
  articulation,
  copyTrailerPose,
  createTrailerFootprint,
  createTrailerPose,
  followCoupling,
  straightenTrailer,
  type TrailerPose,
} from '../../domain/vehicles/semiTrailer';
import { VehicleDynamics } from '../../domain/vehicles/VehicleDynamics';
import { createVehicleFootprint, type VehicleFootprint } from '../../domain/vehicles/VehicleFootprint';
import type { VehicleInput } from '../../domain/vehicles/VehicleInput';
import type { VehicleRuntimeState } from '../../domain/vehicles/VehicleRuntimeState';
import { DrivingWorld, type CollisionBody, type MovingObstacles, type ServicePoint } from '../../domain/world/DrivingWorld';
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
 * How the truck's body stands (bodyMotion): the whole truck's roll and
 * pitch off its wheels and how high its centre of mass is above where it
 * rests on them, and the body's lean and pitch on its springs. All 0 for a
 * truck standing level.
 */
export interface BodyPose {
  bank: number;
  tilt: number;
  rise: number;
  lean: number;
  dip: number;
}

/** Where the truck is and how its body stands. */
export type TruckPose = VehiclePose & BodyPose;

/** A level truck at the origin, to write poses into. */
export function createTruckPose(): TruckPose {
  return { x: 0, z: 0, heading: 0, bank: 0, tilt: 0, rise: 0, lean: 0, dip: 0 };
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
 * The body's pose `alpha` of the way from `previous` to `current`, into
 * `out`, like interpolatePose. Its roll and pitch are taken round a turn at
 * a time as it lands (bodyMotion), so they go the short way. Allocation-free.
 */
export function interpolateBodyPose(
  out: BodyPose,
  previous: Readonly<BodyPose>,
  current: Readonly<BodyPose>,
  alpha: number,
): BodyPose {
  out.bank = previous.bank + shortWay(current.bank - previous.bank) * alpha;
  out.tilt = previous.tilt + shortWay(current.tilt - previous.tilt) * alpha;
  out.rise = previous.rise + (current.rise - previous.rise) * alpha;
  out.lean = previous.lean + (current.lean - previous.lean) * alpha;
  out.dip = previous.dip + (current.dip - previous.dip) * alpha;
  return out;
}

/** A turn of `radians` taken the short way round: −π…π. */
function shortWay(radians: number): number {
  return radians - 2 * Math.PI * Math.round(radians / (2 * Math.PI));
}

/** Copies where the truck is and how its body stands from `state` into `out`. */
function keepPose(out: TruckPose, state: Readonly<VehicleRuntimeState>): void {
  out.x = state.x;
  out.z = state.z;
  out.heading = state.heading;
  out.bank = state.bank;
  out.tilt = state.tilt;
  out.rise = state.rise;
  out.lean = state.lean;
  out.dip = state.dip;
}

/**
 * Impacts slower than this (m/s into the obstacle, about 5 km/h) are scrapes,
 * not collisions. While the truck is still touching what it hit, only an
 * impact this much harder than the previous step's counts, so one crash is
 * one event.
 */
export const COLLISION_EVENT_MIN_SPEED = 1.5;

/**
 * Going over is a blow this hard (m/s, about 40 km/h into a wall) besides
 * the slams of the fall: the truck and its load take it (DamageService,
 * MissionService, through VehicleCollided).
 */
export const OVERTURN_BLOW_SPEED = 11;

/** A tractor unit's semi-trailer while it is driven (semiTrailer.ts). */
interface Rig {
  readonly body: TrailerBody;
  readonly footprint: VehicleFootprint;
  /** Where it stands now, and before the last fixed step (rendering interpolates). */
  readonly pose: TrailerPose;
  readonly previousPose: TrailerPose;
  /** The trailer as a truck of its own, for the world's collisions: where it stands, moving as the coupling drags it. */
  readonly stand: VehicleRuntimeState;
  /** Its build for the blows, and the whole rig's mass. */
  readonly collision: CollisionBody;
  /** Whether it stood at its jackknife limit after the last step. */
  jackknifed: boolean;
}

interface DrivingSession {
  readonly definition: VehicleDefinition;
  readonly dynamics: VehicleDynamics;
  readonly footprint: VehicleFootprint;
  readonly world: DrivingWorld;
  readonly state: VehicleRuntimeState;
  readonly previousPose: TruckPose;
  /** Impact speed of the previous step, 0 when the truck was not driving into anything. */
  lastImpactSpeed: number;
  /**
   * Whether the truck has gone over and not yet come back onto its wheels
   * (bouncing and rocking in between): going over is one event.
   */
  over: boolean;
  cargoMassKg: number;
  /** The ground under the middle of the truck at the last step. */
  surface: Surface;
  /** The semi-trailer of a tractor unit; null for a rigid truck. */
  readonly rig: Rig | null;
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
  private drives = 0;
  private readonly modifiers = new Map<string, PerformanceModifier>();
  private engineRunning = true;
  /** Vehicles the truck can hit besides the world's static obstacles (TrafficService). */
  private obstacles: MovingObstacles | null = null;

  /**
   * @param knockOvers Whether what gives way (lamps, bins, benches, bus
   *   shelters, speed signs, hay bales) is knocked over by a truck driving
   *   into it hard enough, instead of stopping it (CrashService picks it up).
   */
  constructor(
    private readonly content: ContentCatalog,
    private readonly events: EventBus<GameEvents>,
    private readonly logger: Logger,
    private readonly knockOvers = false,
  ) {}

  get isDriving(): boolean {
    return this.session !== null;
  }

  /** The live truck state. Throws when nothing is being driven. */
  get vehicle(): Readonly<VehicleRuntimeState> {
    return this.requireSession().state;
  }

  /** Where the truck was and how its body stood before the last fixed step, so rendering can interpolate. */
  get previousPose(): Readonly<TruckPose> {
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

  /**
   * Where a tractor unit's semi-trailer stands (its axles' middle and the
   * way it faces: semiTrailer.ts) after the last fixed step; null for a
   * rigid truck or when nothing is driven.
   */
  get trailer(): Readonly<TrailerPose> | null {
    return this.session?.rig?.pose ?? null;
  }

  /** …and before it, so rendering can interpolate. */
  get previousTrailer(): Readonly<TrailerPose> | null {
    return this.session?.rig?.previousPose ?? null;
  }

  /** The semi-trailer's collision shape (along it from its axles' middle); null for a rigid truck. */
  get trailerFootprint(): VehicleFootprint | null {
    return this.session?.rig?.footprint ?? null;
  }

  /** Whether the semi-trailer stood at its jackknife limit after the last fixed step. */
  get jackknifed(): boolean {
    return this.session?.rig?.jackknifed ?? false;
  }

  /** Where the truck's weight sits and how it turns, with its cargo (bodyMotion): the views place its body by it. */
  get build(): Readonly<BodyBuild> {
    return this.requireSession().dynamics.build;
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

  /** Counts the drives start() began: a new number is a new drive, though the world may be the same. */
  get drive(): number {
    return this.drives;
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
    // On the same map (a company founded or continued from the main menu) the world already built is used again,
    // with what was knocked over stood back up: building it takes seconds on a phone, and the views drawn from it at
    // boot go on drawing the same one.
    const previous = this.session?.world;
    const world = previous !== undefined && previous.id === mapId ? previous : new DrivingWorld(this.content.maps.get(mapId));
    world.restoreAll();
    this.drives++;
    const dynamics = new VehicleDynamics(definition, cargoMassKg);
    const state = dynamics.createState(world.spawn.x, world.spawn.z, world.spawn.heading);
    const previousPose = createTruckPose();
    keepPose(previousPose, state);
    this.session = {
      definition,
      dynamics,
      footprint: createVehicleFootprint(definition.body),
      world,
      state,
      previousPose,
      lastImpactSpeed: 0,
      over: false,
      cargoMassKg: Math.max(0, cargoMassKg),
      surface: world.surfaceAt(state.x, state.z),
      rig: createRig(definition, dynamics, state),
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
    keepPose(session.previousPose, state);
    this.session = {
      ...session,
      definition,
      dynamics,
      footprint: createVehicleFootprint(definition.body),
      lastImpactSpeed: 0,
      over: false,
      rig: createRig(definition, dynamics, state),
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
    keepPose(session.previousPose, session.state);
    session.lastImpactSpeed = 0;
    session.over = false;
    const rig = session.rig;
    if (rig !== null) {
      // Coupled straight behind it.
      straightenTrailer(rig.pose, x, z, heading, rig.body);
      copyTrailerPose(rig.previousPose, rig.pose);
      rig.jackknifed = false;
    }
  }

  /**
   * Takes `speedLossMetersPerSecond` off the truck's speed, forwards or in
   * reverse, never past a standstill: the momentum it gave to what it
   * knocked out of its way (CrashService).
   */
  knockBack(speedLossMetersPerSecond: number): void {
    const { state } = this.requireSession();
    const loss = Math.max(0, speedLossMetersPerSecond);
    state.speed = state.speed > 0 ? Math.max(0, state.speed - loss) : Math.min(0, state.speed + loss);
  }

  /**
   * Gets a stuck or overturned truck going again: puts it at rest on its
   * wheels on the nearest road, in the right-hand lane for the way along
   * the road closest to its heading.
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

  /**
   * Advances the truck by one fixed step: it drives, its body moves, and it
   * strikes what it runs into. A blow, or its body slamming down on the
   * ground (its lifted wheels, its side, a landing), at least
   * COLLISION_EVENT_MIN_SPEED hard is a collision; going over is
   * TruckOverturned, and a blow of its own (OVERTURN_BLOW_SPEED).
   * Allocation-free unless it emits an event.
   */
  step(dt: number, input: Readonly<VehicleInput>): void {
    const session = this.session;
    if (session === null) {
      return;
    }
    const { state, previousPose, world, rig } = session;
    keepPose(previousPose, state);
    if (rig !== null) {
      copyTrailerPose(rig.previousPose, rig.pose);
    }

    // The ground under the middle of the truck decides grip and rolling resistance.
    const centreAhead = session.definition.body.wheelbaseMeters / 2;
    const surface = world.surfaceAt(
      state.x + Math.sin(state.heading) * centreAhead,
      state.z + Math.cos(state.heading) * centreAhead,
    );
    session.surface = surface;
    session.dynamics.step(state, input, surface, dt);

    let impact = world.resolveCollisions(state, session.footprint, this.obstacles, this.knockOvers, session.dynamics);
    if (rig !== null) {
      impact = Math.max(impact, this.stepTrailer(session, rig, dt));
    }
    if (impact >= COLLISION_EVENT_MIN_SPEED && impact >= session.lastImpactSpeed + COLLISION_EVENT_MIN_SPEED) {
      this.events.emit('VehicleCollided', { impactSpeedMetersPerSecond: impact });
    }
    session.lastImpactSpeed = impact;
    // The body slamming down is a blow too: each is a step's, so each counts once.
    if (state.groundImpact >= COLLISION_EVENT_MIN_SPEED) {
      this.events.emit('VehicleCollided', { impactSpeedMetersPerSecond: state.groundImpact });
    }
    if (session.over) {
      session.over = state.attitude !== 'wheels';
    } else if (state.attitude === 'overturned') {
      session.over = true;
      this.events.emit('TruckOverturned', { speedMetersPerSecond: Math.hypot(state.speed, state.slipSpeed) });
      this.events.emit('VehicleCollided', { impactSpeedMetersPerSecond: OVERTURN_BLOW_SPEED });
    }
  }

  dispose(): void {
    this.stop();
  }

  /**
   * The semi-trailer follows the tractor's coupling, then strikes what it
   * runs into as a truck of its own would: where it is pushed out of
   * something, the whole rig moves with it, and the change to its speed
   * along it slows the tractor as far as the two point the same way.
   * Returns the hardest impact. Allocation-free.
   */
  private stepTrailer(session: DrivingSession, rig: Rig, dt: number): number {
    const { state, world } = session;
    const { pose, stand } = rig;
    const headingBefore = pose.heading;
    rig.jackknifed = followCoupling(pose, state.x, state.z, state.heading, rig.body);
    const along = Math.cos(articulation(pose, state.heading));
    stand.x = pose.x;
    stand.z = pose.z;
    stand.heading = pose.heading;
    stand.speed = state.speed * along;
    stand.slipSpeed = 0;
    stand.pathCurvature = 0;
    stand.spinRate = dt > 0 ? (pose.heading - headingBefore) / dt : 0;
    const speedBefore = stand.speed;
    const impact = world.resolveCollisions(stand, rig.footprint, this.obstacles, this.knockOvers, rig.collision, true);
    const pushX = stand.x - pose.x;
    const pushZ = stand.z - pose.z;
    if (pushX !== 0 || pushZ !== 0) {
      state.x += pushX;
      state.z += pushZ;
      pose.x = stand.x;
      pose.z = stand.z;
    }
    state.speed += (stand.speed - speedBefore) * along;
    return impact;
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

/** A tractor unit's semi-trailer coupled straight behind it; null for a rigid truck. */
function createRig(definition: VehicleDefinition, dynamics: VehicleDynamics, state: Readonly<VehicleRuntimeState>): Rig | null {
  const body = definition.trailer;
  if (body === undefined) {
    return null;
  }
  const footprint = createTrailerFootprint(body, definition.body.widthMeters);
  const pose = createTrailerPose();
  straightenTrailer(pose, state.x, state.z, state.heading, body);
  const previousPose = createTrailerPose();
  copyTrailerPose(previousPose, pose);
  const build = footprintBuild(footprint.offsets, footprint.radius);
  return {
    body,
    footprint,
    pose,
    previousPose,
    stand: dynamics.createState(pose.x, pose.z, pose.heading),
    collision: {
      build,
      get totalMassKg() {
        return dynamics.totalMassKg;
      },
    },
    jackknifed: false,
  };
}
