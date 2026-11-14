import type { EventBus } from '../../core/events/EventBus';
import type { VehicleFootprint } from '../../domain/vehicles/VehicleFootprint';
import type { GameEvents } from '../GameEvents';
import type { CompanyTruckNearby } from '../traffic/CompanyTraffic';

/** The truck the horn is on (DrivingService). */
export interface HornTruck {
  readonly isDriving: boolean;
  readonly vehicle: Readonly<{ x: number; z: number; heading: number }>;
  readonly footprint: VehicleFootprint;
}

/** The traffic that hears it (TrafficService). */
export interface HornTraffic {
  readonly simulation: { hearHorn(x: number, z: number, heading: number): number } | null;
}

/** The company trucks in the traffic that may answer it (CompanyTraffic). */
export interface HornCompanyTrucks {
  nearestInTraffic(x: number, z: number, meters: number, out: CompanyTruckNearby): boolean;
  placeInTraffic(key: string, placement: { x: number; z: number; heading: number }): boolean;
}

/** A company truck in the traffic within this far of the truck answers its horn, meters, this long after it, seconds. */
const ANSWER_METERS = 80;
const ANSWER_DELAY_SECONDS = 0.8;
/** After an answer, none for this long, seconds: a horn leaned on is not a conversation. */
const ANSWER_REST_SECONDS = 15;

/**
 * What the truck's horn does on the road (player feedback: a horn that does
 * something). Each press is one blast, acted on at the next fixed step: the
 * traffic going the truck's way ahead of its nose hurries on and leaves the
 * passing lane (TrafficSimulation.hearHorn), `HornSounded` tells the people
 * and the animals near it to startle, and a company truck in the traffic
 * near it (the fleet's or a rival's, CompanyTraffic) hoots back a moment
 * later (`HornAnswered`), at most every ANSWER_REST_SECONDS. The sound itself
 * is GameAudio's. Nothing of it is saved.
 */
export class HornService {
  private held = false;
  private sounded = false;
  private answerInSeconds = -1;
  private sinceAnswerSeconds = Number.POSITIVE_INFINITY;
  private readonly nearby: CompanyTruckNearby = { key: '', owner: 'fleet', x: 0, z: 0 };
  private readonly answering = { x: 0, z: 0, heading: 0 };

  constructor(
    private readonly driving: HornTruck,
    private readonly traffic: HornTraffic,
    private readonly companyTraffic: HornCompanyTrucks,
    private readonly events: EventBus<GameEvents>,
  ) {}

  /** The horn pressed (true) or let go: a press is a blast. */
  press(pressed: boolean): void {
    if (pressed && !this.held) {
      this.sounded = true;
    }
    this.held = pressed;
  }

  /** Each fixed step on the road, after the truck's. Allocation-free but for the events. */
  update(stepSeconds: number): void {
    this.sinceAnswerSeconds += stepSeconds;
    if (this.answerInSeconds >= 0) {
      this.answerInSeconds -= stepSeconds;
      if (this.answerInSeconds < 0) {
        this.answer();
      }
    }
    if (!this.sounded) {
      return;
    }
    this.sounded = false;
    if (!this.driving.isDriving) {
      return;
    }
    const vehicle = this.driving.vehicle;
    const footprint = this.driving.footprint;
    const nose = footprint.offsets[footprint.offsets.length - 1]! + footprint.radius;
    const sin = Math.sin(vehicle.heading);
    const cos = Math.cos(vehicle.heading);
    const hurried = this.traffic.simulation?.hearHorn(vehicle.x + sin * nose, vehicle.z + cos * nose, vehicle.heading) ?? 0;
    this.events.emit('HornSounded', { x: vehicle.x, z: vehicle.z, heading: vehicle.heading, hurried });
    if (
      this.answerInSeconds < 0 &&
      this.sinceAnswerSeconds >= ANSWER_REST_SECONDS &&
      this.companyTraffic.nearestInTraffic(vehicle.x, vehicle.z, ANSWER_METERS, this.nearby)
    ) {
      this.answerInSeconds = ANSWER_DELAY_SECONDS;
    }
  }

  /** A new drive: the horn let go, no answer coming. */
  reset(): void {
    this.held = false;
    this.sounded = false;
    this.answerInSeconds = -1;
  }

  /** The company truck that heard the horn hoots back, from where it has got to (if it is still in the traffic). */
  private answer(): void {
    const nearby = this.nearby;
    if (!this.companyTraffic.placeInTraffic(nearby.key, this.answering)) {
      return;
    }
    this.sinceAnswerSeconds = 0;
    this.events.emit('HornAnswered', { owner: nearby.owner, key: nearby.key, x: this.answering.x, z: this.answering.z });
  }
}
