import type { EventBus } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import type { ContentCatalog } from '../../data/ContentCatalog';
import type { VehicleDefinition } from '../../data/definitions/VehicleDefinition';
import { VehicleDynamics } from '../../domain/vehicles/VehicleDynamics';
import { createVehicleFootprint, type VehicleFootprint } from '../../domain/vehicles/VehicleFootprint';
import type { VehicleInput } from '../../domain/vehicles/VehicleInput';
import type { VehicleRuntimeState } from '../../domain/vehicles/VehicleRuntimeState';
import { DrivingWorld } from '../../domain/world/DrivingWorld';
import type { GameEvents } from '../GameEvents';

/** Rear-axle position and heading. */
export interface VehiclePose {
  x: number;
  z: number;
  heading: number;
}

/** Impacts slower than this (m/s, about 5 km/h) are scrapes, not collisions. */
export const COLLISION_EVENT_MIN_SPEED = 1.5;

interface DrivingSession {
  readonly definition: VehicleDefinition;
  readonly dynamics: VehicleDynamics;
  readonly footprint: VehicleFootprint;
  readonly world: DrivingWorld;
  readonly state: VehicleRuntimeState;
  readonly previousPose: VehiclePose;
}

/**
 * Owns the truck being driven and the world it drives in (roadmap steps 05
 * and 08). The browser entry calls step() every fixed step with the driver's
 * input; presentation reads `vehicle`, `previousPose` and `world` and never
 * writes to them.
 */
export class DrivingService {
  private session: DrivingSession | null = null;

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
    };
    this.logger.info(`Driving ${vehicleId} on ${mapId}: ${world.trees.length} trees, ${world.buildings.length} buildings.`);
  }

  stop(): void {
    this.session = null;
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
    session.dynamics.step(state, input, surface, dt);

    const impact = world.resolveCollisions(state, session.footprint);
    if (impact >= COLLISION_EVENT_MIN_SPEED) {
      this.events.emit('VehicleCollided', { impactSpeedMetersPerSecond: impact });
    }
  }

  dispose(): void {
    this.stop();
  }

  private requireSession(): DrivingSession {
    if (this.session === null) {
      throw new Error('No truck is being driven.');
    }
    return this.session;
  }
}
