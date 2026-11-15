import type { EventBus } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import { err, ok, type Result } from '../../core/Result';
import type { CrateTier, GameConfig } from '../../data/config/GameConfig';
import type { PlaceDefinition } from '../../data/definitions/MapDefinition';
import type { VehicleDefinition } from '../../data/definitions/VehicleDefinition';
import {
  createRoutePoint,
  laneOfRoute,
  RaceProgress,
  racePosition,
  raceRouteFrom,
  RivalPlan,
  type RaceRoute,
} from '../../domain/race/streetRace';
import type { VehicleInput } from '../../domain/vehicles/VehicleInput';
import type { VehicleRuntimeState } from '../../domain/vehicles/VehicleRuntimeState';
import type { DrivingWorld } from '../../domain/world/DrivingWorld';
import { createRouteTrace } from '../../domain/world/RoadNetwork';
import type { CrateSource, GameEvents } from '../GameEvents';

/** What a race asks of the drive (DrivingService). */
export interface RaceDriving {
  readonly isDriving: boolean;
  readonly racing: boolean;
  readonly world: DrivingWorld;
  readonly vehicle: Readonly<VehicleRuntimeState>;
  beginRace(car: VehicleDefinition, x: number, z: number, heading: number): void;
  endRace(): void;
}

/** The race clubs' day (PlaceService). */
export interface RacePlaces {
  readonly racesLeftToday: number;
  countRace(): void;
}

/** Why a race does not start. */
export type RaceRefusal = 'notAClub' | 'contract' | 'noneLeft' | 'noRoute';

/** Where a race stands. */
export type RaceStage = 'none' | 'countdown' | 'racing';

/** The rivals line up this far ahead of the player on the route, meters (a rolling grid). */
const GRID_METERS = [12, 24, 36] as const;
/** The player has crossed the line within this of the route's end, meters. */
const FINISH_SLACK_METERS = 4;
/** Further than this from the route, the player is told to come back to it, meters. */
const OFF_ROUTE_METERS = 45;
/** This long after the last rival, a race not finished is over: last place, seconds. */
const LATE_SECONDS = 90;
/** The rivals' route is planned at this pace on every road: they race, limits or not (m/s). */
const ROUTE_PACE = 20;

/**
 * The race clubs' street races (the owner's car races): from a race club
 * (MapDefinition.places, kind `raceClub`) by road to its finish, in the
 * clubs' car (RACE_CAR) against the club's rivals, planned along the route
 * at their skill (RivalPlan; they race through the traffic, not into it).
 * The truck waits at the club meanwhile (DrivingService.beginRace). The
 * lights count down, the race runs, the player's place is how far along
 * the route each one has got; crossing the line, the podium earns a crate
 * (gold, silver, bronze), and the truck is driven again. A few a day
 * (PlaceService.racesLeftToday), never with a contract under way, and the
 * player may give up at any time.
 *
 * Call update() every fixed step while a race is on, with the driver's
 * input, before the car steps. Allocation-free there.
 */
export class RaceService {
  private stageValue: RaceStage = 'none';
  private place: PlaceDefinition | null = null;
  private route: RaceRoute | null = null;
  private progress: RaceProgress | null = null;
  private plans: RivalPlan[] = [];
  private countdown = 0;
  private elapsed = 0;
  /** When the last rival crosses the line, seconds after the start. */
  private lastRivalFinish = 0;
  /** Where each rival is, to be drawn: its middle on the road, facing along it. */
  readonly rivalX: Float64Array;
  readonly rivalZ: Float64Array;
  readonly rivalHeading: Float64Array;
  private readonly rivalAlong: Float64Array;
  private readonly rivalPoints = GRID_METERS.map(() => createRoutePoint());

  constructor(
    private readonly driving: RaceDriving,
    private readonly places: RacePlaces,
    private readonly missions: { readonly active: unknown },
    private readonly crates: { grant(tier: CrateTier, source: CrateSource): void },
    private readonly car: VehicleDefinition,
    private readonly config: GameConfig['races'],
    private readonly events: EventBus<GameEvents>,
    private readonly logger: Logger,
  ) {
    const rivals = Math.min(GRID_METERS.length, config.rivalSkills.length);
    this.rivalX = new Float64Array(rivals);
    this.rivalZ = new Float64Array(rivals);
    this.rivalHeading = new Float64Array(rivals);
    this.rivalAlong = new Float64Array(rivals);
  }

  get stage(): RaceStage {
    return this.stageValue;
  }

  /** A race is on (counting down or running). */
  get active(): boolean {
    return this.stageValue !== 'none';
  }

  /** Cars in the race: the player and the rivals. */
  get field(): number {
    return this.rivalX.length + 1;
  }

  /** Seconds before the start while the lights count down; 0 once it runs. */
  get countdownSeconds(): number {
    return this.stageValue === 'countdown' ? this.countdown : 0;
  }

  /** Seconds since the start. */
  get raceSeconds(): number {
    return this.elapsed;
  }

  /** The player's place now: 1 for the lead. */
  get position(): number {
    return this.progress === null ? this.field : racePosition(this.progress.alongMeters, this.rivalAlong);
  }

  /** Meters to the line. */
  get metersLeft(): number {
    return this.route === null || this.progress === null ? 0 : Math.max(0, this.route.length - this.progress.alongMeters);
  }

  /** The player is far off the route. */
  get offRoute(): boolean {
    return this.progress !== null && this.stageValue === 'racing' && this.progress.offRouteMeters > OFF_ROUTE_METERS;
  }

  /** Whether a race could start at `place` now, or why not. */
  canStart(place: PlaceDefinition): Result<void, RaceRefusal> {
    if (place.kind !== 'raceClub' || place.raceTo === undefined) {
      return err('notAClub');
    }
    if (this.missions.active !== null) {
      return err('contract');
    }
    if (this.places.racesLeftToday <= 0) {
      return err('noneLeft');
    }
    return ok(undefined);
  }

  /** Starts a race from `place`: the route traced, the grid lined up, the car on the line, the lights counting down. */
  start(place: PlaceDefinition): Result<void, RaceRefusal> {
    const can = this.canStart(place);
    if (!can.ok) {
      return can;
    }
    if (!this.driving.isDriving || this.driving.racing || this.active) {
      return err('notAClub');
    }
    const world = this.driving.world;
    const raceTo = place.raceTo!;
    const trace = createRouteTrace(world.network);
    world.network.trace(place.lot.x, place.lot.z, raceTo.x, raceTo.z, new Float64Array(world.roads.length).fill(ROUTE_PACE), trace);
    if (!trace.connected || trace.count < 10) {
      return err('noRoute');
    }
    const route = raceRouteFrom(trace);
    const pace = this.config.pace;
    this.plans = this.config.rivalSkills.slice(0, this.rivalX.length).map(
      (skill, index) =>
        new RivalPlan(
          route,
          { topSpeed: pace.topSpeed * skill, corner: pace.corner * skill, accelerate: pace.accelerate * skill, brake: pace.brake },
          GRID_METERS[index]!,
        ),
    );
    this.lastRivalFinish = Math.max(...this.plans.map((plan) => plan.finishSeconds));
    const start = laneOfRoute(route, world.roads, 0, 0, createRoutePoint());
    this.driving.beginRace(this.car, start.x, start.z, start.heading);
    this.places.countRace();
    this.place = place;
    this.route = route;
    this.progress = new RaceProgress(route);
    this.countdown = this.config.countdownSeconds;
    this.elapsed = 0;
    this.stageValue = 'countdown';
    for (const point of this.rivalPoints) {
      point.index = 0;
    }
    this.placeRivals();
    this.logger.info(`Race from ${place.id}: ${Math.round(route.length)} m.`);
    this.events.emit('RaceStarted', { placeId: place.id });
    return ok(undefined);
  }

  /** One fixed step of the race: the lights, the rivals, the player's place, the line. */
  update(stepSeconds: number, input: VehicleInput): void {
    if (this.stageValue === 'none') {
      return;
    }
    if (this.stageValue === 'countdown') {
      // Held on the line until the lights go.
      input.throttle = 0;
      input.brake = 1;
      input.lever = 'drive';
      this.countdown -= stepSeconds;
      if (this.countdown <= 0) {
        this.countdown = 0;
        this.stageValue = 'racing';
      }
      return;
    }
    this.elapsed += stepSeconds;
    const vehicle = this.driving.vehicle;
    this.progress!.update(vehicle.x, vehicle.z);
    this.placeRivals();
    const route = this.route!;
    if (this.progress!.alongMeters >= route.length - FINISH_SLACK_METERS) {
      let ahead = 0;
      for (const plan of this.plans) {
        ahead += plan.finishSeconds < this.elapsed ? 1 : 0;
      }
      this.end(1 + ahead);
    } else if (this.elapsed > this.lastRivalFinish + LATE_SECONDS) {
      this.end(this.field);
    }
  }

  /** Gives the race up: no place, no crate, the truck again. */
  quit(): void {
    if (this.active) {
      this.end(null);
    }
  }

  /** The rivals where their plans have them now, on the road. */
  private placeRivals(): void {
    const route = this.route!;
    const roads = this.driving.world.roads;
    for (let i = 0; i < this.plans.length; i++) {
      const along = this.plans[i]!.alongAt(this.elapsed);
      this.rivalAlong[i] = along;
      const point = laneOfRoute(route, roads, along, i % 2, this.rivalPoints[i]!);
      this.rivalX[i] = point.x;
      this.rivalZ[i] = point.z;
      this.rivalHeading[i] = point.heading;
    }
  }

  /** The race over: the truck driven again, the podium's crate given, the result said. */
  private end(position: number | null): void {
    const place = this.place!;
    const seconds = this.elapsed;
    this.stageValue = 'none';
    this.driving.endRace();
    const crate = position === null ? null : (this.config.podiumCrates[position - 1] ?? null);
    if (crate !== null) {
      this.crates.grant(crate, 'race');
    }
    this.route = null;
    this.progress = null;
    this.plans = [];
    this.place = null;
    this.logger.info(position === null ? 'Race given up.' : `Race finished ${position}/${this.field} in ${seconds.toFixed(1)} s.`);
    this.events.emit('RaceEnded', { placeId: place.id, position, of: this.field, seconds, crate });
  }
}
