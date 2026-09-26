import type { EventBus } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import { err, ok, type Result } from '../../core/Result';
import type { GameConfig } from '../../data/config/GameConfig';
import type { ContentCatalog } from '../../data/ContentCatalog';
import type { DriverDefinition } from '../../data/definitions/DriverDefinition';
import type { Credits, Fraction } from '../../data/units';
import type { SpendError } from '../../domain/economy/CurrencyWallet';
import { fleetJobProfit, fleetJobSeed, planFleetJob, type FleetJob, type FleetJobRules, type FleetMarket } from '../../domain/fleet/fleetJobs';
import type { FleetSaveData, HiredDriverSaveData } from '../../domain/save/SaveGameData';
import type { DrivingWorld } from '../../domain/world/DrivingWorld';
import { createRouteTrace, type RouteTrace } from '../../domain/world/RoadNetwork';
import { createRouteGuidance } from '../../domain/world/roadRoute';
import type { DrivingService } from '../driving/DrivingService';
import type { EconomyService } from '../economy/EconomyService';
import type { GameEvents } from '../GameEvents';
import type { CompanyLevelSource } from '../missions/MissionService';
import type { GarageService } from '../vehicles/GarageService';

export type HireDriverError = 'unknownDriver' | 'alreadyHired' | 'locked' | SpendError;
export type DismissDriverError = 'unknownDriver' | 'notHired';
export type AssignTruckError = 'notHired' | 'hasTruck' | 'unknownTruck' | 'playersTruck' | 'truckTaken';
export type RecallTruckError = 'notHired' | 'noTruck';

/** A driver the company can hire, or has. */
export interface DriverOffer {
  readonly definition: DriverDefinition;
  readonly requiredCompanyLevel: number;
  /** Below that level: shown, but not for hire yet. */
  readonly locked: boolean;
  readonly hired: boolean;
}

/**
 * What a hired driver is doing: waiting at the HQ for a truck, setting off
 * (their next contract starts with the next step), on a contract, or with
 * their truck in the workshop.
 */
export type DriverActivity = 'noTruck' | 'settingOff' | 'onContract' | 'inWorkshop';

/** A hired driver and their truck, contract and record. */
export interface FleetDriverStatus {
  readonly definition: DriverDefinition;
  readonly truckInstanceId: string | null;
  readonly activity: DriverActivity;
  /** Where they are, or left last. */
  readonly cityId: string;
  /** The contract under way. */
  readonly job: FleetJob | null;
  /** How far along the contract, or the repair, is. */
  readonly progress: Fraction;
  /** Seconds until the contract is delivered, or the truck is out of the workshop. */
  readonly secondsLeft: number;
  readonly jobsCompleted: number;
  /** What their contracts brought the company after their share and the fuel. */
  readonly creditsEarned: Credits;
}

/** A fleet truck on the map (for the map and the minimap). */
export interface FleetMarker {
  driverId: string;
  x: number;
  z: number;
  /** 0 faces +Z, π/2 faces +X. */
  heading: number;
  /** On the road, not standing at a depot. */
  moving: boolean;
}

/** A contract's way on the map: the loading bay, the road there sample by sample, and the next bay. */
interface FleetRoute {
  readonly x: Float64Array;
  readonly z: Float64Array;
  /** Metres from the first point. */
  readonly along: Float64Array;
  readonly length: number;
}

/** A hired driver. */
interface HiredDriver {
  readonly definition: DriverDefinition;
  truckInstanceId: string | null;
  cityId: string;
  job: FleetJob | null;
  elapsedSeconds: number;
  repairSecondsLeft: number;
  jobsCompleted: number;
  creditsEarned: Credits;
  /** The job's way on the map, worked out when it starts (or loads). */
  route: FleetRoute | null;
}

/** What the fleet did while the game was closed, added up as it catches up. */
interface AwayTally {
  jobs: number;
  credits: Credits;
}

/**
 * The company's fleet (spec §27, V2: "Truck 2 → AI Driver … the AI driver
 * earns passive income when a contract is done"). The company hires drivers
 * (DriverDefinition, for a fee) and hands each one of its other trucks in
 * the garage; the driver then takes contracts between the cities by
 * themself, one after another (planFleetJob): each is delivered after its
 * time on the road, and its pay, less the driver's share and the diesel,
 * goes to the company. Now and then a truck comes back damaged; badly
 * damaged, it spends a while in the workshop, and the company pays the
 * repair. The fleet works in game time (update, every fixed step), and for
 * a while after the game was closed (catchUp). Where each truck is on the
 * map follows its contract along the roads (markers).
 */
export class FleetService {
  private drivers: HiredDriver[] = [];
  private jobsPlanned = 0;
  /** Reused markers, one per driver, filled by updateMarkers(). */
  readonly markers: FleetMarker[] = [];
  private away: AwayTally | null = null;
  private readonly rules: FleetJobRules;
  private market: FleetMarket | null = null;
  private marketWorld: DrivingWorld | null = null;
  private trace: RouteTrace | null = null;
  private paces = new Float64Array(0);

  constructor(
    private readonly content: ContentCatalog,
    private readonly driving: DrivingService,
    private readonly garage: GarageService,
    private readonly economy: EconomyService,
    private readonly company: CompanyLevelSource,
    private readonly events: EventBus<GameEvents>,
    private readonly config: GameConfig['fleet'],
    economyConfig: GameConfig['economy'],
    fuelConfig: GameConfig['fuel'],
    private readonly logger: Logger,
  ) {
    this.rules = {
      averageSpeedKmh: config.averageSpeedKmh,
      handlingSeconds: config.handlingSeconds,
      payFactor: config.payFactor,
      consumptionScale: fuelConfig.consumptionScale,
      fuelPricePerLiter: economyConfig.fuelPricePerLiter,
    };
  }

  /** Every driver in the content, in content order: hired or not, and whether the company is big enough for them. */
  roster(): readonly DriverOffer[] {
    return this.content.drivers.all.map((definition) => {
      const requiredCompanyLevel = definition.requiredCompanyLevel ?? 1;
      return {
        definition,
        requiredCompanyLevel,
        locked: this.company.level < requiredCompanyLevel,
        hired: this.drivers.some((driver) => driver.definition.id === definition.id),
      };
    });
  }

  /** The hired drivers, in the order they were hired. */
  get hired(): readonly FleetDriverStatus[] {
    return this.drivers.map((driver) => this.status(driver));
  }

  /** The hired drivers without a truck. */
  get waiting(): readonly FleetDriverStatus[] {
    return this.hired.filter((driver) => driver.truckInstanceId === null);
  }

  /** Hires `driverId` for their fee. They wait at the HQ until they are given a truck. */
  hire(driverId: string): Result<FleetDriverStatus, HireDriverError> {
    const offer = this.roster().find((candidate) => candidate.definition.id === driverId);
    if (offer === undefined) {
      return err('unknownDriver');
    }
    if (offer.hired) {
      return err('alreadyHired');
    }
    if (offer.locked) {
      return err('locked');
    }
    const fee = offer.definition.hiringFee;
    const paid = this.economy.spend(fee, 'hiring');
    if (!paid.ok) {
      return err(paid.error);
    }
    const driver: HiredDriver = {
      definition: offer.definition,
      truckInstanceId: null,
      cityId: this.homeCityId(),
      job: null,
      elapsedSeconds: 0,
      repairSecondsLeft: 0,
      jobsCompleted: 0,
      creditsEarned: 0,
      route: null,
    };
    this.drivers.push(driver);
    this.logger.info(`Hired ${driverId} for ${fee}.`);
    this.events.emit('DriverHired', { driverId, fee });
    return ok(this.status(driver));
  }

  /** `driverId` leaves the company. A truck they had goes back to the garage, and a contract under way is lost. */
  dismiss(driverId: string): Result<void, DismissDriverError> {
    if (!this.content.drivers.has(driverId)) {
      return err('unknownDriver');
    }
    const driver = this.find(driverId);
    if (driver === undefined) {
      return err('notHired');
    }
    this.takeTruckBack(driver);
    this.drivers.splice(this.drivers.indexOf(driver), 1);
    this.logger.info(`${driverId} left the company.`);
    this.events.emit('DriverDismissed', { driverId });
    return ok(undefined);
  }

  /**
   * Gives hired `driverId` the truck `instanceId` from the garage: they take
   * it out on a contract from the HQ's city at once, and on the next ones
   * after it. Not the truck the player drives, nor one another driver has.
   */
  assign(driverId: string, instanceId: string): Result<FleetDriverStatus, AssignTruckError> {
    const driver = this.find(driverId);
    if (driver === undefined) {
      return err('notHired');
    }
    if (driver.truckInstanceId !== null) {
      return err('hasTruck');
    }
    const truck = this.garage.trucks.find((candidate) => candidate.instanceId === instanceId);
    if (truck === undefined) {
      return err('unknownTruck');
    }
    if (truck.active) {
      return err('playersTruck');
    }
    if (truck.driverId !== null) {
      return err('truckTaken');
    }
    this.garage.assignDriver(instanceId, driverId);
    driver.truckInstanceId = instanceId;
    driver.cityId = this.homeCityId();
    driver.job = null;
    driver.route = null;
    driver.elapsedSeconds = 0;
    driver.repairSecondsLeft = 0;
    this.startJob(driver);
    this.logger.info(`${driverId} takes ${instanceId} out.`);
    this.events.emit('FleetTruckAssigned', { driverId, instanceId });
    return ok(this.status(driver));
  }

  /** Brings `driverId`'s truck back to the garage at once. A contract under way is lost; the driver waits at the HQ. */
  recall(driverId: string): Result<FleetDriverStatus, RecallTruckError> {
    const driver = this.find(driverId);
    if (driver === undefined) {
      return err('notHired');
    }
    if (driver.truckInstanceId === null) {
      return err('noTruck');
    }
    this.takeTruckBack(driver);
    this.events.emit('FleetTruckAssigned', { driverId, instanceId: null });
    return ok(this.status(driver));
  }

  /** The fleet works on for `dt` seconds of game time: call every fixed step while the game runs. */
  update(dt: number): void {
    if (!(dt > 0)) {
      return;
    }
    for (let i = 0; i < this.drivers.length; i++) {
      this.advance(this.drivers[i]!, dt);
    }
  }

  /**
   * The fleet works through `seconds` the game was closed (at most
   * GameConfig.fleet.awayHours): its contracts are delivered and paid as
   * they would have been, each announced as `away`, and FleetCaughtUp
   * sums them up. Nothing when no driver has a truck.
   */
  catchUp(seconds: number): void {
    const span = Math.min(Math.max(0, seconds), this.config.awayHours * 3600);
    if (!(span > 0) || !this.drivers.some((driver) => driver.truckInstanceId !== null)) {
      return;
    }
    const tally: AwayTally = { jobs: 0, credits: 0 };
    this.away = tally;
    try {
      for (const driver of this.drivers) {
        this.advance(driver, span);
      }
    } finally {
      this.away = null;
    }
    this.logger.info(`While away (${Math.round(span)} s): ${tally.jobs} contracts, ${tally.credits} credits.`);
    this.events.emit('FleetCaughtUp', { seconds: span, jobs: tally.jobs, credits: tally.credits });
  }

  /**
   * Fills `markers` with where each truck out on a contract is (at the bay
   * while loading and unloading, along the road between) and returns how
   * many. Allocation-free once every driver has a marker.
   */
  updateMarkers(): number {
    let count = 0;
    for (let i = 0; i < this.drivers.length; i++) {
      const driver = this.drivers[i]!;
      const job = driver.job;
      if (job === null || driver.truckInstanceId === null) {
        continue;
      }
      const route = driver.route ?? this.routeFor(driver);
      if (route === null) {
        continue;
      }
      let marker = this.markers[count];
      if (marker === undefined) {
        marker = { driverId: '', x: 0, z: 0, heading: 0, moving: false };
        this.markers.push(marker);
      }
      marker.driverId = driver.definition.id;
      const handling = Math.min(this.rules.handlingSeconds, job.durationSeconds) / 2;
      const drive = Math.max(1e-6, job.durationSeconds - 2 * handling);
      const share = Math.min(1, Math.max(0, (driver.elapsedSeconds - handling) / drive));
      marker.moving = driver.elapsedSeconds > handling && share < 1;
      placeAlong(route, share * route.length, marker);
      count++;
    }
    return count;
  }

  /** Takes over the fleet of a loaded or new game (after the garage): each driver's truck is theirs again. */
  restore(fleet: FleetSaveData): void {
    this.drivers = fleet.drivers.map((saved) => this.fromSave(saved));
    this.jobsPlanned = fleet.jobsPlanned;
    for (const driver of this.drivers) {
      if (driver.truckInstanceId !== null) {
        this.garage.assignDriver(driver.truckInstanceId, driver.definition.id);
      }
    }
  }

  snapshot(): FleetSaveData {
    return {
      jobsPlanned: this.jobsPlanned,
      drivers: this.drivers.map((driver) => ({
        driverId: driver.definition.id,
        truckInstanceId: driver.truckInstanceId,
        cityId: driver.cityId,
        job: driver.job === null ? null : { ...driver.job, elapsedSeconds: driver.elapsedSeconds },
        repairSecondsLeft: driver.repairSecondsLeft,
        jobsCompleted: driver.jobsCompleted,
        creditsEarned: driver.creditsEarned,
      })),
    };
  }

  /** Works `driver` through `seconds`: the workshop, the contract under way, and the next ones. */
  private advance(driver: HiredDriver, seconds: number): void {
    let left = seconds;
    while (left > 1e-9 && driver.truckInstanceId !== null) {
      if (driver.repairSecondsLeft > 0) {
        const used = Math.min(left, driver.repairSecondsLeft);
        driver.repairSecondsLeft = Math.max(0, driver.repairSecondsLeft - used);
        left -= used;
        continue;
      }
      const job = driver.job ?? this.startJob(driver);
      if (job === null) {
        return; // Nowhere to go on this map.
      }
      const used = Math.min(left, job.durationSeconds - driver.elapsedSeconds);
      driver.elapsedSeconds += used;
      left -= used;
      if (driver.elapsedSeconds >= job.durationSeconds - 1e-9) {
        this.finishJob(driver, job);
      }
    }
  }

  /** Plans `driver`'s next contract from where they are (rare: once a contract, so it may allocate). */
  private startJob(driver: HiredDriver): FleetJob | null {
    const market = this.marketNow();
    const truck = this.garage.trucks.find((candidate) => candidate.instanceId === driver.truckInstanceId);
    if (market === null || truck === undefined) {
      return null;
    }
    const job = planFleetJob({
      market,
      fromCityId: driver.cityId,
      truck: truck.definition,
      truckDamage: truck.damage,
      driver: driver.definition,
      rules: this.rules,
      seed: fleetJobSeed(this.jobsPlanned),
    });
    if (job === null) {
      return null;
    }
    this.jobsPlanned++;
    driver.job = job;
    driver.elapsedSeconds = 0;
    driver.route = null;
    return job;
  }

  /** Delivers `job`: the company is paid, the truck may come back damaged and go to the workshop. */
  private finishJob(driver: HiredDriver, job: FleetJob): void {
    const instanceId = driver.truckInstanceId!;
    const profit = fleetJobProfit(job);
    if (profit > 0) {
      this.economy.earn(profit, 'fleet');
    } else if (profit < 0) {
      this.economy.spend(Math.min(-profit, this.economy.credits), 'fleet');
    }
    driver.job = null;
    driver.route = null;
    driver.elapsedSeconds = 0;
    driver.cityId = job.destinationCityId;
    driver.jobsCompleted++;
    driver.creditsEarned += profit;
    if (job.incident) {
      this.garage.wearTruck(instanceId, this.config.incidentDamage);
    }
    const damage = this.garage.trucks.find((truck) => truck.instanceId === instanceId)?.damage ?? 0;
    let repairCost: Credits | null = null;
    if (damage >= this.config.repairAtDamage) {
      const cost = this.economy.repairCost(damage);
      // Without the money for it, the truck goes on as it is: a damaged truck burns more.
      if (this.economy.spend(cost, 'repair').ok) {
        this.garage.mendTruck(instanceId);
        driver.repairSecondsLeft = this.config.repairSeconds;
        repairCost = cost;
      }
    }
    const away = this.away !== null;
    if (this.away !== null) {
      this.away.jobs++;
      this.away.credits += profit - (repairCost ?? 0);
    }
    const driverId = driver.definition.id;
    this.events.emit('FleetJobCompleted', {
      driverId,
      instanceId,
      originCityId: job.originCityId,
      destinationCityId: job.destinationCityId,
      cargoId: job.cargoId,
      pay: job.pay,
      driverShare: job.driverShare,
      fuelCost: job.fuelCost,
      profit,
      incident: job.incident,
      away,
    });
    if (repairCost !== null) {
      this.events.emit('FleetTruckRepaired', { driverId, instanceId, cost: repairCost });
    }
  }

  private takeTruckBack(driver: HiredDriver): void {
    if (driver.truckInstanceId !== null) {
      this.garage.assignDriver(driver.truckInstanceId, null);
    }
    driver.truckInstanceId = null;
    driver.job = null;
    driver.route = null;
    driver.elapsedSeconds = 0;
    driver.repairSecondsLeft = 0;
    driver.cityId = this.homeCityId();
  }

  private status(driver: HiredDriver): FleetDriverStatus {
    const job = driver.job;
    const repairing = driver.repairSecondsLeft > 0;
    return {
      definition: driver.definition,
      truckInstanceId: driver.truckInstanceId,
      activity: driver.truckInstanceId === null ? 'noTruck' : repairing ? 'inWorkshop' : job === null ? 'settingOff' : 'onContract',
      cityId: driver.cityId,
      job,
      progress: repairing
        ? 1 - driver.repairSecondsLeft / this.config.repairSeconds
        : job === null
          ? 0
          : Math.min(1, driver.elapsedSeconds / job.durationSeconds),
      secondsLeft: repairing ? driver.repairSecondsLeft : job === null ? 0 : Math.max(0, job.durationSeconds - driver.elapsedSeconds),
      jobsCompleted: driver.jobsCompleted,
      creditsEarned: driver.creditsEarned,
    };
  }

  private fromSave(saved: HiredDriverSaveData): HiredDriver {
    const { elapsedSeconds, ...job } = saved.job ?? { elapsedSeconds: 0 };
    return {
      definition: this.content.drivers.get(saved.driverId),
      truckInstanceId: saved.truckInstanceId,
      cityId: saved.cityId,
      job: saved.job === null ? null : (job as FleetJob),
      elapsedSeconds,
      repairSecondsLeft: saved.repairSecondsLeft,
      jobsCompleted: saved.jobsCompleted,
      creditsEarned: saved.creditsEarned,
      route: null,
    };
  }

  private find(driverId: string): HiredDriver | undefined {
    return this.drivers.find((driver) => driver.definition.id === driverId);
  }

  /** Where the garage is: the starting city (spec §20's city A), or the first city. */
  private homeCityId(): string {
    const cities = this.content.cities.all;
    return (cities.find((city) => city.specialization === 'starter') ?? cities[0])?.id ?? '';
  }

  /** The cities with a depot on the map being driven, the cargo, and the road between their bays. */
  private marketNow(): FleetMarket | null {
    if (!this.driving.isDriving) {
      return null;
    }
    const world = this.driving.world;
    if (this.market === null || this.marketWorld !== world) {
      const route = createRouteGuidance();
      const distances = new Map<string, number>();
      this.marketWorld = world;
      this.market = {
        cities: this.content.cities.all.filter((city) => world.depotOf(city.id) !== undefined),
        cargo: this.content.cargo.all,
        distanceMeters: (originCityId, destinationCityId) => {
          const key = `${originCityId}>${destinationCityId}`;
          let meters = distances.get(key);
          if (meters === undefined) {
            const from = world.depotOf(originCityId)!.bay;
            const to = world.depotOf(destinationCityId)!.bay;
            meters = world.network.guide(from.x, from.z, to.x, to.z, route).distanceMeters;
            distances.set(key, meters);
          }
          return meters;
        },
      };
      this.trace = createRouteTrace(world.network);
      this.paces = new Float64Array(world.roads.length).fill(1);
    }
    return this.market;
  }

  /** The way `driver`'s contract takes on the map, worked out once (when it starts, or after loading). */
  private routeFor(driver: HiredDriver): FleetRoute | null {
    const job = driver.job;
    if (job === null || this.marketNow() === null) {
      return null;
    }
    const world = this.driving.world;
    const from = world.depotOf(job.originCityId)?.bay;
    const to = world.depotOf(job.destinationCityId)?.bay;
    if (from === undefined || to === undefined) {
      return null;
    }
    const trace = world.network.trace(from.x, from.z, to.x, to.z, this.paces, this.trace!);
    const count = trace.count + 2;
    const x = new Float64Array(count);
    const z = new Float64Array(count);
    const along = new Float64Array(count);
    x[0] = from.x;
    z[0] = from.z;
    x.set(trace.x.subarray(0, trace.count), 1);
    z.set(trace.z.subarray(0, trace.count), 1);
    x[count - 1] = to.x;
    z[count - 1] = to.z;
    for (let i = 1; i < count; i++) {
      along[i] = along[i - 1]! + Math.hypot(x[i]! - x[i - 1]!, z[i]! - z[i - 1]!);
    }
    driver.route = { x, z, along, length: along[count - 1]! };
    return driver.route;
  }
}

/** Puts `marker` `distance` metres along `route`, facing along it. Allocation-free. */
function placeAlong(route: FleetRoute, distance: number, marker: FleetMarker): void {
  const along = route.along;
  const last = along.length - 1;
  let i = 1;
  while (i < last && along[i]! < distance) {
    i++;
  }
  const x0 = route.x[i - 1]!;
  const z0 = route.z[i - 1]!;
  const x1 = route.x[i]!;
  const z1 = route.z[i]!;
  const span = along[i]! - along[i - 1]!;
  const t = span > 1e-9 ? Math.min(1, Math.max(0, (distance - along[i - 1]!) / span)) : 1;
  marker.x = x0 + (x1 - x0) * t;
  marker.z = z0 + (z1 - z0) * t;
  if (Math.abs(x1 - x0) + Math.abs(z1 - z0) > 1e-9) {
    marker.heading = Math.atan2(x1 - x0, z1 - z0);
  }
}
