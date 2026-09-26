import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Quaternion,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
  type Scene,
} from 'three';
import { shorelineXAt, type Point2 } from '../../data/definitions/MapDefinition';
import type { Sea, ShoreRock } from '../../domain/world/DrivingWorld';
import { sandImage } from '../textures/proceduralImages';
import { toTexture } from '../textures/toTexture';
import type { SkyUniforms } from './EnvironmentView';
import { flatGroundLight, type PrelitMaterials } from './lighting';

/** The water reaches this far past the map edge, like the ground (TrackView), so it fades into the haze. */
const FAR_METERS = 1400;
/**
 * The water's mesh runs in rows parallel to the shore, this far out: close
 * together near it, where the foam is, then further apart.
 */
const ROW_OFFSETS_METERS = [0, 1.5, 4, 12, 40, 150] as const;
/** Just over the grass, under the roads (TrackView's layers). */
const WATER_Y = 0.015;
/** The water's own colour, deep blue-green, before the sky's reflection. */
const DEEP_WATER = 0x1a5566;
/**
 * The sun (or the moon) glitters on the sea: the waves are covered in small
 * facets, this many to a meter each way, each tilted its own way by up to
 * this much (a slope) and turning over this many times a second, and the
 * few that catch the light just right flash, as bright as this (times the
 * sun's colour). Toward a low sun they lay a glittering path on the water.
 */
const SPARKLE_CELLS_PER_METER = 2.5;
const SPARKLE_TILT = 0.16;
const SPARKLE_RATE = 0.7;
const SPARKLE_SHARPNESS = 700;
const SPARKLE_LEVEL = 9;
/** The beach along the natural shore: its width, and how big one texture tile of sand is. */
const BEACH_WIDTH_METERS = 9;
const SAND_TILE_METERS = 6;
const BEACH_Y = 0.008;
/** Boulders at the waterline are cut into tiles this long along the shore, so those out of view are not drawn. */
const ROCK_TILE_METERS = 600;
const ROCK_COLOR = 0x817a70;

export interface SeaViewOptions {
  /** Texture anisotropy for the beach (renderer capability). */
  readonly anisotropy?: number;
  /** Where the pre-lit beach registers, to follow the weather's light. */
  readonly prelit?: PrelitMaterials;
}

/**
 * The sea along the map's west edge (DrivingWorld.sea): the water, a sandy
 * beach along the natural shore and boulders at the waterline. The water
 * mirrors the sky it is given (EnvironmentView.sky), so it follows the
 * weather and the time of day: small waves drift across it, the sky
 * shows in it more at grazing angles, the sun (at night the moon)
 * glitters on it, sparkling in a path toward it when it is low, and foam
 * breaks along the shore. It is fogged like the rest of the scene. The
 * quays, cranes and boats are HarbourView's. One draw call for the water,
 * one for the beach, one per stretch of boulders in view. update() runs
 * every frame and allocates nothing.
 */
export class SeaView {
  private readonly root = new Group();
  private readonly resources: { dispose(): void }[] = [];
  private readonly time = { value: 0 };

  constructor(
    private readonly scene: Scene,
    sea: Sea,
    halfSizeMeters: number,
    sky: SkyUniforms,
    options: SeaViewOptions = {},
  ) {
    this.root.name = 'sea';
    this.root.add(this.createWater(sea.shoreline, halfSizeMeters, sky));
    const beach = this.createBeach(sea, halfSizeMeters, options);
    if (beach !== null) {
      this.root.add(beach);
    }
    this.root.add(...this.createRocks(sea, halfSizeMeters));
    scene.add(this.root);
  }

  /** Moves the waves and the foam `deltaSeconds` on. Allocation-free. */
  update(deltaSeconds: number): void {
    // Wrapped so the waves keep their precision; the jump every hour is lost in the ripples.
    this.time.value = (this.time.value + deltaSeconds) % 3600;
  }

  dispose(): void {
    this.scene.remove(this.root);
    for (const resource of this.resources) {
      resource.dispose();
    }
  }

  /**
   * Rows of vertices along the shore, from the waterline out to past the map
   * edge; each knows how far out it is (`shore`, meters), for the foam.
   */
  private createWater(shoreline: readonly Point2[], halfSize: number, sky: SkyUniforms): Mesh {
    const far = halfSize + FAR_METERS;
    const first = shoreline[0]!;
    const last = shoreline[shoreline.length - 1]!;
    const line: Point2[] = [[first[0], -far], ...shoreline, [last[0], far]];
    const rows = [...ROW_OFFSETS_METERS, Number.POSITIVE_INFINITY];
    const positions = new Float32Array(rows.length * line.length * 3);
    const shore = new Float32Array(rows.length * line.length);
    rows.forEach((offset, row) => {
      line.forEach(([x, z], i) => {
        const v = row * line.length + i;
        positions.set([Math.max(-far, x - offset), 0, z], v * 3);
        shore[v] = Math.min(offset, far);
      });
    });
    const indices: number[] = [];
    for (let row = 0; row < rows.length - 1; row++) {
      for (let i = 0; i < line.length - 1; i++) {
        const a = row * line.length + i;
        const b = a + 1;
        const c = a + line.length;
        const d = c + 1;
        // Wound to face up: the next row lies west, the next point south.
        indices.push(a, c, b, b, c, d);
      }
    }
    const geometry = this.track(new BufferGeometry());
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('shore', new BufferAttribute(shore, 1));
    geometry.setIndex(indices);
    geometry.translate(0, WATER_Y, 0);
    const material = this.track(
      new ShaderMaterial({
        fog: true,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
        uniforms: {
          ...UniformsUtils.clone(UniformsLib.fog),
          zenith: sky.zenith,
          horizon: sky.horizon,
          sunColor: sky.sunColor,
          sunDirection: sky.sunDirection,
          deepColor: { value: new Color(DEEP_WATER) },
          time: this.time,
        },
        vertexShader: /* glsl */ `
          #include <common>
          #include <fog_pars_vertex>
          attribute float shore;
          varying vec3 vWorld;
          varying float vShore;
          void main() {
            vec4 world = modelMatrix * vec4(position, 1.0);
            vWorld = world.xyz;
            vShore = shore;
            vec4 mvPosition = viewMatrix * world;
            gl_Position = projectionMatrix * mvPosition;
            #include <fog_vertex>
          }
        `,
        fragmentShader: /* glsl */ `
          #include <common>
          #include <fog_pars_fragment>
          uniform vec3 zenith;
          uniform vec3 horizon;
          uniform vec3 sunColor;
          uniform vec3 sunDirection;
          uniform vec3 deepColor;
          uniform float time;
          varying vec3 vWorld;
          varying float vShore;
          // One ripple: its slope along x and z where it passes p.
          vec2 ripple(vec2 p, vec2 k, float speed, float height) {
            return k * (height * cos(dot(p, k) + time * speed));
          }
          // A hash of a cell, 0..1, steady on large coordinates.
          float cellHash(vec2 cell) {
            vec3 q = fract(vec3(cell.xyx) * 0.1031);
            q += dot(q, q.yzx + 33.33);
            return fract((q.x + q.y) * q.z);
          }
          void main() {
            vec2 p = vWorld.xz;
            vec2 slope = ripple(p, vec2(0.21, 0.09), 1.1, 0.16)
              + ripple(p, vec2(-0.11, 0.26), 1.5, 0.12)
              + ripple(p, vec2(0.43, -0.31), 2.3, 0.05)
              + ripple(p, vec2(-0.07, -0.67), 3.1, 0.03);
            vec3 toEye = cameraPosition - vWorld;
            // Far off, the ripples are finer than a pixel: they average out into calm water instead of stripes.
            slope *= 0.3 + 0.7 * (1.0 - smoothstep(60.0, 450.0, length(toEye)));
            toEye = normalize(toEye);
            vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));
            // The sky shows in the water, the more the flatter it is seen.
            float fresnel = 0.02 + 0.68 * pow(1.0 - max(dot(normal, toEye), 0.0), 5.0);
            vec3 mirrored = reflect(-toEye, normal);
            vec3 sky = mix(horizon * 0.85, zenith, pow(clamp(mirrored.y, 0.0, 1.0), 0.5));
            float daylight = dot(horizon, vec3(0.2126, 0.7152, 0.0722));
            vec3 color = mix(deepColor * (0.25 + daylight), sky, fresnel);
            // The sun (or the moon) glitters on the ripples...
            color += sunColor * pow(max(dot(mirrored, sunDirection), 0.0), 180.0) * 2.5;
            // ...and sparkles on the facets that catch it: one a cell, tilted its own way as it turns over, a round
            // point of light while it faces the sun just right. Not once the sun's disc has set.
            vec2 cells = p * ${SPARKLE_CELLS_PER_METER.toFixed(2)};
            vec2 cell = floor(cells);
            float seed = cellHash(cell);
            float turn = fract(time * ${SPARKLE_RATE.toFixed(2)} + seed) * 6.2832;
            vec2 tilt = (vec2(cellHash(cell + 31.7), cellHash(cell + 71.3)) * 2.0 - 1.0) * ${SPARKLE_TILT.toFixed(2)};
            vec3 facet = normalize(vec3(-slope.x - tilt.x * cos(turn), 1.0, -slope.y - tilt.y * sin(turn)));
            float glint = pow(max(dot(reflect(-toEye, facet), sunDirection), 0.0), ${SPARKLE_SHARPNESS.toFixed(1)});
            float point = 1.0 - smoothstep(0.1, 0.4, length(cells - cell - 0.5));
            color += sunColor * (glint * point * ${SPARKLE_LEVEL.toFixed(1)} * smoothstep(-0.01, 0.03, sunDirection.y));
            // Foam where the ripples break on the shore, coming and going.
            float surf = 0.6 + 0.4 * sin(time * 1.7 - vShore * 1.8 + slope.x * 6.0);
            float foam = (1.0 - smoothstep(0.0, 3.0, vShore)) * surf;
            color = mix(color, vec3(0.86, 0.9, 0.92) * (0.25 + daylight), clamp(foam, 0.0, 1.0) * 0.75);
            gl_FragColor = vec4(color, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
            #include <fog_fragment>
          }
        `,
      }),
    );
    const water = new Mesh(geometry, material);
    water.name = 'water';
    return water;
  }

  /** A strip of sand along the natural shore, broken where the quays are. Pre-lit like the ground. */
  private createBeach(sea: Sea, halfSize: number, options: SeaViewOptions): Mesh | null {
    const stretches = openShore(sea, halfSize);
    if (stretches.length === 0) {
      return null;
    }
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (const [fromZ, toZ] of stretches) {
      const zs = [fromZ, ...sea.shoreline.map(([, z]) => z).filter((z) => z > fromZ && z < toZ), toZ];
      const start = positions.length / 3;
      for (const z of zs) {
        const x = shorelineXAt(sea.shoreline, z);
        for (const across of [0, BEACH_WIDTH_METERS]) {
          positions.push(x + across, BEACH_Y, z);
          uvs.push((x + across) / SAND_TILE_METERS, z / SAND_TILE_METERS);
        }
      }
      for (let i = 0; i < zs.length - 1; i++) {
        const a = start + i * 2;
        // a: the waterline, a + 1 inland; the next pair lies south. Wound to face up.
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geometry = this.track(new BufferGeometry());
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    geometry.setIndex(indices);
    const sand = this.track(toTexture(sandImage(), { repeat: true, anisotropy: options.anisotropy ?? 1 }));
    const material = this.track(
      new MeshBasicMaterial({
        map: sand,
        color: flatGroundLight(),
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
    options.prelit?.add(material);
    const beach = new Mesh(geometry, material);
    beach.name = 'beach';
    return beach;
  }

  /** The boulders at the waterline, instanced, one mesh per ROCK_TILE_METERS of shore. */
  private createRocks(sea: Sea, halfSize: number): InstancedMesh[] {
    const tiles = new Map<number, ShoreRock[]>();
    for (const rock of sea.rocks) {
      const tile = Math.floor((rock.z + halfSize) / ROCK_TILE_METERS);
      const rocks = tiles.get(tile);
      if (rocks === undefined) {
        tiles.set(tile, [rock]);
      } else {
        rocks.push(rock);
      }
    }
    if (tiles.size === 0) {
      return [];
    }
    const geometry = this.track(new IcosahedronGeometry(0.5, 0));
    const material = this.track(new MeshLambertMaterial({ color: ROCK_COLOR, flatShading: true }));
    const matrix = new Matrix4();
    const where = new Vector3();
    const turn = new Quaternion();
    const size = new Vector3();
    const up = new Vector3(0, 1, 0);
    return [...tiles.values()].map((rocks) => {
      const mesh = this.track(new InstancedMesh(geometry, material, rocks.length));
      rocks.forEach((rock, index) => {
        where.set(rock.x, rock.size * 0.12, rock.z);
        turn.setFromAxisAngle(up, rock.turn);
        size.set(rock.size, rock.size * 0.55, rock.size * 0.8);
        mesh.setMatrixAt(index, matrix.compose(where, turn, size));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      return mesh;
    });
  }

  private track<T extends { dispose(): void }>(resource: T): T {
    this.resources.push(resource);
    return resource;
  }
}

/** The stretches of shore between the quays, [fromZ, toZ], from the map's north edge to its south edge. */
function openShore(sea: Sea, halfSize: number): [number, number][] {
  const quays = [...sea.quays].sort((a, b) => a.fromZ - b.fromZ);
  const stretches: [number, number][] = [];
  let from = -halfSize;
  for (const quay of quays) {
    if (quay.fromZ > from) {
      stretches.push([from, quay.fromZ]);
    }
    from = Math.max(from, quay.toZ);
  }
  if (from < halfSize) {
    stretches.push([from, halfSize]);
  }
  return stretches;
}
