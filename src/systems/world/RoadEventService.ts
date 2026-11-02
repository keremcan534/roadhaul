import type { EventBus, Unsubscribe } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import type { Clock } from '../../core/time/Clock';
import type { GameConfig } from '../../data/config/GameConfig';
import type { Credits } from '../../data/units';
import { localDay } from '../../domain/rewards/dailyReward';
import type { RoadEventsSaveData } from '../../domain/save/SaveGameData';
import { createRoadSpot, pickRoadSpot } from '../../domain/world/cityIncidents';
import { RED_LIGHT, signalLight, stopLineCrossed, type TrafficSignals } from '../../domain/traffic/trafficSignals';
import type { DrivingWorld } from '../../domain/world/DrivingWorld';
import { workZonesForDay, type WorkZone } from '../../domain/world/workZones';
import type { EconomyService } from '../economy/EconomyService';
import type { GameEvents } from '../GameEvents';
import type { CompanyLevelSource } from '../missions/MissionService';

/** A camera ahead is shown this far off, meters, if it is roughly where the truck heads (the cosine of the angle). */
const AHEAD_METERS = 400;
const AHEAD_COSINE = 0.9;
/** Cameras are counted 0 up; a work zone's mobile camera from this on, so the two never share a number. */
const ZONE_CAMERA_BASE = 10_000;
/** No room for a stranded driver ahead: tried again after this long, seconds. */
const STRANDED_RETRY_SECONDS = 30;
/** The stranded car stands this far out from the road's edge, on the shoulder. */
const STRANDED_OUT_METERS = 1.8;

/** What the road's events read of the drive: DrivingService. */
export interface RoadEventDriving {
  readonly isDriving: boolean;
  readonly vehicle: { readonly x: number; readonly z: number; readonly y: number; readonly heading: number; readonly speed: number };
  readonly world: DrivingWorld;
}

/** A stranded driver waiting by the road: their car on the shoulder, facing along the road. */
/** The traffic's lights (TrafficService): where they are on a world, and the time they keep. */
export interface RoadSignals {
  signalsOf(world: DrivingWorld): TrafficSignals | null;
  /** Seconds; null while no traffic is simulated. */
  readonly signalSeconds: number | null;
}

/** A light red this long already, seconds, before a truck crossing its line runs it: the end of amber is forgiven. */
const RED_GRACE_SECONDS = 1.5;

export interface StrandedDriver {
  x: number;
  z: number;
  heading: number;
}

/** What the safe-driving bonus paid for the delivery just made, credits (0 for none). */
export interface SafeDelivery {
  readonly pay: Credits;
}

/**
 * The road's events (spec: more to the drive than the contract).
 *
 * - Speed cameras (DrivingWorld.speedCameras) check every truck passing at
 *   its road's limit (GameConfig.traffic.speedLimitsKmh); over by more than
 *   the tolerance, the first time ever a warning, after that a fine, paid at
 *   once (never more than the company has).
 * - The day's road works (workZonesForDay, a new set each day of the
 *   player's calendar) on the main roads: a lower limit, a mobile camera in
 *   the middle whose fines are doubled, and the GPS going round them where
 *   another way is not much longer (RoadNetwork.setDetour).
 * - Now and then a stranded driver waits ahead with the hazard lights on:
 *   stopping beside them a few seconds helps, for a reward.
 * - A contract delivered without a fine or a knock pays a safe-driving
 *   bonus on top (`lastDelivery`, for the receipt).
 *
 * Call update() every fixed step while the truck is on the road. Allocation
 * free but when the day's works change or a stranded driver appears.
 */
export class RoadEventService {
  private world: DrivingWorld | null = null;
  private zones: readonly WorkZone[] = [];
  private zonesDay = Number.NaN;
  private warned = false;
  private redLightWarned = false;
  private fined = false;
  /** The truck's last place, for the stop lines it crosses; NaN before its first step on a world. */
  private lastX = Number.NaN;
  private lastZ = Number.NaN;
  private knocked = false;
  /** The camera the truck is passing (its number, see ZONE_CAMERA_BASE), -1 for none: each judges a pass once. */
  private passing = -1;
  private aheadLimit = 0;
  private aheadMeters = -1;
  private aheadWorks = false;
  private zoneLimit = 0;
  private readonly strandedCar: StrandedDriver = { x: 0, z: 0, heading: 0 };
  private strandedActive = false;
  private strandedLeft = 0;
  private helping = 0;
  private untilStranded: number;
  /** A stranded driver asked for now (sendStrandedDriver): sent at the next step on the road. */
  private strandedAsked = false;
  private readonly spot = createRoadSpot();
  private last: SafeDelivery = { pay: 0 };
  private readonly unsubscribe: Unsubscribe[];

  constructor(
    private readonly driving: RoadEventDriving,
    private readonly economy: EconomyService,
    private readonly company: CompanyLevelSource,
    private readonly clock: Clock,
    private readonly localOffsetMinutes: number,
    private readonly config: GameConfig['roadEvents'],
    private readonly speedLimitsKmh: GameConfig['traffic']['speedLimitsKmh'],
    /** Uniform in [0, 1): a seeded generator in tests. */
    private readonly random: () => number,
    private readonly events: EventBus<GameEvents>,
    private readonly logger: Logger,
    /** The traffic's lights; absent: no lights watched. */
    private readonly signals: RoadSignals | null = null,
  ) {
    this.untilStranded = config.strandedFirstSeconds;
    this.unsubscribe = [
      events.on('MissionStateChanged', ({ previous }) => {
        if (previous === null) {
          this.fined = false;
          this.knocked = false;
        }
      }),
      events.on('VehicleDamaged', () => {
        this.knocked = true;
      }),
      // After the economy: the delivery is paid first, this on top.
      events.on('MissionCompleted', ({ reward }) => {
        const clean = !this.fined && !this.knocked;
        const pay = clean ? Math.round((reward.total * this.config.safeDrivingShare) / 10) * 10 : 0;
        if (pay > 0) {
          this.economy.earn(pay, 'safeDriving');
        }
        this.last = { pay };
        this.fined = false;
        this.knocked = false;
      }),
      events.on('MissionFailed', () => {
        this.fined = false;
        this.knocked = false;
      }),
      // A company started or continued from the main menu: the day's works laid again, the stranded driver gone.
      events.on('GameStateChanged', ({ previous, current }) => {
        if (previous === 'mainMenu' && current === 'driving') {
          this.zonesDay = Number.NaN;
          this.strandedActive = false;
          this.untilStranded = this.config.strandedFirstSeconds;
          this.passing = -1;
          this.lastX = Number.NaN;
        }
      }),
    ];
  }

  /** The day's road works on this map. */
  get workZones(): readonly WorkZone[] {
    return this.zones;
  }

  /** The limit of the camera (or road works) ahead, km/h, and how far it is, meters; -1 for none near. */
  get cameraAheadLimitKmh(): number {
    return this.aheadLimit;
  }

  get cameraAheadMeters(): number {
    return this.aheadMeters;
  }

  /** Whether what is ahead is road works (their camera), not a fixed camera. */
  get cameraAheadIsWorks(): boolean {
    return this.aheadWorks;
  }

  /** The road works' limit while the truck is in them, km/h; 0 elsewhere. */
  get workZoneLimitKmh(): number {
    return this.zoneLimit;
  }

  /** The stranded driver waiting ahead, or null. The same object each time, moved. */
  get stranded(): Readonly<StrandedDriver> | null {
    return this.strandedActive ? this.strandedCar : null;
  }

  /** What the safe-driving bonus paid for the delivery just made. */
  get lastDelivery(): SafeDelivery {
    return this.last;
  }

  /** Sends a stranded driver at the next step on the road (`?road=stranded`), ahead of the truck. */
  sendStrandedDriver(): void {
    this.strandedAsked = true;
  }

  /** A fixed step with the truck on the road. */
  update(stepSeconds: number): void {
    if (!this.driving.isDriving) {
      return;
    }
    const world = this.driving.world;
    if (world !== this.world) {
      this.world = world;
      this.zonesDay = Number.NaN;
      this.passing = -1;
      this.strandedActive = false;
      this.lastX = Number.NaN;
    }
    const day = localDay(this.clock.now(), this.localOffsetMinutes);
    if (day !== this.zonesDay) {
      this.layWorks(world, day);
    }
    const truck = this.driving.vehicle;
    const speedKmh = Math.abs(truck.speed) * 3.6;
    const headingX = Math.sin(truck.heading);
    const headingZ = Math.cos(truck.heading);
    const reach = this.config.cameraReachMeters;
    let passing = -1;
    this.aheadLimit = 0;
    this.aheadMeters = -1;
    this.aheadWorks = false;
    // The fixed cameras: judged once a pass, as the truck comes within reach of the road beside them.
    const cameras = world.speedCameras;
    for (let i = 0; i < cameras.length; i++) {
      const camera = cameras[i]!;
      const dx = camera.roadX - truck.x;
      const dz = camera.roadZ - truck.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      const limit = this.speedLimitsKmh[world.roads[camera.roadIndex]!.kind];
      if (distance < reach) {
        passing = i;
        if (this.passing !== i) {
          this.judge(speedKmh, limit, false);
        }
      }
      this.lookAhead(dx, dz, distance, headingX, headingZ, limit, distance, false);
    }
    // The road works: their limit inside, their mobile camera in the middle.
    this.zoneLimit = 0;
    for (let i = 0; i < this.zones.length; i++) {
      const zone = this.zones[i]!;
      const dx = zone.x - truck.x;
      const dz = zone.z - truck.z;
      const sin = Math.sin(zone.heading);
      const cos = Math.cos(zone.heading);
      const along = Math.abs(dx * sin + dz * cos);
      const across = Math.abs(dx * cos - dz * sin);
      const width = world.roads[zone.roadIndex]!.widthMeters;
      if (across < width / 2 + 3 && along < zone.halfLengthMeters) {
        this.zoneLimit = this.config.workZoneLimitKmh;
        if (along < reach) {
          passing = ZONE_CAMERA_BASE + i;
          if (this.passing !== passing) {
            this.judge(speedKmh, this.config.workZoneLimitKmh, true);
          }
        }
      }
      // Ahead: shown from the works' start.
      const toStart = Math.max(0, Math.sqrt(dx * dx + dz * dz) - zone.halfLengthMeters);
      this.lookAhead(dx, dz, Math.sqrt(dx * dx + dz * dz), headingX, headingZ, this.config.workZoneLimitKmh, toStart, true);
    }
    this.passing = passing;
    this.watchLights(world, truck.x, truck.z, truck.y);
    this.updateStranded(world, stepSeconds);
  }

  /** The truck moving to (x, z) at height y: over a stop line whose light has been red a while, it ran it. */
  private watchLights(world: DrivingWorld, x: number, z: number, y: number): void {
    const lastX = this.lastX;
    const lastZ = this.lastZ;
    this.lastX = x;
    this.lastZ = z;
    const signals = this.signals?.signalsOf(world) ?? null;
    const seconds = this.signals?.signalSeconds ?? null;
    if (signals === null || seconds === null || Number.isNaN(lastX)) {
      return;
    }
    const crossed = stopLineCrossed(signals.stopLines, lastX, lastZ, x, z, y);
    if (crossed < 0) {
      return;
    }
    const group = signals.stopLines[crossed]!.group;
    if (signalLight(seconds, group) === RED_LIGHT && signalLight(seconds - RED_GRACE_SECONDS, group) === RED_LIGHT) {
      this.ranRedLight();
    }
  }

  /** A red light run: a warning the first time ever, else the fine (never more than the company has). */
  private ranRedLight(): void {
    if (!this.redLightWarned) {
      this.redLightWarned = true;
      this.events.emit('RedLightCaught', { fine: 0, warning: true });
      return;
    }
    const paid = Math.min(this.config.redLightFine, this.economy.credits);
    if (paid > 0) {
      this.economy.spend(paid, 'fine');
    }
    this.fined = true;
    this.logger.info(`Ran a red light: ${paid}.`);
    this.events.emit('RedLightCaught', { fine: paid, warning: false });
  }

  snapshot(): RoadEventsSaveData {
    return { warned: this.warned, redLightWarned: this.redLightWarned, fined: this.fined, knocked: this.knocked };
  }

  restore(data: RoadEventsSaveData): void {
    this.warned = data.warned;
    this.redLightWarned = data.redLightWarned;
    this.fined = data.fined;
    this.knocked = data.knocked;
    this.last = { pay: 0 };
    this.passing = -1;
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribe) {
      unsubscribe();
    }
  }

  /** Over the limit by more than the tolerance: a warning the first time ever, else a fine. */
  private judge(speedKmh: number, limitKmh: number, workZone: boolean): void {
    const { toleranceShare, toleranceKmh, fineBase, finePerKmh, fineMost } = this.config;
    if (speedKmh <= limitKmh * (1 + toleranceShare) + toleranceKmh) {
      return;
    }
    const caught = { speedKmh: Math.round(speedKmh), limitKmh, workZone };
    if (!this.warned) {
      this.warned = true;
      this.events.emit('SpeedingCaught', { ...caught, fine: 0, warning: true });
      return;
    }
    const over = speedKmh - limitKmh;
    const fine = Math.min(fineMost, Math.round((fineBase + finePerKmh * over) / 10) * 10) * (workZone ? 2 : 1);
    // Never more than the company has: no debt.
    const paid = Math.min(fine, this.economy.credits);
    if (paid > 0) {
      this.economy.spend(paid, 'fine');
    }
    this.fined = true;
    this.logger.info(`Caught at ${caught.speedKmh} km/h in a ${limitKmh}: ${paid}.`);
    this.events.emit('SpeedingCaught', { ...caught, fine: paid, warning: false });
  }

  /** A camera (or works) `distance` off along (dx, dz): the nearest roughly ahead is shown. */
  private lookAhead(
    dx: number,
    dz: number,
    distance: number,
    headingX: number,
    headingZ: number,
    limitKmh: number,
    shownMeters: number,
    works: boolean,
  ): void {
    if (distance > AHEAD_METERS || distance < 1e-6 || (dx * headingX + dz * headingZ) / distance < AHEAD_COSINE) {
      return;
    }
    if (this.aheadMeters < 0 || shownMeters < this.aheadMeters) {
      this.aheadMeters = shownMeters;
      this.aheadLimit = limitKmh;
      this.aheadWorks = works;
    }
  }

  private layWorks(world: DrivingWorld, day: number): void {
    this.zonesDay = day;
    this.zones = world.speedCameras.length === 0 ? [] : workZonesForDay(world, day, this.config.workZonesPerDay, world.speedCameras);
    world.network.setDetour(
      this.zones.map((zone) => zone.nodes),
      this.config.workZoneDetourMeters,
    );
    this.passing = -1;
    this.logger.debug(`Road works today: ${this.zones.length}.`);
    this.events.emit('WorkZonesChanged', { count: this.zones.length });
  }

  private updateStranded(world: DrivingWorld, stepSeconds: number): void {
    const truck = this.driving.vehicle;
    const config = this.config;
    if (this.strandedAsked && !this.strandedActive) {
      this.strandedAsked = false;
      this.untilStranded = 0;
    }
    if (!this.strandedActive) {
      this.untilStranded -= stepSeconds;
      if (this.untilStranded > 0) {
        return;
      }
      const [near, far] = config.strandedAheadMeters;
      if (!pickRoadSpot(world.roads, truck.x, truck.z, truck.heading, near, far, this.random(), this.spot)) {
        this.untilStranded = STRANDED_RETRY_SECONDS;
        return;
      }
      const spot = this.spot;
      const out = spot.halfWidthMeters + STRANDED_OUT_METERS;
      this.strandedCar.x = spot.x - spot.directionZ * out;
      this.strandedCar.z = spot.z + spot.directionX * out;
      this.strandedCar.heading = Math.atan2(spot.directionX, spot.directionZ);
      this.strandedActive = true;
      this.strandedLeft = config.strandedSeconds;
      this.helping = 0;
      this.events.emit('StrandedDriverAppeared', { x: this.strandedCar.x, z: this.strandedCar.z });
      return;
    }
    const dx = this.strandedCar.x - truck.x;
    const dz = this.strandedCar.z - truck.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    this.strandedLeft -= stepSeconds;
    if (this.strandedLeft <= 0 || distance > config.strandedBehindMeters + config.strandedAheadMeters[1]) {
      this.endStranded();
      return;
    }
    if (distance < config.helpMeters && Math.abs(truck.speed) < config.helpSpeed) {
      this.helping += stepSeconds;
      if (this.helping >= config.helpSeconds) {
        const reward = config.helpReward + config.helpRewardPerLevel * Math.max(0, this.company.level - 1);
        this.economy.earn(reward, 'roadside');
        this.events.emit('RoadsideHelped', { reward });
        this.endStranded();
      }
    } else {
      this.helping = 0;
    }
  }

  private endStranded(): void {
    this.strandedActive = false;
    const [least, most] = this.config.strandedGapSeconds;
    this.untilStranded = least + (most - least) * this.random();
  }
}
