import type { EventBus } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import { SeededRandom } from '../../core/random/SeededRandom';
import type { GameConfig } from '../../data/config/GameConfig';
import { DebrisSimulation } from '../../domain/crash/DebrisSimulation';
import { KNOCKABLES, knockableCode, knockableKindOf } from '../../domain/crash/knockables';
import { knockThrow, truckSpeedLoss, wreckThrow } from '../../domain/crash/throws';
import { WRECK_DEBRIS_KIND, wreckableOf } from '../../domain/crash/wrecks';
import type { DrivingWorld } from '../../domain/world/DrivingWorld';
import { COLLISION_EVENT_MIN_SPEED, type DrivingService } from '../driving/DrivingService';
import type { GameEvents } from '../GameEvents';
import type { TrafficService } from '../traffic/TrafficService';

/** Seeds the first drive's throws; each later drive takes the next seed. */
const FIRST_SEED = 20260926;
/** What was knocked over stands again, and a wreck is cleared away, only this far from the truck: out of sight. */
export const OUT_OF_SIGHT_METERS = 220;
/** Debris flying into something knocks it like this much mass driving straight at it (a car's). */
const DEBRIS_STRIKER_MASS_KG = 1200;

/**
 * What the truck's crashes leave about (roadmap: fun crashes). When the
 * truck knocks something over (DrivingWorld's knocks) or wrecks a car or a
 * minibus (the traffic's wrecks), it sends it flying as debris, and the
 * truck pays for it: the momentum it gave (DrivingService.knockBack) and,
 * for anything heavier than a bin, a crash as hard as the thing's share
 * (VehicleCollided: damage to it and its cargo). Debris flying into a lamp
 * or a shelter knocks that over too. The truck shoves the debris it drives
 * into. What was knocked over stands again, and wrecks are cleared away,
 * once they have lain `restoreAfterSeconds` and are out of sight.
 *
 * Call update() every fixed step, after DrivingService.step(). Presentation
 * reads `simulation` (and `paintOf` for wrecks) and never writes to it.
 * Allocation-free while nothing gives way.
 */
export class CrashService {
  private debris: DebrisSimulation | null = null;
  private world: DrivingWorld | null = null;
  private random = new SeededRandom(FIRST_SEED);
  private drives = 0;
  /** The last of the world's collision steps whose knocks were taken. */
  private lastCollisionStep = -1;
  /** Each wreck's paint, by debris slot. */
  private paint: Int32Array;
  /** The circles knocked over, and how long each has lain. */
  private readonly knockedCircles: number[] = [];
  private readonly knockedSeconds: number[] = [];
  /** Scratch: what struck the thing being knocked over. */
  private readonly striker = { massKg: 0, vx: 0, vz: 0 };

  constructor(
    private readonly driving: DrivingService,
    private readonly traffic: TrafficService,
    private readonly config: GameConfig['crashes'],
    private readonly events: EventBus<GameEvents>,
    private readonly logger: Logger,
  ) {
    this.paint = new Int32Array(config.maxDebris);
  }

  /** The debris of the current drive; null until the first update of a drive, and while crashes are off. */
  get simulation(): DebrisSimulation | null {
    return this.debris;
  }

  /** The paint (0xRRGGBB) of the wreck in debris slot `slot`. */
  paintOf(slot: number): number {
    return this.paint[slot] ?? 0;
  }

  /** How many things lie knocked over now. */
  get knockedOverCount(): number {
    return this.knockedCircles.length;
  }

  /** Moves the debris on by `dt` seconds, after sending off whatever gave way. Nothing happens while no truck is driven. */
  update(dt: number): void {
    if (!this.config.enabled || !this.driving.isDriving) {
      return;
    }
    const world = this.driving.world;
    if (world !== this.world) {
      this.startDrive(world);
    }
    const debris = this.debris!;
    const knocks = world.knocks;
    if (world.collisionSteps !== this.lastCollisionStep) {
      this.lastCollisionStep = world.collisionSteps;
      this.takeKnocks(world, 0, knocks.count);
    }
    const before = knocks.count;
    debris.step(dt);
    // What the debris knocked over as it flew.
    this.takeKnocks(world, before, knocks.count);
    this.shove(debris);
    this.clearAway(world, debris, dt);
  }

  private startDrive(world: DrivingWorld): void {
    this.world = world;
    this.debris = new DebrisSimulation(this.config.maxDebris, (x, z) => world.hasGround(x, z), world);
    this.paint = new Int32Array(this.config.maxDebris);
    this.random = new SeededRandom(FIRST_SEED + this.drives++);
    this.lastCollisionStep = world.collisionSteps;
    this.knockedCircles.length = 0;
    this.knockedSeconds.length = 0;
  }

  /** Sends off what gave way, knocks `from` to `to` of the world's record. */
  private takeKnocks(world: DrivingWorld, from: number, to: number): void {
    const knocks = world.knocks;
    for (let i = from; i < to; i++) {
      const into = knocks.speed[i]!;
      const nx = knocks.normalX[i]!;
      const nz = knocks.normalZ[i]!;
      if (knocks.circle[i]! >= 0) {
        this.knockOver(world, knocks.circle[i]!, into, nx, nz, knocks.byDebris[i] === 0);
      } else if (knocks.vehicle[i]! >= 0) {
        this.wreck(knocks.vehicle[i]!, into, nx, nz);
      }
    }
  }

  /** Circle `circle`'s thing was knocked over, struck `into` m/s hard along (nx, nz) from it to what struck it. */
  private knockOver(world: DrivingWorld, circle: number, into: number, nx: number, nz: number, byTruck: boolean): void {
    const kind = knockableKindOf(world.circleKind[circle]!);
    if (kind === null) {
      return;
    }
    const thing = world.circleThing(circle);
    if (byTruck) {
      this.truckStriker();
    } else {
      this.striker.massKg = DEBRIS_STRIKER_MASS_KG;
      this.striker.vx = -nx * into;
      this.striker.vz = -nz * into;
    }
    this.debris!.launch(knockThrow(kind, circle, thing, this.striker, into, nx, nz, this.config.throwFactor, this.random));
    this.knockedCircles.push(circle);
    this.knockedSeconds.push(0);
    if (byTruck) {
      const knockable = KNOCKABLES[kind];
      this.strike(knockable.shape.massKg, knockable.damageShare, into, nx, nz);
    }
    this.events.emit('PropKnockedOver', { kind, x: thing.x, z: thing.z, speedMetersPerSecond: into, byTruck });
  }

  /** The traffic's vehicle with circle `circle` was wrecked by the truck driving into it `into` m/s hard. */
  private wreck(circle: number, into: number, nx: number, nz: number): void {
    const traffic = this.traffic.simulation;
    if (traffic === null) {
      return;
    }
    const wrecks = traffic.wrecks;
    let k = 0;
    while (k < wrecks.count && wrecks.circle[k] !== circle) k++;
    const typeIndex = wrecks.type[k]!;
    const type = k < wrecks.count ? traffic.types[typeIndex] : undefined;
    const wreckable = type === undefined ? null : wreckableOf(type);
    if (type === undefined || wreckable === null) {
      this.logger.warn(`No wreck noted for traffic circle ${circle}.`);
      return;
    }
    const vehicle = { x: wrecks.x[k]!, z: wrecks.z[k]!, heading: wrecks.heading[k]!, speed: wrecks.speed[k]! };
    this.truckStriker();
    const slot = this.debris!.launch(
      wreckThrow(type, typeIndex, wreckable, vehicle, this.striker, into, nx, nz, this.config.throwFactor, this.random),
    );
    this.paint[slot] = wrecks.color[k]!;
    this.strike(wreckable.massKg, wreckable.damageShare, into, nx, nz);
    this.events.emit('VehicleWrecked', { x: vehicle.x, z: vehicle.z, speedMetersPerSecond: into, color: wrecks.color[k]! });
  }

  /** The truck, as it strikes: its mass (with its cargo) and velocity (its slide too), into `striker`. */
  private truckStriker(): void {
    const state = this.driving.vehicle;
    const sin = Math.sin(state.heading);
    const cos = Math.cos(state.heading);
    this.striker.massKg = this.driving.totalMassKg;
    this.striker.vx = sin * state.speed + cos * state.slipSpeed;
    this.striker.vz = cos * state.speed - sin * state.slipSpeed;
  }

  /**
   * What knocking a thing of `massKg` out of its way `into` m/s hard (along
   * (nx, nz)) costs the truck: the momentum the thing took, along the way
   * it points (it cannot slide sideways), and a crash `damageShare` as hard.
   */
  private strike(massKg: number, damageShare: number, into: number, nx: number, nz: number): void {
    const state = this.driving.vehicle;
    const along = Math.abs(Math.sin(state.heading) * nx + Math.cos(state.heading) * nz);
    this.driving.knockBack(truckSpeedLoss(this.driving.totalMassKg, massKg, into) * along);
    const impact = into * damageShare;
    if (impact >= COLLISION_EVENT_MIN_SPEED) {
      this.events.emit('VehicleCollided', { impactSpeedMetersPerSecond: impact });
    }
  }

  /** The truck shoves the debris it drives into out of its way. */
  private shove(debris: DebrisSimulation): void {
    const state = this.driving.vehicle;
    const { offsets, radius } = this.driving.footprint;
    const sin = Math.sin(state.heading);
    const cos = Math.cos(state.heading);
    // Its velocity, its slide too.
    const vx = sin * state.speed + cos * state.slipSpeed;
    const vz = cos * state.speed - sin * state.slipSpeed;
    for (let i = 0; i < offsets.length; i++) {
      debris.shove(state.x + sin * offsets[i]!, state.z + cos * offsets[i]!, radius, vx, vz);
    }
  }

  /** Stands what has lain knocked over long enough back up, and clears such wrecks away, out of the truck's sight. */
  private clearAway(world: DrivingWorld, debris: DebrisSimulation, dt: number): void {
    const state = this.driving.vehicle;
    const wait = this.config.restoreAfterSeconds;
    for (let i = this.knockedCircles.length - 1; i >= 0; i--) {
      const seconds = this.knockedSeconds[i]! + dt;
      this.knockedSeconds[i] = seconds;
      const circle = this.knockedCircles[i]!;
      const thing = world.circleThing(circle);
      const body = this.bodyOf(debris, knockableCode(knockableKindOf(world.circleKind[circle]!)!), circle);
      if (
        seconds < wait ||
        !outOfSight(state.x, state.z, thing.x, thing.z) ||
        (body >= 0 && !outOfSight(state.x, state.z, debris.x[body]!, debris.z[body]!))
      ) {
        continue;
      }
      world.restore(circle);
      if (body >= 0) {
        debris.remove(body);
      }
      this.knockedCircles.splice(i, 1);
      this.knockedSeconds.splice(i, 1);
    }
    for (let slot = 0; slot < debris.capacity; slot++) {
      if (
        debris.active[slot] === 1 &&
        debris.kind[slot] === WRECK_DEBRIS_KIND &&
        debris.age[slot]! >= wait &&
        outOfSight(state.x, state.z, debris.x[slot]!, debris.z[slot]!)
      ) {
        debris.remove(slot);
      }
    }
  }

  /** The debris slot holding the body of kind `kind` for `ref`, or -1. */
  private bodyOf(debris: DebrisSimulation, kind: number, ref: number): number {
    for (let slot = 0; slot < debris.capacity; slot++) {
      if (debris.active[slot] === 1 && debris.kind[slot] === kind && debris.ref[slot] === ref) {
        return slot;
      }
    }
    return -1;
  }
}

function outOfSight(truckX: number, truckZ: number, x: number, z: number): boolean {
  return Math.hypot(x - truckX, z - truckZ) > OUT_OF_SIGHT_METERS;
}
