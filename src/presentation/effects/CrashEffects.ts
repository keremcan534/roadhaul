import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
  type Camera,
  type Scene,
} from 'three';
import { SeededRandom } from '../../core/random/SeededRandom';
import type { KnockableKind } from '../../domain/crash/knockables';
import type { PrelitMaterials } from '../world/lighting';
import { createParticleSpawn, ParticlePool } from './ParticlePool';

/** Bits in the air or on the ground at most (the oldest make way), and puffs of dust and sparks, before the density. */
const CHIP_CAPACITY = 96;
const PUFF_CAPACITY = 64;
const SPARK_CAPACITY = 96;
/** A bit lies this long before it shrinks away, and shrinks over this long, seconds. */
const CHIP_LIFE_SECONDS = 3.2;
const CHIP_SHRINK_SECONDS = 0.6;
const CHIP_GRAVITY = 9.81;
/** A bit keeps this share of its speed into the ground as it bounces, and of its speed along it. */
const CHIP_BOUNCE = 0.35;
const CHIP_GRIP = 0.6;
/** What each thing breaks into (0xRRGGBB, the first most), and whether metal strikes sparks off it. */
const CHIP_COLORS: Readonly<Record<KnockableKind, readonly number[]>> = {
  lamp: [0x7d858d, 0x3b4148, 0xdfe8ee],
  hayBale: [0xd4b264, 0xc9a24f, 0xe0c67a],
  bench: [0x9a6b3e, 0x7a5230, 0x2e3237],
  // The litter in it goes everywhere.
  bin: [0xe8e4da, 0x2f5a3a, 0xc7372f, 0xe0b235, 0xf2f2ee],
  busStop: [0x86a7bb, 0xcfe0ea, 0x3a3f45, 0x9aa3ab],
  speedSign: [0xf2f2ee, 0xc7372f, 0x6e757d],
};
const METAL: Readonly<Record<KnockableKind, boolean>> = {
  lamp: true,
  hayBale: false,
  bench: false,
  bin: true,
  busStop: true,
  speedSign: true,
};
const WRECK_GLASS = [0xcfe3ef, 0xe6f1f7, 0x9fb8c6] as const;
const WRECK_TRIM = 0x222326;
const DUST = 0xb9a88a;
const STRAW_DUST = 0xd9c48a;
const SPARK = [0xffd27a, 0xffb347, 0xfff1c2] as const;

/**
 * What flies off in a crash (CrashService's events): a burst of bits —
 * glass, paint, splinters, straw, the litter out of a bin — tumbling off
 * the way the truck struck, bouncing and lying a moment before they shrink
 * away; sparks off metal; and a puff of dust. The bits are one instanced
 * mesh of little boxes, the dust and the sparks one pool of puffs each:
 * three draw calls at most, none while nothing flies. Seeded, and
 * allocation-free after construction.
 */
export class CrashEffects {
  private readonly dust: ParticlePool;
  private readonly sparks: ParticlePool;
  private readonly chips: InstancedMesh;
  private readonly geometry = new BoxGeometry(1, 1, 1);
  private readonly material = new MeshLambertMaterial();
  private readonly random = new SeededRandom(53);
  private readonly puff = createParticleSpawn();
  private readonly color = new Color();
  // Per bit: position, velocity, spin axis and rate, turn, size, age.
  private readonly state: Float32Array;
  private readonly capacity: number;
  private next = 0;
  private live = 0;
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly axis = new Vector3();
  private readonly turn = new Quaternion();
  private readonly scale = new Vector3();

  /**
   * @param density The preset's share of puffs (rendering.particleDensity): fewer bits and puffs on weak devices.
   */
  constructor(
    scene: Scene,
    private readonly density: number,
    prelit?: PrelitMaterials,
  ) {
    const share = Math.max(0.25, density);
    this.capacity = Math.max(16, Math.round(CHIP_CAPACITY * share));
    this.state = new Float32Array(this.capacity * STRIDE).fill(0);
    for (let i = 0; i < this.capacity; i++) {
      this.state[i * STRIDE + AGE] = Infinity;
    }
    this.chips = new InstancedMesh(this.geometry, this.material, this.capacity);
    this.chips.name = 'crash:bits';
    this.chips.instanceMatrix.setUsage(DynamicDrawUsage);
    this.chips.count = 0;
    this.chips.visible = false;
    // The bits fly about wherever the crash was: bounds computed once would go stale.
    this.chips.frustumCulled = false;
    this.chips.setColorAt(0, this.color.setHex(0xffffff));
    scene.add(this.chips);
    this.dust = new ParticlePool(scene, Math.round(PUFF_CAPACITY * share), prelit);
    // Sparks shine by themselves: not darkened with the light.
    this.sparks = new ParticlePool(scene, Math.round(SPARK_CAPACITY * share));
  }

  /**
   * `kind` was knocked over where it stood (x, z), struck `speed` m/s hard
   * by something heading `heading` (radians, 0 toward +z): its bits fly on
   * that way, with sparks off metal and a puff of dust.
   */
  knock(kind: KnockableKind, x: number, z: number, speed: number, heading: number): void {
    const colors = CHIP_COLORS[kind];
    const bits = Math.round(Math.min(18, 4 + speed * 0.8) * this.share());
    for (let i = 0; i < bits; i++) {
      const color = colors[i % colors.length]!;
      this.chip(x, 0.6, z, speed, heading, 0.14 + this.random.next() * 0.22, color);
    }
    if (METAL[kind]) {
      this.sparkle(x, 0.5, z, speed, heading, Math.round(Math.min(24, speed * 1.5) * this.share()));
    }
    this.raiseDust(x, z, kind === 'hayBale' ? STRAW_DUST : DUST, kind === 'hayBale' ? 8 : 4);
  }

  /** A car or minibus in `paint` was wrecked at (x, z) by the truck heading `heading`, `speed` m/s into it. */
  wreck(x: number, z: number, speed: number, heading: number, paint: number): void {
    const bits = Math.round(Math.min(40, 12 + speed * 1.4) * this.share());
    for (let i = 0; i < bits; i++) {
      // Glass most of all, then its paint and its trim.
      const pick = i % 5;
      const color = pick < 3 ? WRECK_GLASS[i % WRECK_GLASS.length]! : pick === 3 ? paint : WRECK_TRIM;
      const size = pick < 3 ? 0.1 + this.random.next() * 0.14 : 0.18 + this.random.next() * 0.28;
      this.chip(x, 0.9, z, speed, heading, size, color);
    }
    this.sparkle(x, 0.5, z, speed, heading, Math.round(Math.min(40, 10 + speed * 2) * this.share()));
    this.raiseDust(x, z, DUST, 7);
  }

  /** Moves the bits, dust and sparks on by `deltaSeconds` (0 holds them still), the puffs turned to face `camera`. */
  update(deltaSeconds: number, camera: Camera): void {
    this.dust.update(deltaSeconds, camera);
    this.sparks.update(deltaSeconds, camera);
    if (this.live === 0) {
      return;
    }
    const s = this.state;
    let drawn = 0;
    let live = 0;
    for (let c = 0; c < this.capacity; c++) {
      const i = c * STRIDE;
      if (!(s[i + AGE]! < CHIP_LIFE_SECONDS)) {
        continue;
      }
      live++;
      if (deltaSeconds > 0) {
        this.move(i, deltaSeconds);
      }
      const age = s[i + AGE]!;
      if (age >= CHIP_LIFE_SECONDS) {
        continue;
      }
      const shrink = Math.min(1, (CHIP_LIFE_SECONDS - age) / CHIP_SHRINK_SECONDS);
      const size = s[i + SIZE]! * shrink;
      this.axis.set(s[i + AX]!, s[i + AY]!, s[i + AZ]!);
      this.turn.setFromAxisAngle(this.axis, s[i + ANGLE]!);
      // Flat bits: a sliver of glass, a flake of paint, a strand of straw.
      this.scale.set(size, size * 0.4, size * 0.75);
      this.position.set(s[i + X]!, s[i + Y]!, s[i + Z]!);
      this.chips.setMatrixAt(drawn, this.matrix.compose(this.position, this.turn, this.scale));
      this.chips.setColorAt(drawn, this.color.setRGB(s[i + R]!, s[i + G]!, s[i + B]!));
      drawn++;
    }
    this.live = live;
    this.chips.count = drawn;
    this.chips.visible = drawn > 0;
    if (drawn > 0) {
      this.chips.instanceMatrix.needsUpdate = true;
      this.chips.instanceColor!.needsUpdate = true;
    }
  }

  dispose(): void {
    this.chips.removeFromParent();
    this.chips.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.dust.dispose();
    this.sparks.dispose();
  }

  /** The share of bits and puffs the device can take. */
  private share(): number {
    return Math.max(0.25, Math.min(1, this.density));
  }

  /** Throws a bit `size` across from (x, y, z), off the way `heading` points at up to `speed`, spinning. */
  private chip(x: number, y: number, z: number, speed: number, heading: number, size: number, color: number): void {
    const random = this.random;
    const s = this.state;
    const i = this.next * STRIDE;
    this.next = (this.next + 1) % this.capacity;
    // Mostly the way the truck struck, spread about it.
    const way = heading + random.range(-0.9, 0.9);
    const fling = speed * random.range(0.25, 0.8) + random.range(0.5, 2);
    s[i + X] = x + random.range(-0.4, 0.4);
    s[i + Y] = y + random.range(0, 0.6);
    s[i + Z] = z + random.range(-0.4, 0.4);
    s[i + VX] = Math.sin(way) * fling;
    // Up high enough to be seen over a truck's box from behind it.
    s[i + VY] = random.range(3, 6) + speed * random.range(0.15, 0.35);
    s[i + VZ] = Math.cos(way) * fling;
    this.axis.set(random.range(-1, 1), random.range(-1, 1), random.range(-1, 1)).normalize();
    s[i + AX] = this.axis.x;
    s[i + AY] = this.axis.y;
    s[i + AZ] = this.axis.z;
    s[i + SPIN] = random.range(6, 18);
    s[i + ANGLE] = random.range(0, Math.PI * 2);
    s[i + SIZE] = size;
    s[i + AGE] = 0;
    this.color.setHex(color);
    s[i + R] = this.color.r;
    s[i + G] = this.color.g;
    s[i + B] = this.color.b;
    this.live++;
  }

  /** Bit `i` flies, falls and bounces on the ground, spinning until it lies still. */
  private move(i: number, dt: number): void {
    const s = this.state;
    s[i + AGE] = s[i + AGE]! + dt;
    const half = s[i + SIZE]! * 0.2;
    const resting = s[i + Y]! <= half + 1e-3 && Math.abs(s[i + VY]!) < 0.4;
    if (!resting) {
      s[i + VY] = s[i + VY]! - CHIP_GRAVITY * dt;
      s[i + ANGLE] = s[i + ANGLE]! + s[i + SPIN]! * dt;
    }
    s[i + X] = s[i + X]! + s[i + VX]! * dt;
    s[i + Y] = s[i + Y]! + s[i + VY]! * dt;
    s[i + Z] = s[i + Z]! + s[i + VZ]! * dt;
    if (s[i + Y]! < half) {
      s[i + Y] = half;
      s[i + VY] = -s[i + VY]! * CHIP_BOUNCE;
      s[i + VX] = s[i + VX]! * CHIP_GRIP;
      s[i + VZ] = s[i + VZ]! * CHIP_GRIP;
      s[i + SPIN] = s[i + SPIN]! * 0.5;
      if (Math.abs(s[i + VY]!) < 0.4) {
        s[i + VY] = 0;
        s[i + VX] = s[i + VX]! * 0.5;
        s[i + VZ] = s[i + VZ]! * 0.5;
      }
    }
  }

  /** `count` sparks off (x, y, z), sprayed the way `heading` points and up, falling as they fade. */
  private sparkle(x: number, y: number, z: number, speed: number, heading: number, count: number): void {
    const random = this.random;
    const puff = this.puff;
    for (let n = 0; n < count; n++) {
      const way = heading + random.range(-1.3, 1.3);
      const fling = speed * random.range(0.3, 0.9) + random.range(1, 4);
      puff.x = x;
      puff.y = y + random.range(0, 0.5);
      puff.z = z;
      puff.vx = Math.sin(way) * fling;
      puff.vy = random.range(1.5, 5);
      puff.vz = Math.cos(way) * fling;
      puff.startSizeMeters = random.range(0.22, 0.42);
      puff.endSizeMeters = 0.06;
      puff.lifeSeconds = random.range(0.3, 0.7);
      puff.color = SPARK[n % SPARK.length]!;
      puff.opacity = 1;
      puff.lift = -9;
      puff.drag = 1.5;
      this.sparks.spawn(puff);
    }
  }

  /** A puff of dust `count` strong round (x, z), in `color`, spreading low. */
  private raiseDust(x: number, z: number, color: number, count: number): void {
    const random = this.random;
    const puff = this.puff;
    const puffs = Math.max(2, Math.round(count * this.share()));
    for (let n = 0; n < puffs; n++) {
      const way = random.range(0, Math.PI * 2);
      const drift = random.range(0.5, 2.5);
      puff.x = x + random.range(-0.8, 0.8);
      puff.y = random.range(0.2, 0.8);
      puff.z = z + random.range(-0.8, 0.8);
      puff.vx = Math.sin(way) * drift;
      puff.vy = random.range(0.3, 1);
      puff.vz = Math.cos(way) * drift;
      puff.startSizeMeters = 1.2;
      puff.endSizeMeters = random.range(4, 6);
      puff.lifeSeconds = random.range(1.6, 2.4);
      puff.color = color;
      puff.opacity = 0.6;
      puff.lift = 0.25;
      puff.drag = 1.4;
      this.dust.spawn(puff);
    }
  }
}

// Offsets into a bit's slice of the state array.
const X = 0;
const Y = 1;
const Z = 2;
const VX = 3;
const VY = 4;
const VZ = 5;
const AX = 6;
const AY = 7;
const AZ = 8;
const SPIN = 9;
const ANGLE = 10;
const SIZE = 11;
const AGE = 12;
const R = 13;
const G = 14;
const B = 15;
const STRIDE = 16;
