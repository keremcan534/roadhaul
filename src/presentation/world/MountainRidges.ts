import { BufferAttribute, BufferGeometry, Color } from 'three';
import { smoothstep } from '../../core/math/scalar';
import { fractalNoise } from '../textures/noise';
import { distanceToEdge, ridgeHeight, ridgeProfile, type MountainRidge, type MountainWorld } from './mountainRange';

/** A ridge as drawn: the world's ridge, and where on the ring round the camera it is drawn and in what colours. */
interface DrawnRidge extends MountainRidge {
  /** The ring round the camera it is drawn on: its foot's radius, and how deep it reaches back (meters). */
  readonly ringRadius: number;
  readonly ringDepth: number;
  /** Its colours at the foot and the crest (sRGB), and the bare rock above `rockMeters` of true height. */
  readonly foot: number;
  readonly crest: number;
  readonly rockMeters: number;
  /** Snow lies on it all year above this height, meters (higher than it ever rises: never). */
  readonly snowMeters: number;
  /** How much of the horizon's haze it takes, close by and far off. */
  readonly hazeNear: number;
  readonly hazeFar: number;
}

/**
 * The ranges round the region: green foothills a little past the map's edge,
 * and behind them rocky mountains under snow. The far ridge is drawn first,
 * so the near one stands before it.
 */
const RIDGES: readonly DrawnRidge[] = [
  {
    marginMeters: 1500,
    depthMeters: 1400,
    lowMeters: 420,
    highMeters: 1150,
    swellMeters: 2600,
    crestMeters: 700,
    seed: 29,
    ringRadius: 690,
    ringDepth: 70,
    foot: 0x4a5f70,
    crest: 0x7d90a2,
    rockMeters: 380,
    snowMeters: 820,
    hazeNear: 0.18,
    hazeFar: 0.6,
  },
  {
    marginMeters: 250,
    depthMeters: 650,
    lowMeters: 70,
    highMeters: 330,
    swellMeters: 1500,
    crestMeters: 420,
    seed: 7,
    ringRadius: 590,
    ringDepth: 60,
    foot: 0x34502e,
    crest: 0x5d7b48,
    rockMeters: 250,
    snowMeters: 10_000,
    hazeNear: 0.05,
    hazeFar: 0.5,
  },
];
/** Steps round the ring and up each ridge's face. */
const SEGMENTS = 180;
const ROWS = 5;
/** The ridges are worked out again once the camera has moved this far, meters: they are hundreds of meters off. */
const REBUILD_METERS = 20;
/** No ridge is drawn steeper than this above the horizon (tan of the angle): a wall right ahead would be a wall. */
const MAX_RISE = Math.tan((55 * Math.PI) / 180);
/** The woods and clearings on the ridges repeat this far apart, meters (about 300 m patches). */
const PATCH_PERIOD_METERS = 32_000;
const ATTRIBUTES = ['position', 'normal', 'color', 'haze', 'trueHeight'] as const;
const ROCK = new Color(0x77716a);
const SNOW = new Color(0xeef2f6);

/**
 * The mountains round the region, as the backdrop draws them: two ridges on
 * rings round the camera (it follows the camera), each column the world's
 * ridge seen that way. Each ridge's true distance and height
 * (mountainRange.ts) are drawn on the ring at the same angle above the
 * horizon, so the ranges stand still in the world as the truck drives: they
 * grow toward a near edge and sink toward the far one, and the west lies
 * open over the sea. Worked out again, in place, each time the camera has
 * moved REBUILD_METERS; allocation-free.
 */
export class MountainRidges {
  readonly geometry = new BufferGeometry();
  private readonly positions: Float32Array;
  private readonly normals: Float32Array;
  private readonly colors: Float32Array;
  private readonly hazes: Float32Array;
  private readonly heights: Float32Array;
  private readonly cosines = new Float32Array(SEGMENTS + 1);
  private readonly sines = new Float32Array(SEGMENTS + 1);
  private readonly color = new Color();
  private readonly crest = new Color();
  private builtX = Number.NaN;
  private builtZ = Number.NaN;

  constructor(private readonly world: MountainWorld) {
    const vertices = RIDGES.length * (SEGMENTS + 1) * (ROWS + 1);
    this.positions = new Float32Array(vertices * 3);
    this.normals = new Float32Array(vertices * 3);
    this.colors = new Float32Array(vertices * 3);
    this.hazes = new Float32Array(vertices);
    this.heights = new Float32Array(vertices);
    for (let i = 0; i <= SEGMENTS; i++) {
      const angle = (i / SEGMENTS) * Math.PI * 2;
      this.cosines[i] = Math.cos(angle);
      this.sines[i] = Math.sin(angle);
    }
    const indices: number[] = [];
    RIDGES.forEach((_, layer) => {
      const first = layer * (SEGMENTS + 1) * (ROWS + 1);
      for (let i = 0; i < SEGMENTS; i++) {
        for (let row = 0; row < ROWS; row++) {
          const a = first + i * (ROWS + 1) + row;
          const b = first + (i + 1) * (ROWS + 1) + row;
          // Wound so the faces point inward, toward the camera at the centre.
          indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
    });
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('normal', new BufferAttribute(this.normals, 3));
    this.geometry.setAttribute('color', new BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('haze', new BufferAttribute(this.hazes, 1));
    this.geometry.setAttribute('trueHeight', new BufferAttribute(this.heights, 1));
    this.geometry.setIndex(indices);
    this.follow(0, 0);
  }

  /** The ridges as seen from (x, z), worked out again if the camera has moved far enough. Allocation-free. */
  follow(x: number, z: number): void {
    const dx = x - this.builtX;
    const dz = z - this.builtZ;
    if (dx * dx + dz * dz < REBUILD_METERS * REBUILD_METERS) {
      return;
    }
    this.builtX = x;
    this.builtZ = z;
    for (let layer = 0; layer < RIDGES.length; layer++) {
      this.buildRidge(layer, x, z);
    }
    this.computeNormals();
    for (let i = 0; i < ATTRIBUTES.length; i++) {
      (this.geometry.getAttribute(ATTRIBUTES[i]!) as BufferAttribute).needsUpdate = true;
    }
  }

  dispose(): void {
    this.geometry.dispose();
  }

  private buildRidge(layer: number, x: number, z: number): void {
    const ridge = RIDGES[layer]!;
    const edge = this.world.halfSizeMeters + ridge.marginMeters;
    const first = layer * (SEGMENTS + 1) * (ROWS + 1);
    this.crest.setHex(ridge.crest);
    for (let i = 0; i <= SEGMENTS; i++) {
      const cos = this.cosines[i]!;
      const sin = this.sines[i]!;
      const foot = distanceToEdge(x, z, cos, sin, edge);
      const footX = x + cos * foot;
      const footZ = z + sin * foot;
      const peak = ridgeHeight(ridge, this.world, footX, footZ);
      // Woods and clearings, rock and scree: the colour varies along the ridge, where it stands in the world.
      const patches = 0.68 + 0.6 * fractalNoise(footX / PATCH_PERIOD_METERS + 0.5, footZ / PATCH_PERIOD_METERS + 0.5, 96, 2, ridge.seed + 11);
      for (let row = 0; row <= ROWS; row++) {
        const t = row / ROWS;
        const distance = foot + ridge.depthMeters * t;
        const height = peak * ridgeProfile(t);
        // Drawn on the ring (or nearer, where the ridge itself is nearer) at the angle the true ridge rises to.
        const radius = Math.min(ridge.ringRadius + ridge.ringDepth * t, distance);
        const rise = Math.min(height / distance, MAX_RISE);
        const v = first + i * (ROWS + 1) + row;
        this.positions[v * 3] = cos * radius;
        this.positions[v * 3 + 1] = row === 0 ? -10 : rise * radius;
        this.positions[v * 3 + 2] = sin * radius;
        this.heights[v] = height;
        this.color.setHex(ridge.foot).lerp(this.crest, t).multiplyScalar(patches);
        this.color.lerp(ROCK, smoothstep(ridge.rockMeters, ridge.rockMeters + 140, height) * 0.8);
        this.color.lerp(SNOW, smoothstep(ridge.snowMeters, ridge.snowMeters + 90, height));
        this.colors[v * 3] = this.color.r;
        this.colors[v * 3 + 1] = this.color.g;
        this.colors[v * 3 + 2] = this.color.b;
        this.hazes[v] = ridge.hazeNear + (ridge.hazeFar - ridge.hazeNear) * smoothstep(150, 7000, distance);
      }
    }
  }

  /** Smooth normals from each vertex's neighbours round the ring and up its face, facing the camera. */
  private computeNormals(): void {
    const p = this.positions;
    const n = this.normals;
    for (let layer = 0; layer < RIDGES.length; layer++) {
      const first = layer * (SEGMENTS + 1) * (ROWS + 1);
      for (let i = 0; i <= SEGMENTS; i++) {
        const before = first + (i === 0 ? SEGMENTS - 1 : i - 1) * (ROWS + 1);
        const after = first + (i === SEGMENTS ? 1 : i + 1) * (ROWS + 1);
        for (let row = 0; row <= ROWS; row++) {
          const v = first + i * (ROWS + 1) + row;
          const below = row === 0 ? v : v - 1;
          const above = row === ROWS ? v : v + 1;
          // Round the ring and up the face.
          const ax = p[(after + row) * 3]! - p[(before + row) * 3]!;
          const ay = p[(after + row) * 3 + 1]! - p[(before + row) * 3 + 1]!;
          const az = p[(after + row) * 3 + 2]! - p[(before + row) * 3 + 2]!;
          const ux = p[above * 3]! - p[below * 3]!;
          const uy = p[above * 3 + 1]! - p[below * 3 + 1]!;
          const uz = p[above * 3 + 2]! - p[below * 3 + 2]!;
          let nx = ay * uz - az * uy;
          let ny = az * ux - ax * uz;
          let nz = ax * uy - ay * ux;
          // Facing the camera, at the centre: against the vertex's own way out.
          if (nx * p[v * 3]! + nz * p[v * 3 + 2]! > 0) {
            nx = -nx;
            ny = -ny;
            nz = -nz;
          }
          const length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
          n[v * 3] = nx / length;
          n[v * 3 + 1] = ny / length;
          n[v * 3 + 2] = nz / length;
        }
      }
    }
  }
}
