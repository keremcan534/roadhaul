import type { EventBus } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import { err, ok, type Result } from '../../core/Result';
import type { GameConfig } from '../../data/config/GameConfig';
import type { PlaceDefinition } from '../../data/definitions/MapDefinition';
import type { VehicleDefinition } from '../../data/definitions/VehicleDefinition';
import type { Credits } from '../../data/units';
import { planCoachLine, type CoachLine, type CoachStop } from '../../domain/coach/coachLine';
import { ComfortMeter, coachRunPay, dwellSeconds, peopleGettingOff, peopleWaiting } from '../../domain/coach/coachRun';
import type { VehicleInput } from '../../domain/vehicles/VehicleInput';
import type { VehicleRuntimeState } from '../../domain/vehicles/VehicleRuntimeState';
import type { DrivingWorld } from '../../domain/world/DrivingWorld';
import type { MoneyReason } from '../economy/EconomyService';
import type { GameEvents } from '../GameEvents';

/** What a run asks of the drive (DrivingService): the coach is driven as a race car is, the truck waiting. */
export interface CoachDriving {
  readonly isDriving: boolean;
  readonly racing: boolean;
  readonly world: DrivingWorld;
  readonly vehicle: Readonly<VehicleRuntimeState>;
  beginRace(car: VehicleDefinition, x: number, z: number, heading: number): void;
  endRace(): void;
}

/** Why a run does not start. */
export type CoachRefusal = 'notAStation' | 'contract' | 'busy' | 'noLine';

/** Where a run stands: stopped at a stop (the doors open, people getting off and on) or driving to the next. */
export type CoachStage = 'none' | 'atStop' | 'driving';

/** A knock harder than this with people on board costs comfort, m/s. */
const KNOCK_SPEED = 1.5;
/** A stop's luck is one of this many steps from 0 to 1, from where it stands and the day. */
const LUCK_STEPS = 97;

/** The game's clock as a run reads it: the hour (0–24, local) and the day. */
export interface CoachClock {
  readonly hour: number;
  readonly day: number;
}

/**
 * The coach stations' coach lines (the owner's bus job, "a route, carrying
 * people"): from a coach station (MapDefinition.places, kind `busStation`)
 * the coach (COACH) is driven through the towns' bus stops, the nearest
 * town first (planCoachLine). At each stop, standing still beside it, the
 * doors open: some of the people on board get off, paying their fares, and
 * those waiting get on (more in the rush hours, few at night), as many as
 * the seats allow; then the coach drives on. The timetable says when it is
 * due at each stop; hard pulls along or across the road and knocks with
 * people on board cost comfort. At the last stop everyone gets off and the
 * run pays: the fares, a bonus for every stop on time, one for comfort
 * (coachRunPay). The truck waits at the station meanwhile
 * (DrivingService.beginRace). Never with a contract under way; the player
 * may give up at any time (the fares of those already off are kept).
 *
 * Call update() every fixed step while a run is on, with the driver's
 * input, before the coach steps. Allocation-free there.
 */
export class CoachLineService {
  private stageValue: CoachStage = 'none';
  private place: PlaceDefinition | null = null;
  private lineValue: CoachLine | null = null;
  /** The stop the coach is at, or driving to. */
  private stopIndexValue = 0;
  private onBoardValue = 0;
  private carried = 0;
  private elapsed = 0;
  private dwellLeft = 0;
  private lastOff = 0;
  private lastOn = 0;
  private lastLate = 0;
  private onTimeStops = 0;
  private readonly comfortMeter: ComfortMeter;
  /** Lines planned, by station and world (the same world plans the same line). */
  private readonly lines = new Map<string, CoachLine | null>();
  private linesWorld: DrivingWorld | null = null;
  private paces = new Float64Array(0);
  private readonly unsubscribe: () => void;

  constructor(
    private readonly driving: CoachDriving,
    private readonly missions: { readonly active: unknown },
    private readonly economy: { earn(amount: Credits, reason: MoneyReason): void },
    private readonly company: { award(xp: number): void },
    private readonly clock: () => CoachClock,
    private readonly coach: VehicleDefinition,
    private readonly config: GameConfig['coachLines'],
    private readonly speedLimitsKmh: GameConfig['traffic']['speedLimitsKmh'],
    private readonly events: EventBus<GameEvents>,
    private readonly logger: Logger,
  ) {
    this.comfortMeter = new ComfortMeter(config.gentlePull, config.comfortPerPull, config.comfortPerKnock);
    this.unsubscribe = events.on('RaceCarCollided', ({ impactSpeedMetersPerSecond }) => {
      if (this.stageValue !== 'none' && this.onBoardValue > 0 && impactSpeedMetersPerSecond >= KNOCK_SPEED) {
        this.comfortMeter.knock();
      }
    });
  }

  get stage(): CoachStage {
    return this.stageValue;
  }

  /** A run is on. */
  get active(): boolean {
    return this.stageValue !== 'none';
  }

  /** The line being run; null between runs. */
  get line(): CoachLine | null {
    return this.lineValue;
  }

  /** The stop the coach stands at, or is driving to (0 for the station). */
  get stopIndex(): number {
    return this.stopIndexValue;
  }

  /** That stop; null between runs. */
  get stop(): CoachStop | null {
    return this.lineValue?.stops[this.stopIndexValue] ?? null;
  }

  get onBoard(): number {
    return this.onBoardValue;
  }

  get seats(): number {
    return this.config.seats;
  }

  /** People carried to where they were going so far. */
  get passengersCarried(): number {
    return this.carried;
  }

  /** 0–100. */
  get comfort(): number {
    return this.comfortMeter.value;
  }

  /** Seconds since the run started. */
  get runSeconds(): number {
    return this.elapsed;
  }

  /** Driving: seconds until the next stop is due (negative: late). At a stop: seconds until the doors close. */
  get secondsLeft(): number {
    if (this.stageValue === 'atStop') {
      return this.dwellLeft;
    }
    const stop = this.stop;
    return stop === null ? 0 : stop.dueSeconds - this.elapsed;
  }

  /** At the last stop served: how many got off and on, and how late it was (negative: early), seconds. */
  get lastStop(): { readonly off: number; readonly on: number; readonly lateSeconds: number } {
    return { off: this.lastOff, on: this.lastOn, lateSeconds: this.lastLate };
  }

  /** Where the GPS leads while driving: the next stop; null otherwise. */
  get navTarget(): CoachStop | null {
    return this.stageValue === 'driving' ? this.stop : null;
  }

  /** The line from `place` (a coach station) on the world being driven; null when it has none. */
  lineFrom(place: PlaceDefinition): CoachLine | null {
    if (place.kind !== 'busStation' || !this.driving.isDriving) {
      return null;
    }
    const world = this.driving.world;
    if (world !== this.linesWorld) {
      this.linesWorld = world;
      this.lines.clear();
      this.paces = new Float64Array(world.roads.length);
      for (let index = 0; index < world.roads.length; index++) {
        this.paces[index] = (Math.min(this.speedLimitsKmh[world.roads[index]!.kind], this.coach.maxSpeedKmh) / 3.6) * this.config.timetablePace;
      }
    }
    if (!this.lines.has(place.id)) {
      const { config } = this;
      const line = planCoachLine(world, place, {
        stops: config.stops,
        townReachMeters: config.townReachMeters,
        longestMeters: config.longestMeters,
        paces: this.paces,
        // The timetable allows for an average stop: the doors and as many people as wait on average, off and on.
        dwellSeconds: dwellSeconds(config.doorSeconds, config.secondsPerPerson, config.waiting[0] + config.waiting[1]),
      });
      this.lines.set(place.id, line);
      if (line === null) {
        this.logger.warn(`No coach line from ${place.id}.`);
      }
    }
    return this.lines.get(place.id) ?? null;
  }

  /** Whether a run could start at `place` now, or why not. */
  canStart(place: PlaceDefinition): Result<void, CoachRefusal> {
    if (place.kind !== 'busStation') {
      return err('notAStation');
    }
    if (this.missions.active !== null) {
      return err('contract');
    }
    if (!this.driving.isDriving || this.driving.racing || this.active) {
      return err('busy');
    }
    return this.lineFrom(place) === null ? err('noLine') : ok(undefined);
  }

  /** Starts a run from `place`: the coach beside the station, its doors open for the people waiting there. */
  start(place: PlaceDefinition): Result<void, CoachRefusal> {
    const can = this.canStart(place);
    if (!can.ok) {
      return can;
    }
    const line = this.lineFrom(place)!;
    const first = line.stops[0]!;
    this.driving.beginRace(this.coach, first.x, first.z, first.heading);
    this.place = place;
    this.lineValue = line;
    this.stopIndexValue = 0;
    this.onBoardValue = 0;
    this.carried = 0;
    this.elapsed = 0;
    this.onTimeStops = 0;
    this.comfortMeter.reset();
    this.stageValue = 'atStop';
    this.serve(0);
    this.logger.info(`Coach line from ${place.id}: ${line.stops.length} stops, ${Math.round(line.lengthMeters)} m.`);
    this.events.emit('CoachLineStarted', { placeId: place.id, stops: line.stops.length });
    return ok(undefined);
  }

  /** One fixed step of the run: the doors at a stop, the ride, the coming to a stop. */
  update(stepSeconds: number, input: VehicleInput): void {
    if (this.stageValue === 'none') {
      return;
    }
    this.elapsed += stepSeconds;
    const vehicle = this.driving.vehicle;
    if (this.stageValue === 'atStop') {
      // Held at the stop while the doors are open.
      input.throttle = 0;
      input.brake = 1;
      this.dwellLeft -= stepSeconds;
      if (this.dwellLeft <= 0) {
        if (this.stopIndexValue >= this.lineValue!.stops.length - 1) {
          this.end(true);
        } else {
          this.stopIndexValue++;
          this.stageValue = 'driving';
        }
      }
      return;
    }
    if (this.onBoardValue > 0) {
      this.comfortMeter.ride(vehicle.longitudinalAcceleration, vehicle.lateralAcceleration, stepSeconds);
    }
    const stop = this.stop!;
    const dx = vehicle.x - stop.x;
    const dz = vehicle.z - stop.z;
    const radius = this.config.stopRadiusMeters;
    if (dx * dx + dz * dz <= radius * radius && Math.abs(vehicle.speed) <= this.config.stopSpeed) {
      this.stageValue = 'atStop';
      this.serve(this.stopIndexValue);
    }
  }

  /** Gives the run up: the fares of those already off are kept, the truck is driven again. */
  quit(): void {
    if (this.active) {
      this.end(false);
    }
  }

  dispose(): void {
    this.unsubscribe();
  }

  /** The coach at stop `index`: people off (paying), people on, the doors' time; on time or late. */
  private serve(index: number): void {
    const { config } = this;
    const line = this.lineValue!;
    const stop = line.stops[index]!;
    const last = index === line.stops.length - 1;
    const late = index === 0 ? 0 : this.elapsed - stop.dueSeconds;
    if (index > 0 && late <= config.lateGraceSeconds) {
      this.onTimeStops++;
    }
    const off = index === 0 ? 0 : peopleGettingOff(this.onBoardValue, config.alightShare, last);
    this.onBoardValue -= off;
    this.carried += off;
    const { hour, day } = this.clock();
    const luck = this.luck(stop, day);
    const on = last ? 0 : Math.min(config.seats - this.onBoardValue, peopleWaiting(config.waiting, hour, luck));
    this.onBoardValue += on;
    this.lastOff = off;
    this.lastOn = on;
    this.lastLate = late;
    this.dwellLeft = dwellSeconds(config.doorSeconds, config.secondsPerPerson, off + on);
    if (index > 0) {
      this.events.emit('CoachStopServed', { stopIndex: index, cityId: stop.cityId, off, on, lateSeconds: late });
    }
  }

  /** A stop's luck today, 0–1: the same stop on the same day waits the same (but for the hour). */
  private luck(stop: CoachStop, day: number): number {
    const seed = Math.abs(Math.round(stop.shelterX * 7 + stop.shelterZ * 13 + day * 31));
    return (seed % LUCK_STEPS) / (LUCK_STEPS - 1);
  }

  /** The run over: the truck driven again, the run paid, the result said. */
  private end(finished: boolean): void {
    const place = this.place!;
    const line = this.lineValue!;
    const towns = line.stops.length - 1;
    const served = finished ? towns : Math.max(0, this.stopIndexValue - (this.stageValue === 'driving' ? 1 : 0));
    const comfort = Math.round(this.comfortMeter.value);
    const pay = coachRunPay(this.config, {
      passengers: this.carried,
      finished,
      allOnTime: this.onTimeStops >= towns,
      comfort,
    });
    this.stageValue = 'none';
    this.driving.endRace();
    if (pay.total > 0) {
      this.economy.earn(pay.total, 'coach');
    }
    if (pay.xp > 0) {
      this.company.award(pay.xp);
    }
    this.lineValue = null;
    this.place = null;
    this.onBoardValue = 0;
    this.logger.info(
      finished ? `Coach line run: ${pay.passengers} people, ${pay.total} credits, ${pay.stars} stars.` : `Coach line given up: ${pay.total} credits.`,
    );
    this.events.emit('CoachLineEnded', {
      placeId: place.id,
      finished,
      stopsServed: served,
      stops: towns,
      onTimeStops: this.onTimeStops,
      comfort,
      passengers: pay.passengers,
      fares: pay.fares,
      onTimeBonus: pay.onTimeBonus,
      comfortBonus: pay.comfortBonus,
      total: pay.total,
      xp: pay.xp,
      stars: pay.stars,
    });
  }
}
