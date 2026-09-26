import { Color, Vector3, type Camera, type Scene } from 'three';
import { clamp } from '../../core/math/scalar';
import { SeededRandom } from '../../core/random/SeededRandom';
import { createParticleSpawn, ParticlePool } from '../effects/ParticlePool';
import type { PrelitMaterials } from '../world/lighting';
import type { TruckView } from './TruckView';

/** What the truck is doing, as the effects need it: filled in by the owner every frame. */
export interface TruckEffectsState {
  /** On the road and not paused: nothing is thrown otherwise. */
  driving: boolean;
  engineRunning: boolean;
  engineRpm: number;
  idleRpm: number;
  maxRpm: number;
  /** The pedal that drives the truck on, 0..1 (the brake pedal in reverse). */
  drivePedal: number;
  /** Along the heading, m/s (negative in reverse). */
  speed: number;
  heading: number;
  /** On grass: the wheels throw dust. */
  offRoad: boolean;
  /** How wet the ground is, 0..1 (WeatherService.wetness): the wheels throw spray off a wet road, and wet ground raises less dust. */
  wetness: number;
}

export function createTruckEffectsState(): TruckEffectsState {
  return {
    driving: false,
    engineRunning: false,
    engineRpm: 0,
    idleRpm: 0,
    maxRpm: 1,
    drivePedal: 0,
    speed: 0,
    heading: 0,
    offRoad: false,
    wetness: 0,
  };
}

/** Puffs in the air at most (the oldest makes way), before the preset's density. */
const CAPACITY = 180;
/** Exhaust: puffs a second idling and at full load, and their colours from light to dark. */
const EXHAUST_IDLE_RATE = 3;
const EXHAUST_LOAD_RATE = 14;
const EXHAUST_IDLE_COLOR = 0xbdbdbd;
const EXHAUST_LOAD_COLOR = 0x3e3e3e;
/** Dust off the road: puffs a second (more the faster), from this speed, m/s. */
const DUST_MIN_SPEED = 1.5;
const DUST_MAX_RATE = 36;
const DUST_COLOR = 0xc4ae88;
/** Spray off a wet road: puffs a second on a soaked one (more the faster), from this speed, m/s. */
const SPRAY_MIN_SPEED = 5;
const SPRAY_MAX_RATE = 44;
const SPRAY_COLOR = 0xd6dde5;

/**
 * What the truck throws into the air (spec §38's weather, felt): exhaust
 * from the stack, a light haze idling and dark puffs under load; dust from
 * the rear wheels off the road, more the faster it goes and less on wet
 * ground; and spray from them on a wet road. One ParticlePool, one draw call
 * while anything is in the air; `density` (the graphics preset's) thins it
 * all out. update() runs every frame and allocates nothing.
 */
export class TruckEffects {
  private readonly pool: ParticlePool;
  private readonly puff = createParticleSpawn();
  private readonly random = new SeededRandom(101);
  private readonly at = new Vector3();
  private readonly color = new Color();
  private readonly dark = new Color();
  private exhaustDue = 0;
  private dustDue = 0;
  private sprayDue = 0;
  private side: 1 | -1 = 1;

  constructor(
    scene: Scene,
    private readonly density: number,
    prelit?: PrelitMaterials,
  ) {
    this.pool = new ParticlePool(scene, Math.max(1, Math.round(CAPACITY * clamp(density, 0, 1))), prelit);
  }

  /** How many puffs are in the air. */
  get count(): number {
    return this.pool.count;
  }

  /**
   * Throws what the truck throws over `deltaSeconds` (0 while paused: all
   * stands still) and moves the puffs already in the air. Call after the
   * truck's view and the camera have moved.
   */
  update(deltaSeconds: number, truck: TruckView, state: Readonly<TruckEffectsState>, camera: Camera): void {
    if (state.driving && deltaSeconds > 0) {
      this.throwExhaust(deltaSeconds, truck, state);
      this.throwFromWheels(deltaSeconds, truck, state);
    }
    this.pool.update(deltaSeconds, camera);
  }

  dispose(): void {
    this.pool.dispose();
  }

  private throwExhaust(deltaSeconds: number, truck: TruckView, state: Readonly<TruckEffectsState>): void {
    if (!state.engineRunning) {
      return;
    }
    const rpm = clamp((state.engineRpm - state.idleRpm) / Math.max(1, state.maxRpm - state.idleRpm), 0, 1);
    const load = clamp(state.drivePedal, 0, 1) * (0.4 + 0.6 * rpm);
    this.exhaustDue += (EXHAUST_IDLE_RATE + EXHAUST_LOAD_RATE * load) * this.density * deltaSeconds;
    if (this.exhaustDue < 1) {
      return;
    }
    const puff = this.puff;
    const random = this.random;
    truck.exhaustOutlet(this.at);
    this.color.setHex(EXHAUST_IDLE_COLOR).lerp(this.dark.setHex(EXHAUST_LOAD_COLOR), load);
    while (this.exhaustDue >= 1) {
      this.exhaustDue -= 1;
      this.setVelocity(state, 0.85, random.range(-0.3, 0.3), 2.2 + 1.6 * load + random.range(0, 0.4));
      puff.x = this.at.x;
      puff.y = this.at.y;
      puff.z = this.at.z;
      puff.startSizeMeters = 0.25;
      puff.endSizeMeters = 1.5 + 1.2 * load;
      puff.lifeSeconds = random.range(1.3, 2);
      puff.color = this.color.getHex();
      puff.opacity = 0.22 + 0.4 * load;
      puff.lift = 0.8;
      puff.drag = 1.6;
      this.pool.spawn(puff);
    }
  }

  private throwFromWheels(deltaSeconds: number, truck: TruckView, state: Readonly<TruckEffectsState>): void {
    const speed = Math.abs(state.speed);
    const random = this.random;
    const puff = this.puff;
    if (state.offRoad && speed > DUST_MIN_SPEED) {
      const dryness = 1 - 0.8 * clamp(state.wetness, 0, 1);
      this.dustDue += Math.min(DUST_MAX_RATE, 6 + speed * 2.2) * dryness * this.density * deltaSeconds;
      while (this.dustDue >= 1) {
        this.dustDue -= 1;
        this.side = this.side === 1 ? -1 : 1;
        truck.behindRearWheel(this.side, this.at);
        this.setVelocity(state, 0.35, this.side * random.range(0.5, 1.6), random.range(1, 2));
        puff.x = this.at.x + random.range(-0.2, 0.2);
        puff.y = this.at.y;
        puff.z = this.at.z + random.range(-0.2, 0.2);
        puff.startSizeMeters = 0.7;
        puff.endSizeMeters = 3.4 + speed * 0.05;
        puff.lifeSeconds = random.range(1.8, 2.6);
        puff.color = DUST_COLOR;
        puff.opacity = Math.min(0.7, 0.4 + speed * 0.03) * dryness;
        puff.lift = 0.3;
        puff.drag = 1.1;
        this.pool.spawn(puff);
      }
    } else {
      this.dustDue = 0;
    }
    if (!state.offRoad && state.wetness > 0.05 && speed > SPRAY_MIN_SPEED) {
      this.sprayDue += state.wetness * Math.min(SPRAY_MAX_RATE, speed * 2.2) * this.density * deltaSeconds;
      while (this.sprayDue >= 1) {
        this.sprayDue -= 1;
        this.side = this.side === 1 ? -1 : 1;
        truck.behindRearWheel(this.side, this.at);
        this.setVelocity(state, 0.6, this.side * random.range(0.3, 1.2), random.range(1.4, 2.6));
        puff.x = this.at.x;
        puff.y = this.at.y;
        puff.z = this.at.z;
        puff.startSizeMeters = 0.5;
        puff.endSizeMeters = 2.4 + speed * 0.03;
        puff.lifeSeconds = random.range(0.8, 1.2);
        puff.color = SPRAY_COLOR;
        puff.opacity = 0.45 * state.wetness;
        puff.lift = -0.8;
        puff.drag = 2;
        this.pool.spawn(puff);
      }
    } else {
      this.sprayDue = 0;
    }
  }

  /**
   * The puff's velocity: `carried` of the truck's, plus `sideways` toward
   * the truck's left (negative: right) and `upward`, m/s.
   */
  private setVelocity(state: Readonly<TruckEffectsState>, carried: number, sideways: number, upward: number): void {
    const sin = Math.sin(state.heading);
    const cos = Math.cos(state.heading);
    const forward = state.speed * carried;
    this.puff.vx = sin * forward + cos * sideways;
    this.puff.vy = upward;
    this.puff.vz = cos * forward - sin * sideways;
  }
}
