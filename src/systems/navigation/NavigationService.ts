import type { Logger } from '../../core/logging/Logger';
import type { GameConfig } from '../../data/config/GameConfig';
import { createManoeuvre, nextManoeuvre, type Manoeuvre } from '../../domain/navigation/manoeuvre';
import { createRouteTrace, type RoadNetwork, type RouteTrace } from '../../domain/world/RoadNetwork';
import { ROUTE_LOOK_AHEAD_METERS } from '../../domain/world/roadRoute';
import type { DrivingService } from '../driving/DrivingService';
import type { MissionService } from '../missions/MissionService';

/** The route is worked out again this often, s: plenty for a HUD and a line on the road. */
const UPDATE_INTERVAL_SECONDS = 0.1;
/** Closer to its road than this, the truck counts as on it (it may be asked to turn round). */
const ON_ROAD_METERS = 8;

/**
 * GPS (spec §62–63): the route by road from the truck to the contract's next
 * bay, what to do next along it (turn left or right, turn round, arrive),
 * the distance and the arrival time, and a point ahead on the route for the
 * direction arrow. The HUD and the line on the road read it; nothing here
 * changes the game. Call update() every fixed step; it recomputes ten times
 * a second, without allocating once a drive's route has been traced.
 */
export class NavigationService {
  readonly manoeuvre: Manoeuvre = createManoeuvre();
  private trace: RouteTrace | null = null;
  private network: RoadNetwork | null = null;
  private paces = new Float64Array(0);
  private sinceUpdate = UPDATE_INTERVAL_SECONDS;
  private routed = false;
  private aimXValue = 0;
  private aimZValue = 0;
  private revisionValue = 0;

  constructor(
    private readonly driving: DrivingService,
    private readonly missions: MissionService,
    private readonly speedLimitsKmh: GameConfig['traffic']['speedLimitsKmh'],
    private readonly config: GameConfig['navigation'],
    private readonly logger: Logger,
  ) {}

  /** True while there is somewhere to go: a contract's next bay. */
  get hasRoute(): boolean {
    return this.routed;
  }

  /** The route's samples from the truck to the bay; read only, and only while hasRoute. */
  get route(): Readonly<RouteTrace> | null {
    return this.routed ? this.trace : null;
  }

  /** The whole way left, meters. */
  get distanceMeters(): number {
    return this.routed ? this.trace!.distanceMeters : 0;
  }

  /** Estimated seconds to arrive (ETA). */
  get etaSeconds(): number {
    return this.routed ? this.trace!.seconds : 0;
  }

  /** A point to point the direction arrow at: ahead along the route, or the bay itself when it is near. */
  get aimX(): number {
    return this.aimXValue;
  }

  get aimZ(): number {
    return this.aimZValue;
  }

  /** Goes up every time the route is worked out again, so views redraw only then. */
  get revision(): number {
    return this.revisionValue;
  }

  /** Follows the truck and the contract. Cheap to call every fixed step. */
  update(dt: number): void {
    this.sinceUpdate += dt;
    // Six 60 Hz steps add up to a hair under 0.1 s in floating point.
    if (this.sinceUpdate < UPDATE_INTERVAL_SECONDS - 1e-9) {
      return;
    }
    this.sinceUpdate = 0;
    this.refresh();
  }

  /** Works the route out now (after the truck was moved, or a contract accepted). */
  refresh(): void {
    const target = this.missions.target;
    if (target === null || !this.driving.isDriving) {
      if (this.routed) {
        this.routed = false;
        this.revisionValue++;
      }
      return;
    }
    const world = this.driving.world;
    if (world.network !== this.network) {
      this.network = world.network;
      this.trace = createRouteTrace(world.network);
      this.paces = new Float64Array(world.roads.length);
      this.logger.debug(`Navigating on ${world.id}.`);
    }
    // Each road at its share of the speed limit, or of the truck's top speed if that is lower.
    const truckTop = this.driving.definition.maxSpeedKmh;
    for (let index = 0; index < world.roads.length; index++) {
      const limit = this.speedLimitsKmh[world.roads[index]!.kind];
      this.paces[index] = (Math.min(limit, truckTop) / 3.6) * this.config.etaPaceFactor;
    }
    const truck = this.driving.vehicle;
    const bay = target.depot.bay;
    const trace = this.network!.trace(truck.x, truck.z, bay.x, bay.z, this.paces, this.trace!);
    const onRoad = trace.count > 0 && Math.hypot(trace.x[0]! - truck.x, trace.z[0]! - truck.z) < ON_ROAD_METERS;
    nextManoeuvre(trace, truck.heading, onRoad, this.manoeuvre);
    this.aimXValue = bay.x;
    this.aimZValue = bay.z;
    if (trace.connected && trace.distanceMeters >= ROUTE_LOOK_AHEAD_METERS) {
      let k = 0;
      while (k < trace.count - 1 && trace.along[k]! < ROUTE_LOOK_AHEAD_METERS) k++;
      this.aimXValue = trace.x[k]!;
      this.aimZValue = trace.z[k]!;
    }
    this.routed = true;
    this.revisionValue++;
  }
}
