import type { EventBus, Unsubscribe } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import type { GameConfig } from '../../data/config/GameConfig';
import { createRoadSpot, pickRoadSpot } from '../../domain/world/cityIncidents';
import type { DrivingWorld } from '../../domain/world/DrivingWorld';
import { createRouteTrace, type RouteTrace } from '../../domain/world/RoadNetwork';
import type { EconomyService } from '../economy/EconomyService';
import type { GameEvents } from '../GameEvents';
import type { RoadEventDriving } from './RoadEventService';

/** The convoy's trucks, the lead first, this far apart along the road, meters. */
export const CONVOY_GAPS = [0, 24, 48] as const;
/** They drive this far right of the road's middle, meters: in their lane. */
const LANE_OFFSET = 1.9;
/** A route this short is no convoy's: planned again later. */
const LEAST_ROUTE_METERS = 1200;
/** No room for one: tried again after this long, seconds. */
const RETRY_SECONDS = 40;

/**
 * Now and then a convoy of three trucks forms on a road ahead and drives
 * off along the roads at a steady pace (GameConfig.convoy). Driving close
 * behind or beside it counts as riding with it; when it reaches its end, the
 * kilometres ridden are paid (if there were enough to count). The convoy's
 * trucks are drawn by RoadEventsView; nothing is saved.
 *
 * Call update() every fixed step with the truck on the road.
 */
export class ConvoyService {
  readonly vehicleX = new Float64Array(CONVOY_GAPS.length);
  readonly vehicleZ = new Float64Array(CONVOY_GAPS.length);
  readonly vehicleHeading = new Float64Array(CONVOY_GAPS.length);
  private activeValue = false;
  private ridingValue = false;
  private riddenMeters = 0;
  private elapsed = 0;
  private untilNext: number;
  private asked = false;
  private route: RouteTrace | null = null;
  private routeWorld: DrivingWorld | null = null;
  private paces = new Float64Array(0);
  private readonly cursors = new Int32Array(CONVOY_GAPS.length);
  private readonly start = createRoadSpot();
  private readonly end = createRoadSpot();
  private readonly unsubscribe: Unsubscribe;

  constructor(
    private readonly driving: RoadEventDriving,
    private readonly economy: EconomyService,
    private readonly config: GameConfig['convoy'],
    /** Uniform in [0, 1): a seeded generator in tests. */
    private readonly random: () => number,
    private readonly events: EventBus<GameEvents>,
    private readonly logger: Logger,
  ) {
    this.untilNext = config.firstAfterSeconds;
    // A company started or continued from the main menu: no convoy left from the last.
    this.unsubscribe = events.on('GameStateChanged', ({ previous, current }) => {
      if (previous === 'mainMenu' && current === 'driving') {
        this.activeValue = false;
        this.untilNext = this.config.firstAfterSeconds;
      }
    });
  }

  /** A convoy is on the road. */
  get active(): boolean {
    return this.activeValue;
  }

  /** The truck rides with it now. */
  get riding(): boolean {
    return this.ridingValue;
  }

  /** How far the truck has ridden with it, meters. */
  get riddenMetersSoFar(): number {
    return this.riddenMeters;
  }

  /** How far the truck is from its nearest truck, meters (Infinity with none). */
  get distanceMeters(): number {
    if (!this.activeValue) {
      return Number.POSITIVE_INFINITY;
    }
    const truck = this.driving.vehicle;
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < CONVOY_GAPS.length; i++) {
      const dx = this.vehicleX[i]! - truck.x;
      const dz = this.vehicleZ[i]! - truck.z;
      best = Math.min(best, Math.sqrt(dx * dx + dz * dz));
    }
    return best;
  }

  /** Sends a convoy at the next step on the road (`?road=convoy`). */
  sendConvoy(): void {
    this.asked = true;
  }

  update(stepSeconds: number): void {
    if (!this.driving.isDriving) {
      return;
    }
    if (!this.activeValue) {
      if (this.asked) {
        this.asked = false;
        this.untilNext = 0;
      }
      this.untilNext -= stepSeconds;
      if (this.untilNext <= 0) {
        this.plan(this.driving.world);
      }
      return;
    }
    this.elapsed += stepSeconds;
    const going = this.move();
    const truck = this.driving.vehicle;
    const speed = Math.abs(truck.speed);
    this.ridingValue = speed > this.config.leastSpeed && this.distanceMeters < this.config.rideMeters;
    if (this.ridingValue) {
      this.riddenMeters += speed * stepSeconds;
    }
    if (!going || this.elapsed > this.config.mostSeconds) {
      this.finish();
    }
  }

  dispose(): void {
    this.unsubscribe();
  }

  /** A convoy on a road ahead of the truck, bound for one a few kilometres on. */
  private plan(world: DrivingWorld): void {
    const truck = this.driving.vehicle;
    const { aheadMeters, routeMeters } = this.config;
    const ok =
      pickRoadSpot(world.roads, truck.x, truck.z, truck.heading, aheadMeters[0], aheadMeters[1], this.random(), this.start) &&
      pickRoadSpot(world.roads, truck.x, truck.z, truck.heading, routeMeters[0], routeMeters[1], this.random(), this.end);
    if (!ok) {
      this.untilNext = RETRY_SECONDS;
      return;
    }
    if (this.routeWorld !== world) {
      this.route = createRouteTrace(world.network);
      this.paces = new Float64Array(world.roads.length).fill(this.config.speed);
      this.routeWorld = world;
    }
    const route = world.network.trace(this.start.x, this.start.z, this.end.x, this.end.z, this.paces, this.route!);
    if (!route.connected || route.count < 4 || route.along[route.count - 1]! < LEAST_ROUTE_METERS) {
      this.untilNext = RETRY_SECONDS;
      return;
    }
    this.activeValue = true;
    this.ridingValue = false;
    this.riddenMeters = 0;
    this.elapsed = 0;
    this.cursors.fill(0);
    this.move();
    this.logger.info(`A convoy sets off, ${Math.round(route.along[route.count - 1]!)} m to go.`);
    this.events.emit('ConvoyStarted', { x: this.vehicleX[0]!, z: this.vehicleZ[0]! });
  }

  /** Moves the convoy on along its route; false once its lead truck has reached the end. */
  private move(): boolean {
    const route = this.route!;
    const last = route.count - 1;
    const end = route.along[last]!;
    const lead = CONVOY_GAPS[CONVOY_GAPS.length - 1]! + this.elapsed * this.config.speed;
    for (let i = 0; i < CONVOY_GAPS.length; i++) {
      const distance = Math.min(end, Math.max(0, lead - CONVOY_GAPS[i]!));
      let k = this.cursors[i]!;
      while (k < last - 1 && route.along[k + 1]! < distance) {
        k++;
      }
      this.cursors[i] = k;
      const d0 = route.along[k]!;
      const d1 = route.along[k + 1]!;
      const t = d1 > d0 ? Math.min(1, Math.max(0, (distance - d0) / (d1 - d0))) : 0;
      const dx = route.x[k + 1]! - route.x[k]!;
      const dz = route.z[k + 1]! - route.z[k]!;
      const length = Math.sqrt(dx * dx + dz * dz) || 1;
      this.vehicleX[i] = route.x[k]! + dx * t + (-dz / length) * LANE_OFFSET;
      this.vehicleZ[i] = route.z[k]! + dz * t + (dx / length) * LANE_OFFSET;
      this.vehicleHeading[i] = Math.atan2(dx, dz);
    }
    return lead < end;
  }

  /** The convoy reached its end: the kilometres ridden with it paid, if enough. */
  private finish(): void {
    this.activeValue = false;
    this.ridingValue = false;
    const meters = this.riddenMeters;
    const reward = meters >= this.config.leastRiddenMeters ? Math.round(((meters / 1000) * this.config.creditsPerKm) / 10) * 10 : 0;
    if (reward > 0) {
      this.economy.earn(reward, 'convoy');
    }
    this.events.emit('ConvoyEnded', { riddenMeters: meters, reward });
    const [least, most] = this.config.gapSeconds;
    this.untilNext = least + (most - least) * this.random();
  }
}
