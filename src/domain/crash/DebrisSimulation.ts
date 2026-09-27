/**
 * Loose things tumbling about after a crash: the props the truck knocks
 * over and the cars it wrecks. Each is a box (half extents, a mass, how
 * bouncy and how rough it is) that falls under gravity, bounces off the
 * ground (y = 0), slides, rolls and tips onto a face, then settles and
 * sleeps. Over water there is no ground: it sinks and is gone.
 *
 * The ground's push acts at the middle of the corners that dig into it, so
 * a box landing on a corner tips over it, one on an edge rolls onto a face,
 * and one on a face stays put. Low down, bodies bounce off the solid things
 * standing about (`DebrisSolids`: trees, posts, buildings), spinning off
 * them where they strike. No body collides with another; the truck shoves
 * them (`shove`). Deterministic and allocation-free: flat arrays, stepped
 * at the fixed step, with each body's pose before the last step kept for
 * drawing between steps.
 */

/** A body's shape and stuff: half extents (meters), mass, bounce and grip. */
export interface DebrisShape {
  readonly halfX: number;
  readonly halfY: number;
  readonly halfZ: number;
  readonly massKg: number;
  /** Share of the speed into the ground it bounces back with, 0..1. */
  readonly restitution: number;
  /** Friction against the ground. */
  readonly friction: number;
}

/** Where a body starts and how it is sent off: world position, heading (0 faces +z), velocity, spin (rad/s, world axes). */
export interface DebrisLaunch {
  /** What the body is, for whoever draws it (a kind of prop, a car's model). */
  readonly kind: number;
  /** The caller's own reference (a prop's index, a car's paint): kept with the body. */
  readonly ref: number;
  readonly shape: DebrisShape;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly heading: number;
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  readonly spinX: number;
  readonly spinY: number;
  readonly spinZ: number;
}

/** Where a circle overlapping something solid gets out: the way out (a unit normal on the ground) and how far. */
export interface SolidContact {
  normalX: number;
  normalZ: number;
  depth: number;
}

/** The solid things standing about, which debris low down bounces off. */
export interface DebrisSolids {
  /**
   * Whether a circle of `radius` round (x, z), moving at (vx, vz), strikes
   * something solid; if so, writes the way out into `out`. Allocation-free.
   */
  collideDebris(x: number, z: number, radius: number, vx: number, vz: number, out: SolidContact): boolean;
}

export const DEBRIS_GRAVITY = 9.81;
/** Air drag on speed and spin, per second. */
const LINEAR_DRAG = 0.05;
const ANGULAR_DRAG = 0.2;
/** Spin never grows past this, rad/s: it keeps the step stable. */
const MAX_SPIN = 30;
/** A body this slow and still this long rests, and sleeps until shoved. */
const SLEEP_SPEED = 0.25;
const SLEEP_SPIN = 0.4;
const SLEEP_SECONDS = 0.6;
/** A body that sinks this far below the ground (into water) is gone. */
const SUNK_DEPTH = 3;
/** Solid things are this tall: debris flying higher passes over them. */
const SOLIDS_HEIGHT = 4;
/** Bodies bounce off solid things this much (their share of the speed into them). */
const SOLID_RESTITUTION = 0.3;

/** The eight corners of a box, as signs of its half extents. */
const CORNER_SIGNS = [
  [-1, -1, -1],
  [1, -1, -1],
  [-1, 1, -1],
  [1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [-1, 1, 1],
  [1, 1, 1],
] as const;

export class DebrisSimulation {
  /** Whether each slot holds a body. */
  readonly active: Uint8Array;
  /** Whether each body rests (asleep until shoved). */
  readonly resting: Uint8Array;
  readonly kind: Int32Array;
  readonly ref: Float64Array;
  /** Position of each body's middle. */
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly z: Float64Array;
  /** Each body's turn, a unit quaternion. */
  readonly qx: Float64Array;
  readonly qy: Float64Array;
  readonly qz: Float64Array;
  readonly qw: Float64Array;
  readonly halfX: Float64Array;
  readonly halfY: Float64Array;
  readonly halfZ: Float64Array;
  /** Seconds since each body was launched. */
  readonly age: Float64Array;
  /** Each body's pose before the last step, for drawing between steps. */
  readonly previousX: Float64Array;
  readonly previousY: Float64Array;
  readonly previousZ: Float64Array;
  readonly previousQx: Float64Array;
  readonly previousQy: Float64Array;
  readonly previousQz: Float64Array;
  readonly previousQw: Float64Array;
  private readonly vx: Float64Array;
  private readonly vy: Float64Array;
  private readonly vz: Float64Array;
  private readonly wx: Float64Array;
  private readonly wy: Float64Array;
  private readonly wz: Float64Array;
  private readonly inverseMass: Float64Array;
  /** Inverse inertia about the body's own axes. */
  private readonly inverseInertiaX: Float64Array;
  private readonly inverseInertiaY: Float64Array;
  private readonly inverseInertiaZ: Float64Array;
  private readonly restitution: Float64Array;
  private readonly friction: Float64Array;
  private readonly stillSeconds: Float64Array;
  private activeCount = 0;
  /** The corners digging into the ground this step, from the body's middle. */
  private readonly touchX = new Float64Array(8);
  private readonly touchY = new Float64Array(8);
  private readonly touchZ = new Float64Array(8);
  // Scratch, so a step allocates nothing.
  private rx = 0;
  private ry = 0;
  private rz = 0;
  private ix = 0;
  private iy = 0;
  private iz = 0;
  private readonly contact: SolidContact = { normalX: 0, normalZ: 0, depth: 0 };

  /**
   * @param capacity How many bodies there can be at once; a launch beyond it replaces the oldest.
   * @param hasGround Whether there is ground at (x, z) (not water); everywhere if left out.
   * @param solids What bodies low down bounce off besides the ground; nothing if left out.
   */
  constructor(
    readonly capacity: number,
    private readonly hasGround: (x: number, z: number) => boolean = () => true,
    private readonly solids: DebrisSolids | null = null,
  ) {
    this.active = new Uint8Array(capacity);
    this.resting = new Uint8Array(capacity);
    this.kind = new Int32Array(capacity);
    this.ref = new Float64Array(capacity);
    this.x = new Float64Array(capacity);
    this.y = new Float64Array(capacity);
    this.z = new Float64Array(capacity);
    this.qx = new Float64Array(capacity);
    this.qy = new Float64Array(capacity);
    this.qz = new Float64Array(capacity);
    this.qw = new Float64Array(capacity);
    this.halfX = new Float64Array(capacity);
    this.halfY = new Float64Array(capacity);
    this.halfZ = new Float64Array(capacity);
    this.age = new Float64Array(capacity);
    this.previousX = new Float64Array(capacity);
    this.previousY = new Float64Array(capacity);
    this.previousZ = new Float64Array(capacity);
    this.previousQx = new Float64Array(capacity);
    this.previousQy = new Float64Array(capacity);
    this.previousQz = new Float64Array(capacity);
    this.previousQw = new Float64Array(capacity);
    this.vx = new Float64Array(capacity);
    this.vy = new Float64Array(capacity);
    this.vz = new Float64Array(capacity);
    this.wx = new Float64Array(capacity);
    this.wy = new Float64Array(capacity);
    this.wz = new Float64Array(capacity);
    this.inverseMass = new Float64Array(capacity);
    this.inverseInertiaX = new Float64Array(capacity);
    this.inverseInertiaY = new Float64Array(capacity);
    this.inverseInertiaZ = new Float64Array(capacity);
    this.restitution = new Float64Array(capacity);
    this.friction = new Float64Array(capacity);
    this.stillSeconds = new Float64Array(capacity);
  }

  /** How many bodies there are. */
  get count(): number {
    return this.activeCount;
  }

  /**
   * Sends off a body; returns its slot. When every slot is taken, the
   * oldest body makes room (a resting one first).
   */
  launch(launch: DebrisLaunch): number {
    const slot = this.freeSlot();
    const { shape } = launch;
    if (this.active[slot] === 0) {
      this.activeCount++;
    }
    this.active[slot] = 1;
    this.resting[slot] = 0;
    this.kind[slot] = launch.kind;
    this.ref[slot] = launch.ref;
    this.x[slot] = launch.x;
    this.y[slot] = launch.y;
    this.z[slot] = launch.z;
    // A turn about the vertical: q = (0, sin(h/2), 0, cos(h/2)).
    this.qx[slot] = 0;
    this.qy[slot] = Math.sin(launch.heading / 2);
    this.qz[slot] = 0;
    this.qw[slot] = Math.cos(launch.heading / 2);
    this.halfX[slot] = shape.halfX;
    this.halfY[slot] = shape.halfY;
    this.halfZ[slot] = shape.halfZ;
    this.age[slot] = 0;
    this.vx[slot] = launch.vx;
    this.vy[slot] = launch.vy;
    this.vz[slot] = launch.vz;
    this.wx[slot] = launch.spinX;
    this.wy[slot] = launch.spinY;
    this.wz[slot] = launch.spinZ;
    this.inverseMass[slot] = 1 / shape.massKg;
    // A solid box: I = m/3 (b² + c²) about each axis, with b and c the other two half extents.
    const third = shape.massKg / 3;
    this.inverseInertiaX[slot] = 1 / (third * (shape.halfY ** 2 + shape.halfZ ** 2));
    this.inverseInertiaY[slot] = 1 / (third * (shape.halfX ** 2 + shape.halfZ ** 2));
    this.inverseInertiaZ[slot] = 1 / (third * (shape.halfX ** 2 + shape.halfY ** 2));
    this.restitution[slot] = shape.restitution;
    this.friction[slot] = shape.friction;
    this.stillSeconds[slot] = 0;
    this.keepPose(slot);
    return slot;
  }

  /** Takes a body away. */
  remove(slot: number): void {
    if (this.active[slot] === 1) {
      this.active[slot] = 0;
      this.activeCount--;
    }
  }

  /** Takes every body away. */
  clear(): void {
    this.active.fill(0);
    this.activeCount = 0;
  }

  /**
   * Something moving at (vx, vz) and filling a circle round (x, z) shoves
   * the bodies it overlaps out of its way, at least as fast as it goes into
   * them, and wakes them. Allocation-free.
   */
  shove(x: number, z: number, radius: number, vx: number, vz: number): void {
    for (let slot = 0; slot < this.capacity; slot++) {
      if (this.active[slot] === 0) {
        continue;
      }
      const reach = radius + Math.max(this.halfX[slot]!, this.halfZ[slot]!);
      const dx = this.x[slot]! - x;
      const dz = this.z[slot]! - z;
      const distanceSquared = dx * dx + dz * dz;
      if (distanceSquared >= reach * reach || this.y[slot]! > 3) {
        continue;
      }
      const distance = Math.sqrt(distanceSquared) || 1e-6;
      const nx = dx / distance;
      const nz = dz / distance;
      const into = vx * nx + vz * nz;
      const away = this.vx[slot]! * nx + this.vz[slot]! * nz;
      if (into > away) {
        this.vx[slot] = this.vx[slot]! + (into - away) * 1.2 * nx;
        this.vz[slot] = this.vz[slot]! + (into - away) * 1.2 * nz;
        this.vy[slot] = Math.max(this.vy[slot]!, 0.15 * (into - away));
      }
      // Out of the way at once, so it does not sit inside whatever shoves it.
      this.x[slot] = x + nx * reach;
      this.z[slot] = z + nz * reach;
      this.resting[slot] = 0;
      this.stillSeconds[slot] = 0;
    }
  }

  /** Advances every body by `dt` seconds. Allocation-free. */
  step(dt: number): void {
    const drag = Math.max(0, 1 - LINEAR_DRAG * dt);
    const spinDrag = Math.max(0, 1 - ANGULAR_DRAG * dt);
    for (let s = 0; s < this.capacity; s++) {
      if (this.active[s] === 0) {
        continue;
      }
      this.age[s] = this.age[s]! + dt;
      this.keepPose(s);
      if (this.resting[s] === 1) {
        continue;
      }
      this.vy[s] = this.vy[s]! - DEBRIS_GRAVITY * dt;
      this.vx[s] = this.vx[s]! * drag;
      this.vy[s] = this.vy[s]! * drag;
      this.vz[s] = this.vz[s]! * drag;
      let wx = this.wx[s]! * spinDrag;
      let wy = this.wy[s]! * spinDrag;
      let wz = this.wz[s]! * spinDrag;
      const spin = Math.hypot(wx, wy, wz);
      if (spin > MAX_SPIN) {
        wx *= MAX_SPIN / spin;
        wy *= MAX_SPIN / spin;
        wz *= MAX_SPIN / spin;
      }
      this.wx[s] = wx;
      this.wy[s] = wy;
      this.wz[s] = wz;
      this.x[s] = this.x[s]! + this.vx[s]! * dt;
      this.y[s] = this.y[s]! + this.vy[s]! * dt;
      this.z[s] = this.z[s]! + this.vz[s]! * dt;
      this.turn(s, dt);
      if (this.solids !== null) {
        this.meetSolids(s, this.solids);
      }
      if (this.hasGround(this.x[s]!, this.z[s]!)) {
        this.meetGround(s, dt);
      } else if (this.y[s]! < -SUNK_DEPTH) {
        this.remove(s);
      }
    }
  }

  /** Remembers body `s`'s pose as the one before the step. */
  private keepPose(s: number): void {
    this.previousX[s] = this.x[s]!;
    this.previousY[s] = this.y[s]!;
    this.previousZ[s] = this.z[s]!;
    this.previousQx[s] = this.qx[s]!;
    this.previousQy[s] = this.qy[s]!;
    this.previousQz[s] = this.qz[s]!;
    this.previousQw[s] = this.qw[s]!;
  }

  /**
   * Body `s` against the solid things round it: three circles along its
   * longest axis, as wide as its second longest, each low enough to strike
   * them pushed out, and the body bounced off where that circle strikes (so
   * it spins off a tree it hits with its end).
   */
  private meetSolids(s: number, solids: DebrisSolids): void {
    const hx = this.halfX[s]!;
    const hy = this.halfY[s]!;
    const hz = this.halfZ[s]!;
    // The longest axis, and the second longest half extent: the circles' radius.
    let ax = 0;
    let ay = 0;
    let az = 0;
    let longest: number;
    let radius: number;
    if (hx >= hy && hx >= hz) {
      ax = 1;
      longest = hx;
      radius = Math.max(hy, hz);
    } else if (hy >= hz) {
      ay = 1;
      longest = hy;
      radius = Math.max(hx, hz);
    } else {
      az = 1;
      longest = hz;
      radius = Math.max(hx, hy);
    }
    this.rotate(s, ax, ay, az);
    const span = Math.max(0, longest - radius);
    const axisX = this.rx * span;
    const axisY = this.ry * span;
    const axisZ = this.rz * span;
    const contact = this.contact;
    for (let k = -1; k <= 1; k++) {
      const rx = axisX * k;
      const ry = axisY * k;
      const rz = axisZ * k;
      if (this.y[s]! + ry - radius > SOLIDS_HEIGHT || (k !== 0 && span === 0)) {
        continue;
      }
      // How fast that point moves: v + ω × r.
      const pointVx = this.vx[s]! + (this.wy[s]! * rz - this.wz[s]! * ry);
      const pointVz = this.vz[s]! + (this.wx[s]! * ry - this.wy[s]! * rx);
      if (!solids.collideDebris(this.x[s]! + rx, this.z[s]! + rz, radius, pointVx, pointVz, contact)) {
        continue;
      }
      const nx = contact.normalX;
      const nz = contact.normalZ;
      this.x[s] = this.x[s]! + nx * contact.depth;
      this.z[s] = this.z[s]! + nz * contact.depth;
      const into = pointVx * nx + pointVz * nz;
      if (into < 0) {
        const push = (-(1 + SOLID_RESTITUTION) * into) / this.effectiveInverseMass(s, rx, ry, rz, nx, 0, nz);
        this.applyImpulse(s, rx, ry, rz, nx * push, 0, nz * push);
      }
      this.stillSeconds[s] = 0;
    }
  }

  /** Turns body `s` by its spin over `dt`: q ← q + ½ dt (ω, 0) q, normalised. */
  private turn(s: number, dt: number): void {
    const wx = this.wx[s]!;
    const wy = this.wy[s]!;
    const wz = this.wz[s]!;
    const qx = this.qx[s]!;
    const qy = this.qy[s]!;
    const qz = this.qz[s]!;
    const qw = this.qw[s]!;
    const h = dt / 2;
    let nx = qx + h * (wx * qw + wy * qz - wz * qy);
    let ny = qy + h * (wy * qw + wz * qx - wx * qz);
    let nz = qz + h * (wz * qw + wx * qy - wy * qx);
    let nw = qw + h * (-wx * qx - wy * qy - wz * qz);
    const length = Math.hypot(nx, ny, nz, nw) || 1;
    nx /= length;
    ny /= length;
    nz /= length;
    nw /= length;
    this.qx[s] = nx;
    this.qy[s] = ny;
    this.qz[s] = nz;
    this.qw[s] = nw;
  }

  /**
   * The ground pushes body `s` back out where its corners dig in: an
   * impulse at the middle of those corners stops its fall there (bouncing
   * some), and friction at each of them slows its slide and its spin. Then
   * it may fall asleep.
   */
  private meetGround(s: number, dt: number): void {
    let deepest = 0;
    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;
    let touching = 0;
    for (let c = 0; c < 8; c++) {
      const signs = CORNER_SIGNS[c]!;
      this.rotate(s, signs[0] * this.halfX[s]!, signs[1] * this.halfY[s]!, signs[2] * this.halfZ[s]!);
      const cornerY = this.y[s]! + this.ry;
      if (cornerY < 0) {
        deepest = Math.min(deepest, cornerY);
        this.touchX[touching] = this.rx;
        this.touchY[touching] = this.ry;
        this.touchZ[touching] = this.rz;
        sumX += this.rx;
        sumY += this.ry;
        sumZ += this.rz;
        touching++;
      }
    }
    if (touching === 0) {
      this.stillSeconds[s] = 0;
      return;
    }
    this.y[s] = this.y[s]! - deepest;
    // The contact point, from the body's middle, and how fast it goes down: v + ω × r.
    const rx = sumX / touching;
    const ry = sumY / touching;
    const rz = sumZ / touching;
    const pointVy = this.vy[s]! + (this.wz[s]! * rx - this.wx[s]! * rz);
    if (pointVy < 0) {
      // Along the ground's normal n = (0, 1, 0).
      const normalMass = this.effectiveInverseMass(s, rx, ry, rz, 0, 1, 0);
      const push = (-(1 + this.restitution[s]!) * pointVy) / normalMass;
      this.applyImpulse(s, rx, ry, rz, 0, push, 0);
      // Friction against each touching corner's slide, at most µ times its share of the push: all
      // worked out from the same motion and applied together, so the corners' order does not matter.
      const share = (this.friction[s]! * push) / touching;
      const vx = this.vx[s]!;
      const vz = this.vz[s]!;
      const wx = this.wx[s]!;
      const wy = this.wy[s]!;
      const wz = this.wz[s]!;
      let dvx = 0;
      let dvz = 0;
      let dwx = 0;
      let dwy = 0;
      let dwz = 0;
      for (let c = 0; c < touching; c++) {
        const cx = this.touchX[c]!;
        const cy = this.touchY[c]!;
        const cz = this.touchZ[c]!;
        const slideX = vx + (wy * cz - wz * cy);
        const slideZ = vz + (wx * cy - wy * cx);
        const slide = Math.hypot(slideX, slideZ);
        if (slide <= 1e-6) {
          continue;
        }
        const tx = -slideX / slide;
        const tz = -slideZ / slide;
        const grip = Math.min(share, slide / (this.effectiveInverseMass(s, cx, cy, cz, tx, 0, tz) * touching));
        const jx = tx * grip;
        const jz = tz * grip;
        dvx += jx * this.inverseMass[s]!;
        dvz += jz * this.inverseMass[s]!;
        this.inverseInertia(s, cy * jz, cz * jx - cx * jz, -cy * jx);
        dwx += this.ix;
        dwy += this.iy;
        dwz += this.iz;
      }
      this.vx[s] = vx + dvx;
      this.vz[s] = vz + dvz;
      this.wx[s] = wx + dwx;
      this.wy[s] = wy + dwy;
      this.wz[s] = wz + dwz;
    }
    const speed = Math.hypot(this.vx[s]!, this.vy[s]!, this.vz[s]!);
    const spin = Math.hypot(this.wx[s]!, this.wy[s]!, this.wz[s]!);
    if (speed < SLEEP_SPEED && spin < SLEEP_SPIN) {
      this.stillSeconds[s] = this.stillSeconds[s]! + dt;
      if (this.stillSeconds[s]! >= SLEEP_SECONDS) {
        this.resting[s] = 1;
        this.vx[s] = this.vy[s] = this.vz[s] = 0;
        this.wx[s] = this.wy[s] = this.wz[s] = 0;
      }
    } else {
      this.stillSeconds[s] = 0;
    }
  }

  /** 1 / (effective mass) of body `s` pushed along unit (nx, ny, nz) at r from its middle: 1/m + n · ((I⁻¹ (r × n)) × r). */
  private effectiveInverseMass(s: number, rx: number, ry: number, rz: number, nx: number, ny: number, nz: number): number {
    this.inverseInertia(s, ry * nz - rz * ny, rz * nx - rx * nz, rx * ny - ry * nx);
    const cx = this.iy * rz - this.iz * ry;
    const cy = this.iz * rx - this.ix * rz;
    const cz = this.ix * ry - this.iy * rx;
    return this.inverseMass[s]! + nx * cx + ny * cy + nz * cz;
  }

  /** Applies impulse (jx, jy, jz) to body `s` at r from its middle. */
  private applyImpulse(s: number, rx: number, ry: number, rz: number, jx: number, jy: number, jz: number): void {
    const inverseMass = this.inverseMass[s]!;
    this.vx[s] = this.vx[s]! + jx * inverseMass;
    this.vy[s] = this.vy[s]! + jy * inverseMass;
    this.vz[s] = this.vz[s]! + jz * inverseMass;
    this.inverseInertia(s, ry * jz - rz * jy, rz * jx - rx * jz, rx * jy - ry * jx);
    this.wx[s] = this.wx[s]! + this.ix;
    this.wy[s] = this.wy[s]! + this.iy;
    this.wz[s] = this.wz[s]! + this.iz;
  }

  /** (ix, iy, iz) ← I⁻¹ (x, y, z) in world axes: the body's inverse inertia, turned with it. */
  private inverseInertia(s: number, x: number, y: number, z: number): void {
    // Into the body's own axes (by the inverse turn), scale, and back.
    this.rotate(s, x, y, z, true);
    this.rotate(s, this.rx * this.inverseInertiaX[s]!, this.ry * this.inverseInertiaY[s]!, this.rz * this.inverseInertiaZ[s]!);
    this.ix = this.rx;
    this.iy = this.ry;
    this.iz = this.rz;
  }

  /** (rx, ry, rz) ← (x, y, z) turned by body `s`'s quaternion, or by its inverse. */
  private rotate(s: number, x: number, y: number, z: number, inverse = false): void {
    const qx = inverse ? -this.qx[s]! : this.qx[s]!;
    const qy = inverse ? -this.qy[s]! : this.qy[s]!;
    const qz = inverse ? -this.qz[s]! : this.qz[s]!;
    const qw = this.qw[s]!;
    // v' = v + 2w (q × v) + 2 q × (q × v)
    const tx = 2 * (qy * z - qz * y);
    const ty = 2 * (qz * x - qx * z);
    const tz = 2 * (qx * y - qy * x);
    this.rx = x + qw * tx + (qy * tz - qz * ty);
    this.ry = y + qw * ty + (qz * tx - qx * tz);
    this.rz = z + qw * tz + (qx * ty - qy * tx);
  }

  /** A free slot, or the oldest body's (a resting one first). */
  private freeSlot(): number {
    let oldest = -1;
    let oldestResting = -1;
    for (let slot = 0; slot < this.capacity; slot++) {
      if (this.active[slot] === 0) {
        return slot;
      }
      if (this.resting[slot] === 1 && (oldestResting < 0 || this.age[slot]! > this.age[oldestResting]!)) {
        oldestResting = slot;
      }
      if (oldest < 0 || this.age[slot]! > this.age[oldest]!) {
        oldest = slot;
      }
    }
    return oldestResting >= 0 ? oldestResting : oldest;
  }
}
