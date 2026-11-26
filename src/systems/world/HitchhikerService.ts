import type { EventBus, Unsubscribe } from '../../core/events/EventBus';
import { hypot2 } from '../../core/math/scalar';
import type { Logger } from '../../core/logging/Logger';
import type { GameConfig } from '../../data/config/GameConfig';
import type { Credits } from '../../data/units';
import { hitchFare, pickHitchDestination, type HitchDestination } from '../../domain/roadside/hitchhike';
import { createRoadSpot, pickRoadSpot } from '../../domain/world/cityIncidents';
import type { MoneyReason } from '../economy/EconomyService';
import type { GameEvents } from '../GameEvents';
import type { RoadEventDriving } from './RoadEventService';

/** Where a hitchhiker stands: waiting by the road, riding in the cab, or none about. */
export type HitchStage = 'none' | 'waiting' | 'riding';

/** No room for one ahead: tried again after this long, seconds. */
const RETRY_SECONDS = 30;
/** They stand this far out from the road's edge, on the verge, meters. */
const OUT_METERS = 1.6;

/**
 * Hitchhikers (a roadside job): now and then someone waits by a road ahead
 * of the truck, thumb out (GameConfig.hitchhikers). Stopping beside them a
 * moment picks them up, contract or not: they want to go to a town a few
 * kilometres on (pickHitchDestination), and stopping near its depot drops
 * them off for the fare (hitchFare) and some experience. Left behind or kept
 * waiting too long, they walk on. One at a time; nothing is saved (a ride
 * belongs to the session, like a convoy's).
 *
 * Call update() every fixed step with the truck on the road. Allocation-free
 * but when one appears, is picked up or gets out.
 */
export class HitchhikerService {
  /** Where the hitchhiker stands, facing the road. The same object each time, moved. */
  readonly spot = { x: 0, z: 0, heading: 0 };
  private stageValue: HitchStage = 'none';
  private destinationValue: HitchDestination | null = null;
  private untilNext: number;
  private waited = 0;
  private stopped = 0;
  private asked = false;
  private readonly road = createRoadSpot();
  private readonly unsubscribe: Unsubscribe;

  constructor(
    private readonly driving: RoadEventDriving,
    private readonly economy: { earn(amount: Credits, reason: MoneyReason): void },
    private readonly company: { award(xp: number): void },
    private readonly config: GameConfig['hitchhikers'],
    /** Uniform in [0, 1): a seeded generator in tests. */
    private readonly random: () => number,
    private readonly events: EventBus<GameEvents>,
    private readonly logger: Logger,
  ) {
    this.untilNext = config.firstAfterSeconds;
    // A company started or continued from the main menu: nobody left waiting or riding from the last.
    this.unsubscribe = events.on('GameStateChanged', ({ previous, current }) => {
      if (previous === 'mainMenu' && current === 'driving') {
        this.stageValue = 'none';
        this.destinationValue = null;
        this.untilNext = this.config.firstAfterSeconds;
      }
    });
  }

  get stage(): HitchStage {
    return this.stageValue;
  }

  /** Where the rider wants to go; null but while riding. */
  get destination(): HitchDestination | null {
    return this.stageValue === 'riding' ? this.destinationValue : null;
  }

  /** Waiting: how far the hitchhiker is from the truck; riding: how far their town's depot is, meters (Infinity with none). */
  get distanceMeters(): number {
    const truck = this.driving.vehicle;
    if (this.stageValue === 'waiting') {
      return hypot2(this.spot.x - truck.x, this.spot.z - truck.z);
    }
    const destination = this.destination;
    return destination === null ? Number.POSITIVE_INFINITY : hypot2(destination.x - truck.x, destination.z - truck.z);
  }

  /** Sends a hitchhiker at the next step on the road (`?road=hitchhiker`), ahead of the truck. */
  sendHitchhiker(): void {
    this.asked = true;
  }

  update(stepSeconds: number): void {
    if (!this.driving.isDriving) {
      return;
    }
    const truck = this.driving.vehicle;
    const config = this.config;
    const still = Math.abs(truck.speed) < config.stopSpeed;
    if (this.stageValue === 'none') {
      if (this.asked) {
        this.asked = false;
        this.untilNext = 0;
      }
      this.untilNext -= stepSeconds;
      if (this.untilNext <= 0) {
        this.appear();
      }
      return;
    }
    const distance = this.distanceMeters;
    if (this.stageValue === 'waiting') {
      this.waited += stepSeconds;
      if (this.waited > config.waitSeconds || distance > config.aheadMeters[1] + config.behindMeters) {
        // Passed by, or kept waiting: they walk on.
        this.stageValue = 'none';
        this.rest();
        return;
      }
      this.stopped = distance < config.pickUpMeters && still ? this.stopped + stepSeconds : 0;
      if (this.stopped >= config.stopSeconds) {
        this.stageValue = 'riding';
        this.stopped = 0;
        const destination = this.destinationValue!;
        this.events.emit('HitchhikerPickedUp', { cityId: destination.cityId, meters: distance + destination.meters });
      }
      return;
    }
    this.stopped = distance < config.dropMeters && still ? this.stopped + stepSeconds : 0;
    if (this.stopped >= config.stopSeconds) {
      const destination = this.destinationValue!;
      const fare = hitchFare(destination.meters, config.baseFare, config.farePerKm);
      this.economy.earn(fare, 'roadside');
      this.company.award(config.xp);
      this.stageValue = 'none';
      this.destinationValue = null;
      this.rest();
      this.logger.info(`Hitchhiker dropped off in ${destination.cityId}: ${fare} credits.`);
      this.events.emit('HitchhikerDroppedOff', { cityId: destination.cityId, fare, xp: config.xp });
    }
  }

  dispose(): void {
    this.unsubscribe();
  }

  /** Someone by a road ahead of the truck, bound for a town a few kilometres on; or a try again later. */
  private appear(): void {
    const world = this.driving.world;
    const truck = this.driving.vehicle;
    const config = this.config;
    if (!pickRoadSpot(world.roads, truck.x, truck.z, truck.heading, config.aheadMeters[0], config.aheadMeters[1], this.random(), this.road)) {
      this.untilNext = RETRY_SECONDS;
      return;
    }
    const road = this.road;
    const out = road.halfWidthMeters + OUT_METERS;
    const x = road.x - road.directionZ * out;
    const z = road.z + road.directionX * out;
    const destination = pickHitchDestination(world.depots, x, z, truck.heading, config.tripMeters, this.random());
    if (destination === null) {
      this.untilNext = RETRY_SECONDS;
      return;
    }
    this.spot.x = x;
    this.spot.z = z;
    // Facing the road, toward the traffic coming.
    this.spot.heading = Math.atan2(road.directionZ, -road.directionX);
    this.destinationValue = destination;
    this.stageValue = 'waiting';
    this.waited = 0;
    this.stopped = 0;
    this.events.emit('HitchhikerAppeared', { x, z });
  }

  /** The next one after a gap. */
  private rest(): void {
    const [least, most] = this.config.gapSeconds;
    this.untilNext = least + (most - least) * this.random();
  }
}
