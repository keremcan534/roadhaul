import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Mesh,
  MeshBasicMaterial,
  Vector3,
  type Camera,
  type DataTexture,
  type Scene,
} from 'three';
import { SeededRandom } from '../../core/random/SeededRandom';
import { puffImage } from '../textures/proceduralImages';
import { toTexture } from '../textures/toTexture';
import type { PrelitMaterials } from '../world/lighting';
import { scattersLamplight } from '../world/LampLighting';

/**
 * A puff to throw into the air. Emitters keep one and fill it in for each
 * spawn(), so throwing allocates nothing.
 */
export interface ParticleSpawn {
  /** Where it starts, and how fast it moves then, m/s. */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** How wide it is when thrown and when it has faded, meters. */
  startSizeMeters: number;
  endSizeMeters: number;
  lifeSeconds: number;
  /** 0xRRGGBB, lit like the ground. */
  color: number;
  opacity: number;
  /** Upward acceleration, m/s²: smoke rises, spray falls (negative). */
  lift: number;
  /** How fast the air slows it: its speed falls to 1/e in 1/drag seconds. */
  drag: number;
}

export function createParticleSpawn(): ParticleSpawn {
  return {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    startSizeMeters: 1,
    endSizeMeters: 1,
    lifeSeconds: 1,
    color: 0xffffff,
    opacity: 1,
    lift: 0,
    drag: 0,
  };
}

// Offsets into a puff's slice of the state array.
const X = 0;
const Y = 1;
const Z = 2;
const VX = 3;
const VY = 4;
const VZ = 5;
const AGE = 6;
const LIFE = 7;
const SIZE0 = 8;
const SIZE1 = 9;
const R = 10;
const G = 11;
const B = 12;
const OPACITY = 13;
const LIFT = 14;
const DRAG = 15;
const TURN = 16;
const STRIDE = 17;

/** A fresh puff fades in over this share of its life. */
const FADE_IN_SHARE = 0.12;
/** Puffs never sink below this height, meters (spray falls onto the road and stops). */
const FLOOR_Y = 0.05;
const QUAD_CORNERS = [-1, -1, 1, -1, 1, 1, -1, 1] as const;

/**
 * Soft puffs (smoke, dust, spray) in one draw call: a pool of camera-facing
 * quads written into one dynamic geometry every frame. Each puff moves
 * (slowed by the air, lifted or falling), grows, fades in quickly and out
 * slowly, and turns a little way round so no two look the same. When the
 * pool is full the oldest puff makes way. The material is unlit and
 * follows the light through PrelitMaterials, so puffs darken at night; the
 * fog hides far ones. Hidden (no draw call) while no puff is in the air.
 * Allocation-free after construction.
 */
export class ParticlePool {
  readonly mesh: Mesh;
  readonly capacity: number;
  private readonly geometry = new BufferGeometry();
  private readonly material: MeshBasicMaterial;
  private readonly texture: DataTexture;
  private readonly positions: BufferAttribute;
  private readonly colors: BufferAttribute;
  // Per puff: position, velocity, age, life, sizes, colour, opacity, lift, drag, turn.
  private readonly state: Float32Array;
  private next = 0;
  private live = 0;
  private readonly random = new SeededRandom(97);
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly tint = new Color();

  constructor(
    private readonly scene: Scene,
    capacity: number,
    prelit?: PrelitMaterials,
  ) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.state = new Float32Array(this.capacity * STRIDE);
    this.positions = new BufferAttribute(new Float32Array(this.capacity * 12), 3);
    this.positions.setUsage(DynamicDrawUsage);
    // RGBA per corner: three.js blends by the vertex alpha when the colour has four components.
    this.colors = new BufferAttribute(new Float32Array(this.capacity * 16), 4);
    this.colors.setUsage(DynamicDrawUsage);
    const uvs = new Float32Array(this.capacity * 8);
    const indices = new Uint16Array(this.capacity * 6);
    for (let i = 0; i < this.capacity; i++) {
      uvs.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8);
      indices.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    this.geometry.setAttribute('position', this.positions);
    this.geometry.setAttribute('color', this.colors);
    this.geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
    this.geometry.setIndex(new BufferAttribute(indices, 1));
    this.geometry.setDrawRange(0, 0);
    this.texture = toTexture(puffImage());
    this.material = new MeshBasicMaterial({
      map: this.texture,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
    });
    // Smoke, dust and spray light up in lamplight, whichever way they drift.
    scattersLamplight(this.material);
    prelit?.add(this.material);
    this.mesh = new Mesh(this.geometry, this.material);
    // The puffs are written in world space every frame: bounds computed once would go stale.
    this.mesh.frustumCulled = false;
    // Over the see-through things on the ground (shadows, pools of light), which would show through them.
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** How many puffs are in the air. */
  get count(): number {
    return this.live;
  }

  /** Throws a puff; the oldest makes way when the pool is full. */
  spawn(puff: Readonly<ParticleSpawn>): void {
    const s = this.state;
    const i = this.next * STRIDE;
    this.next = (this.next + 1) % this.capacity;
    s[i + X] = puff.x;
    s[i + Y] = puff.y;
    s[i + Z] = puff.z;
    s[i + VX] = puff.vx;
    s[i + VY] = puff.vy;
    s[i + VZ] = puff.vz;
    s[i + AGE] = 0;
    s[i + LIFE] = Math.max(0.01, puff.lifeSeconds);
    s[i + SIZE0] = puff.startSizeMeters;
    s[i + SIZE1] = puff.endSizeMeters;
    // Vertex colours are linear, like the material's.
    const tint = this.tint.setHex(puff.color);
    s[i + R] = tint.r;
    s[i + G] = tint.g;
    s[i + B] = tint.b;
    s[i + OPACITY] = puff.opacity;
    s[i + LIFT] = puff.lift;
    s[i + DRAG] = puff.drag;
    s[i + TURN] = this.random.range(0, Math.PI * 2);
  }

  /**
   * Ages and moves the puffs `deltaSeconds` on (0 holds them still) and
   * turns them all to face `camera`. Call every frame, after the camera
   * has moved.
   */
  update(deltaSeconds: number, camera: Camera): void {
    const s = this.state;
    // The camera's right and up in the world, as it stands this frame: a face-on quad spans them.
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    this.right.set(e[0]!, e[1]!, e[2]!).normalize();
    this.up.set(e[4]!, e[5]!, e[6]!).normalize();
    const right = this.right;
    const up = this.up;
    const positions = this.positions.array as Float32Array;
    const colors = this.colors.array as Float32Array;
    let quads = 0;
    for (let p = 0; p < this.capacity; p++) {
      const i = p * STRIDE;
      if (s[i + AGE]! >= s[i + LIFE]!) {
        continue;
      }
      const age = s[i + AGE]! + deltaSeconds;
      s[i + AGE] = age;
      const life = s[i + LIFE]!;
      if (age >= life) {
        continue;
      }
      if (deltaSeconds > 0) {
        const slow = Math.exp(-s[i + DRAG]! * deltaSeconds);
        s[i + VX] = s[i + VX]! * slow;
        s[i + VY] = s[i + VY]! * slow + s[i + LIFT]! * deltaSeconds;
        s[i + VZ] = s[i + VZ]! * slow;
        s[i + X] = s[i + X]! + s[i + VX]! * deltaSeconds;
        s[i + Y] = Math.max(FLOOR_Y, s[i + Y]! + s[i + VY]! * deltaSeconds);
        s[i + Z] = s[i + Z]! + s[i + VZ]! * deltaSeconds;
      }
      const t = age / life;
      // It grows fast at first, then slower; fades in quickly and out slowly.
      const growth = 1 - (1 - t) * (1 - t);
      const half = (s[i + SIZE0]! + (s[i + SIZE1]! - s[i + SIZE0]!) * growth) / 2;
      const alpha = s[i + OPACITY]! * Math.min(1, t / FADE_IN_SHARE) * (1 - t) ** 1.5;
      const turn = s[i + TURN]! + t * 0.8;
      const cos = Math.cos(turn) * half;
      const sin = Math.sin(turn) * half;
      const x = s[i + X]!;
      const y = s[i + Y]!;
      const z = s[i + Z]!;
      for (let corner = 0; corner < 4; corner++) {
        const cx = QUAD_CORNERS[corner * 2]!;
        const cy = QUAD_CORNERS[corner * 2 + 1]!;
        const a = cx * cos - cy * sin;
        const b = cx * sin + cy * cos;
        const v = (quads * 4 + corner) * 3;
        positions[v] = x + right.x * a + up.x * b;
        positions[v + 1] = y + right.y * a + up.y * b;
        positions[v + 2] = z + right.z * a + up.z * b;
        const c = (quads * 4 + corner) * 4;
        colors[c] = s[i + R]!;
        colors[c + 1] = s[i + G]!;
        colors[c + 2] = s[i + B]!;
        colors[c + 3] = alpha;
      }
      quads++;
    }
    this.live = quads;
    this.mesh.visible = quads > 0;
    if (quads > 0) {
      this.positions.clearUpdateRanges();
      this.positions.addUpdateRange(0, quads * 12);
      this.positions.needsUpdate = true;
      this.colors.clearUpdateRanges();
      this.colors.addUpdateRange(0, quads * 16);
      this.colors.needsUpdate = true;
    }
    this.geometry.setDrawRange(0, quads * 6);
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
