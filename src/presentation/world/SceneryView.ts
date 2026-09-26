import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  type Scene,
} from 'three';
import type { Grazer, GrazerKind, PowerLine } from '../../domain/world/countryside';
import type { DrivingWorld } from '../../domain/world/DrivingWorld';
import type { RoadPath } from '../../domain/world/RoadPath';
import {
  KERB_HEIGHT_METERS,
  OUTLINE_ROW,
  SIDEWALK_WIDTH_METERS,
  sidewalkOutline,
  type Sidewalk,
  type StreetFurnitureKind,
} from '../../domain/world/townscape';
import type { PixelRect } from '../textures/drawing';
import { PROP_ATLAS, PROP_ATLAS_HEIGHT, PROP_ATLAS_WIDTH, SPEED_LIMIT_FACES, pavingImage, propAtlasImage } from '../textures/propImages';
import { toTexture } from '../textures/toTexture';

/** The scenery is merged by square tiles this wide, so what is out of view is not drawn. */
const TILE_METERS = 600;
/** Power poles: how tall, where the crossarm and the insulators the wires hang from are, how far the wires sag. */
const POLE_HEIGHT = 8.4;
const ARM_Y = 7.9;
const INSULATOR_OFFSETS = [-0.78, 0, 0.78] as const;
const INSULATOR_TOP = 0.16;
const WIRE_SAG_PER_SPAN = 0.016;
const WIRE_SEGMENTS = 8;
/** A wire is this thick (meters); drawn never thinner than a pixel, fading as it would be thinner. */
const WIRE_THICKNESS = 0.022;
/** Fences: a post this often, two rails; walls: this long a stretch per stone picture, this tall and thick. */
const FENCE_POST_SPACING = 2.6;
const WALL_STRETCH = 4;
const WALL_HEIGHT = 0.9;
const WALL_THICKNESS = 0.5;
/** Pavements: the flagstones' picture covers this many meters; they are drawn in pieces of this many rows of their outline. */
const PAVING_TILE_METERS = 2.2;
const SIDEWALK_PIECE_ROWS = 40;
/** The road surface is this high (TrackView), the pavement's top a kerb above it. */
const ROAD_TOP_Y = 0.03;
/** Grazing: a head goes down and up this often (seconds), and now and then lifts to look round. */
const GRAZE_PERIOD_SECONDS = 3.4;
const LOOK_ROUND_EVERY_SECONDS = 23;

const WOOD = 0x6b5a45;
const WEATHERED_WOOD = 0x8a7456;
const INSULATOR = 0xd9dcd6;
const STEEL = 0x6e757d;
const DARK_STEEL = 0x2e3237;
const KERB = 0xc9c7c0;
const BENCH_WOOD = 0x9a6b3e;
const BIN_GREEN = 0x2f5a3a;
const SHELTER_FRAME = 0x3a3f45;
const SHELTER_ROOF = 0x9aa3ab;
const SHELTER_PANEL = 0x86a7bb;
const WIRE_COLOR = 0x26292d;
const ROCK_TINTS = [0x8d8a82, 0x98948b, 0x7f7d78, 0xa29d92] as const;
/** Boulders come in this many shapes, each sized, squashed and turned its own way where it lies (half sunk). */
const ROCK_SHAPES = 9;
const WOOL_TINTS = [0xece8de, 0xe2ddd1, 0xd9d3c4, 0xf3f0e8] as const;
const HIDE_TINTS = [0x8a5a3a, 0x6b4128, 0x2b2622, 0xd8d2c6, 0xa0703f] as const;

export interface SceneryViewOptions {
  /** The props cast the sun's real-time shadows (the high preset's shadow map). Default: false. */
  readonly castShadows?: boolean;
  /** Sharper paving at grazing angles. */
  readonly anisotropy?: number;
}

/**
 * The world's generated scenery (DrivingWorld: countryside.ts,
 * townscape.ts), drawn: wooden power poles with their insulators and the
 * wires sagging between them; post-and-rail fences and dry-stone walls
 * along the fields; boulders; the towns' pavements with their kerbs,
 * benches, litter bins and bus shelters; billboards and speed limit signs;
 * and the flocks and herds grazing, heads down, now and then looking round.
 *
 * Everything that keeps still is stamped from parts built once (Parts) and
 * merged, per 600 m tile, into one mesh of one material over a procedural
 * atlas (propImages.ts), and the pavements into one more, so the camera
 * culls what is out of view; the wires are one mesh of ribbons the shader
 * widens to at least a pixel (setViewport), the animals four instanced
 * meshes (bodies and heads). update() animates the grazing and allocates
 * nothing.
 */
export class SceneryView {
  private readonly root = new Group();
  private readonly resources: { dispose(): void }[] = [];
  private readonly grazers: readonly Grazer[];
  /** The drawing buffer's size, for the wires' width in pixels (setViewport). */
  private readonly resolution = { value: new Vector2(1, 1) };
  /** Per kind, the animals' bodies and heads, and which grazers (indices) each instance is. */
  private readonly herds: readonly {
    readonly kind: GrazerKind;
    readonly bodies: InstancedMesh;
    readonly heads: InstancedMesh;
    readonly members: readonly number[];
  }[];
  private readonly tileCount: number;
  private time = 0;
  // Scratch objects reused every frame.
  private readonly matrix = new Matrix4();
  private readonly neck = new Matrix4();
  private readonly turn = new Quaternion();
  private readonly euler = new Euler(0, 0, 0, 'YXZ');
  private readonly position = new Vector3();
  private readonly unit = new Vector3(1, 1, 1);

  constructor(
    private readonly scene: Scene,
    world: DrivingWorld,
    options: SceneryViewOptions = {},
  ) {
    const castShadows = options.castShadows === true;
    const atlas = this.track(toTexture(propAtlasImage()));
    const propMaterial = this.track(new MeshLambertMaterial({ map: atlas, vertexColors: true }));
    const tiles = new Tiles();
    const parts = new Parts();

    for (const line of world.powerLines) {
      for (const pole of line.poles) {
        tiles.add(pole.x, pole.z, parts.place('pole', poleGeometry, pole.x, pole.z, pole.heading));
      }
    }
    for (const edge of world.fieldEdges) {
      if (edge.kind === 'fence') {
        addFence(tiles, parts, edge.from, edge.to);
      } else {
        addWall(tiles, parts, edge.from, edge.to);
      }
    }
    world.rocks.forEach((rock, index) => {
      const shape = index % ROCK_SHAPES;
      const size = parts.shape().makeScale(rock.size, rock.size * 0.62, rock.size * 0.85).setPosition(0, rock.size * 0.18, 0);
      tiles.add(rock.x, rock.z, parts.place(`rock:${shape}`, () => rockGeometry(shape), rock.x, rock.z, rock.turn, size));
    });
    for (const item of world.streetFurniture) {
      tiles.add(item.x, item.z, parts.place(item.kind, () => furnitureGeometry(item.kind), item.x, item.z, item.heading));
    }
    for (const billboard of world.billboards) {
      const ad = billboard.ad % PROP_ATLAS.posters.length;
      tiles.add(billboard.x, billboard.z, parts.place(`billboard:${ad}`, () => billboardGeometry(ad), billboard.x, billboard.z, billboard.heading));
    }
    for (const sign of world.speedSigns) {
      const limit = sign.limitKmh;
      tiles.add(sign.x, sign.z, parts.place(`speed:${limit}`, () => speedSignGeometry(limit), sign.x, sign.z, sign.heading));
    }
    parts.dispose();
    const paving: Tiles = new Tiles();
    for (const sidewalk of world.sidewalks) {
      addSidewalk(tiles, paving, world.roads[sidewalk.roadIndex]!, sidewalk);
    }

    for (const [key, parts] of tiles.entries()) {
      const mesh = new Mesh(this.track(mergeParts(parts)), propMaterial);
      mesh.name = `scenery:${key}`;
      mesh.castShadow = castShadows;
      this.root.add(mesh);
    }
    this.tileCount = tiles.size;
    if (paving.size > 0) {
      const pavingMaterial = this.track(
        new MeshLambertMaterial({ map: this.track(toTexture(pavingImage(), { repeat: true, anisotropy: options.anisotropy ?? 1 })) }),
      );
      for (const [key, parts] of paving.entries()) {
        const mesh = new Mesh(this.track(mergeParts(parts)), pavingMaterial);
        mesh.name = `scenery:pavement:${key}`;
        this.root.add(mesh);
      }
    }
    const wires = wireSegments(world.powerLines);
    if (wires.length > 0) {
      const mesh = new Mesh(this.track(wireRibbons(wires)), this.track(wireMaterial(this.resolution)));
      mesh.name = 'scenery:wires';
      // Widened on the screen by the shader: the bounds three.js would cull by are too thin.
      mesh.frustumCulled = false;
      this.root.add(mesh);
    }

    this.grazers = world.grazers;
    this.herds = (['sheep', 'cow'] as const)
      .filter((kind) => world.grazers.some((grazer) => grazer.kind === kind))
      .map((kind) => this.createHerd(kind, castShadows));
    this.animate();
    this.root.name = 'scenery';
    scene.add(this.root);
  }

  /** How many tiles of merged props (the pavements apart), and animals, there are (for tests). */
  get counts(): { readonly tiles: number; readonly animals: number } {
    return { tiles: this.tileCount, animals: this.herds.reduce((sum, herd) => sum + herd.members.length, 0) };
  }

  /** The drawing buffer's size in pixels, so the wires keep at least a pixel's width. Call on resize. */
  setViewport(widthPixels: number, heightPixels: number): void {
    this.resolution.value.set(Math.max(1, widthPixels), Math.max(1, heightPixels));
  }

  /** Lets the animals graze on for `deltaSeconds` (0 holds them still). Allocation-free. */
  update(deltaSeconds: number): void {
    if (deltaSeconds <= 0 || this.herds.length === 0) {
      return;
    }
    this.time += deltaSeconds;
    this.animate();
  }

  dispose(): void {
    this.scene.remove(this.root);
    for (const resource of this.resources) {
      resource.dispose();
    }
  }

  private createHerd(kind: GrazerKind, castShadows: boolean): { kind: GrazerKind; bodies: InstancedMesh; heads: InstancedMesh; members: number[] } {
    const members = this.grazers.flatMap((grazer, index) => (grazer.kind === kind ? [index] : []));
    const material = this.track(new MeshLambertMaterial({ vertexColors: true }));
    const [body, head] = kind === 'sheep' ? sheepGeometry() : cowGeometry();
    const bodies = this.track(new InstancedMesh(this.track(body), material, Math.max(1, members.length)));
    const heads = this.track(new InstancedMesh(this.track(head), material, Math.max(1, members.length)));
    bodies.name = `scenery:${kind}`;
    heads.name = `scenery:${kind}-heads`;
    const tints = kind === 'sheep' ? WOOL_TINTS : HIDE_TINTS;
    const color = new Color();
    members.forEach((index, slot) => {
      const grazer = this.grazers[index]!;
      this.turn.setFromAxisAngle(UP, grazer.heading);
      bodies.setMatrixAt(slot, this.matrix.compose(this.position.set(grazer.x, 0, grazer.z), this.turn, this.unit));
      bodies.setColorAt(slot, color.setHex(tints[index % tints.length]!));
      heads.setColorAt(slot, color.setHex(kind === 'sheep' ? 0x2b2622 : tints[index % tints.length]!).multiplyScalar(0.8));
    });
    for (const mesh of [bodies, heads]) {
      mesh.count = members.length;
      mesh.castShadow = castShadows;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.root.add(mesh);
    }
    return { kind, bodies, heads, members };
  }

  /**
   * Each head at its neck, lowered to graze and bobbing as it crops the
   * grass; every so often lifted, turned to look round, and lowered again.
   * Each animal keeps its own time, so a herd never moves as one.
   */
  private animate(): void {
    for (const herd of this.herds) {
      const neckAt = herd.kind === 'sheep' ? SHEEP_NECK : COW_NECK;
      for (let slot = 0; slot < herd.members.length; slot++) {
        const index = herd.members[slot]!;
        const grazer = this.grazers[index]!;
        const own = this.time + index * 1.618;
        const lookCycle = (own % LOOK_ROUND_EVERY_SECONDS) / LOOK_ROUND_EVERY_SECONDS;
        // Looking round for the last tenth of each cycle: head up, turned one way then the other.
        const up = lookCycle > 0.9 ? Math.sin(((lookCycle - 0.9) / 0.1) * Math.PI) : 0;
        const graze = 0.1 * Math.sin((own * 2 * Math.PI) / GRAZE_PERIOD_SECONDS);
        const pitch = (0.75 + graze) * (1 - up) - 0.15 * up;
        const yaw = up * 0.5 * Math.sin(own * 1.3);
        this.turn.setFromAxisAngle(UP, grazer.heading);
        this.matrix.compose(this.position.set(grazer.x, 0, grazer.z), this.turn, this.unit);
        this.neck.makeRotationFromEuler(this.euler.set(pitch, yaw, 0));
        this.neck.setPosition(0, neckAt.y, neckAt.z);
        herd.heads.setMatrixAt(slot, this.matrix.multiply(this.neck));
      }
      herd.heads.instanceMatrix.needsUpdate = true;
    }
  }

  private track<T extends { dispose(): void }>(resource: T): T {
    this.resources.push(resource);
    return resource;
  }
}

const UP = new Vector3(0, 1, 0);
/** Where a sheep's and a cow's neck is on its body (the head turns there), meters up and forward. */
const SHEEP_NECK = { y: 0.78, z: 0.55 } as const;
const COW_NECK = { y: 1.32, z: 1.0 } as const;

/** Geometry parts by square tile, keyed "column,row". */
class Tiles {
  private readonly parts = new Map<string, BufferGeometry[]>();

  get size(): number {
    return this.parts.size;
  }

  add(x: number, z: number, geometry: BufferGeometry): void {
    const key = `${Math.floor(x / TILE_METERS)},${Math.floor(z / TILE_METERS)}`;
    const list = this.parts.get(key);
    if (list === undefined) {
      this.parts.set(key, [geometry]);
    } else {
      list.push(geometry);
    }
  }

  entries(): IterableIterator<[string, BufferGeometry[]]> {
    return this.parts.entries();
  }
}

/**
 * Merges `parts` into one indexed geometry (and releases them): their
 * attributes (the first part's set, which every part must have) end to end,
 * their indices offset. Much quicker than mergeGeometries for thousands of
 * small parts, the scenery's cost at boot.
 */
function mergeParts(parts: readonly BufferGeometry[]): BufferGeometry {
  const names = Object.keys(parts[0]!.attributes);
  let vertices = 0;
  let indices = 0;
  for (const part of parts) {
    const count = part.getAttribute('position').count;
    vertices += count;
    indices += part.index?.count ?? count;
  }
  const merged = new BufferGeometry();
  for (const name of names) {
    const itemSize = parts[0]!.getAttribute(name).itemSize;
    const array = new Float32Array(vertices * itemSize);
    let offset = 0;
    for (const part of parts) {
      const attribute = part.getAttribute(name);
      if (attribute === undefined || attribute.itemSize !== itemSize) {
        throw new Error(`Scenery parts to merge differ in their "${name}" attribute.`);
      }
      array.set(attribute.array, offset);
      offset += attribute.count * itemSize;
    }
    merged.setAttribute(name, new BufferAttribute(array, itemSize));
  }
  const index = vertices > 0xffff ? new Uint32Array(indices) : new Uint16Array(indices);
  let at = 0;
  let base = 0;
  for (const part of parts) {
    const count = part.getAttribute('position').count;
    const source = part.index?.array;
    if (source === undefined) {
      for (let i = 0; i < count; i++) {
        index[at++] = base + i;
      }
    } else {
      for (let i = 0; i < source.length; i++) {
        index[at++] = base + source[i]!;
      }
    }
    base += count;
    part.dispose();
  }
  merged.setIndex(new BufferAttribute(index, 1));
  return merged;
}

/** Paints every vertex of `geometry` `hex`, and maps its uv into `rect` of the atlas (a swatch's middle for a plain colour). */
function dress(geometry: BufferGeometry, hex: number, rect: PixelRect = PROP_ATLAS.plain): BufferGeometry {
  const color = new Color(hex);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  const uv = geometry.getAttribute('uv');
  const swatch = rect.width <= 32;
  for (let i = 0; i < uv.count; i++) {
    const u = swatch ? 0.5 : uv.getX(i);
    const v = swatch ? 0.5 : uv.getY(i);
    uv.setXY(i, (rect.x + 0.5 + u * (rect.width - 1)) / PROP_ATLAS_WIDTH, (rect.y + 0.5 + v * (rect.height - 1)) / PROP_ATLAS_HEIGHT);
  }
  return geometry;
}

/**
 * The props' parts, each built and dressed once, then stamped wherever one
 * stands: a copy, shaped (scaled, leant), turned and moved. Much quicker
 * than building each anew, the scenery's cost at boot. Only the stamps are
 * kept; dispose() releases the originals.
 */
class Parts {
  private readonly built = new Map<string, BufferGeometry>();
  private readonly matrix = new Matrix4();
  /** A part's own shape before it is placed (shape()). */
  private readonly local = new Matrix4();

  /** A scratch matrix for the next part's own shape, reset to none. */
  shape(): Matrix4 {
    return this.local.identity();
  }

  /**
   * A copy of the part `key` (built the first time by `build`), shaped by
   * `shape` when given, turned by `heading` about the vertical and moved to
   * (x, 0, z).
   */
  place(key: string, build: () => BufferGeometry, x: number, z: number, heading: number, shape?: Matrix4): BufferGeometry {
    let part = this.built.get(key);
    if (part === undefined) {
      part = build();
      this.built.set(key, part);
    }
    this.matrix.makeRotationY(heading).setPosition(x, 0, z);
    if (shape !== undefined) {
      this.matrix.multiply(shape);
    }
    // Its attributes copied (a primitive's clone() would build the primitive anew first).
    const stamp = new BufferGeometry();
    for (const name of Object.keys(part.attributes)) {
      stamp.setAttribute(name, part.getAttribute(name).clone());
    }
    stamp.setIndex(part.index?.clone() ?? null);
    return stamp.applyMatrix4(this.matrix);
  }

  dispose(): void {
    for (const part of this.built.values()) {
      part.dispose();
    }
    this.built.clear();
  }
}

/** A cheap hash of two numbers into 0..1: stable variation per prop. */
function hash(a: number, b: number): number {
  const value = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * A wooden power pole, its crossarm and three insulators on the arm. The
 * arm lies along its x: across the line, once turned by the line's heading.
 */
function poleGeometry(): BufferGeometry {
  return mergeParts([
    dress(new CylinderGeometry(0.1, 0.14, POLE_HEIGHT, 7).translate(0, POLE_HEIGHT / 2, 0), WOOD),
    dress(new BoxGeometry(1.9, 0.12, 0.12).translate(0, ARM_Y, 0), WOOD),
    ...INSULATOR_OFFSETS.map((offset) => dress(new CylinderGeometry(0.045, 0.06, INSULATOR_TOP, 6).translate(offset, ARM_Y + 0.06 + INSULATOR_TOP / 2, 0), INSULATOR)),
  ]);
}

/** The wires between each pair of neighbouring poles, sagging, as line segments: x, y, z of both ends of each. */
function wireSegments(lines: readonly PowerLine[]): number[] {
  const positions: number[] = [];
  const top = ARM_Y + 0.06 + INSULATOR_TOP;
  for (const line of lines) {
    for (let i = 0; i + 1 < line.poles.length; i++) {
      const a = line.poles[i]!;
      const b = line.poles[i + 1]!;
      const span = Math.hypot(b.x - a.x, b.z - a.z);
      const sag = span * WIRE_SAG_PER_SPAN;
      for (const offset of INSULATOR_OFFSETS) {
        // Each insulator stands along its pole's arm (x turned by the pole's heading).
        const ax = a.x + Math.cos(a.heading) * offset;
        const az = a.z - Math.sin(a.heading) * offset;
        const bx = b.x + Math.cos(b.heading) * offset;
        const bz = b.z - Math.sin(b.heading) * offset;
        for (let s = 0; s < WIRE_SEGMENTS; s++) {
          for (const t of [s / WIRE_SEGMENTS, (s + 1) / WIRE_SEGMENTS]) {
            positions.push(ax + (bx - ax) * t, top - sag * 4 * t * (1 - t), az + (bz - az) * t);
          }
        }
      }
    }
  }
  return positions;
}

/**
 * The wires' pieces (pairs of points from wireSegments) as quads the shader
 * widens across the screen: each corner knows its own end, the other end,
 * and its side.
 */
function wireRibbons(segments: readonly number[]): BufferGeometry {
  const pieces = segments.length / 6;
  const position = new Float32Array(pieces * 4 * 3);
  const other = new Float32Array(pieces * 4 * 3);
  const side = new Float32Array(pieces * 4);
  const indices: number[] = [];
  for (let piece = 0; piece < pieces; piece++) {
    const a = segments.slice(piece * 6, piece * 6 + 3);
    const b = segments.slice(piece * 6 + 3, piece * 6 + 6);
    for (let corner = 0; corner < 4; corner++) {
      const vertex = piece * 4 + corner;
      const [own, far] = corner < 2 ? [a, b] : [b, a];
      position.set(own, vertex * 3);
      other.set(far, vertex * 3);
      // Seen from `own` toward `far`, the other end's corners lie the other way round.
      side[vertex] = corner % 2 === 0 ? (corner < 2 ? 1 : -1) : corner < 2 ? -1 : 1;
    }
    const first = piece * 4;
    indices.push(first, first + 1, first + 2, first + 2, first + 1, first + 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('other', new BufferAttribute(other, 3));
  geometry.setAttribute('side', new BufferAttribute(side, 1));
  geometry.setIndex(indices);
  return geometry;
}

/** The wires' shader: dark, at least a pixel wide, fading as they thin out, in the haze like everything else. */
function wireMaterial(resolution: { readonly value: Vector2 }): ShaderMaterial {
  return new ShaderMaterial({
    // The fog's uniforms copied; the resolution shared, so setViewport reaches it (merging would copy it too).
    uniforms: { ...UniformsUtils.clone(UniformsLib.fog), color: { value: new Color(WIRE_COLOR) }, resolution },
    transparent: true,
    depthWrite: false,
    // Seen from either side: which way a ribbon's corners wind on the screen depends on the wire's direction.
    // One pass does: a wire has no back to draw first.
    side: DoubleSide,
    forceSinglePass: true,
    fog: true,
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      attribute vec3 other;
      attribute float side;
      uniform vec2 resolution;
      varying float vAlpha;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vec4 clip = projectionMatrix * mvPosition;
        vec4 clipOther = projectionMatrix * modelViewMatrix * vec4(other, 1.0);
        if (clip.w < 0.2 || clipOther.w < 0.2) {
          // An end at or behind the eye: nothing to draw.
          gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
          vAlpha = 0.0;
          return;
        }
        vec2 along = clipOther.xy / clipOther.w * resolution - clip.xy / clip.w * resolution;
        vec2 across = vec2(-along.y, along.x) / max(length(along), 0.0001);
        float pixels = ${WIRE_THICKNESS.toFixed(3)} * projectionMatrix[1][1] * resolution.y * 0.5 / clip.w;
        clip.xy += across * side * max(pixels, 1.0) / resolution * clip.w;
        vAlpha = min(pixels, 1.0);
        gl_Position = clip;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform vec3 color;
      varying float vAlpha;
      void main() {
        gl_FragColor = vec4(color, 0.9 * vAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
}

/** A post-and-rail fence from `from` to `to`: weathered posts, each leaning a little its own way, and two rails along the run. */
function addFence(tiles: Tiles, parts: Parts, from: readonly [number, number], to: readonly [number, number]): void {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const length = Math.hypot(dx, dz);
  if (length < 0.5) {
    return;
  }
  const heading = Math.atan2(dx, dz);
  const post = (): BufferGeometry => dress(new BoxGeometry(0.11, 1.2, 0.11).translate(0, 0.55, 0), WEATHERED_WOOD);
  const posts = Math.max(1, Math.round(length / FENCE_POST_SPACING));
  for (let i = 0; i <= posts; i++) {
    const x = from[0] + (dx * i) / posts;
    const z = from[1] + (dz * i) / posts;
    const lean = (hash(x, z) - 0.5) * 0.06;
    tiles.add(x, z, parts.place('fence-post', post, x, z, heading, parts.shape().makeRotationZ(lean)));
  }
  // A rail a meter long, stretched along the run.
  const rail = (): BufferGeometry => dress(new BoxGeometry(0.05, 0.1, 1), WEATHERED_WOOD);
  const middleX = from[0] + dx / 2;
  const middleZ = from[1] + dz / 2;
  for (const y of [0.52, 0.94]) {
    tiles.add(middleX, middleZ, parts.place('fence-rail', rail, middleX, middleZ, heading, parts.shape().makeScale(1, 1, length).setPosition(0.07, y, 0)));
  }
}

/** A dry-stone wall from `from` to `to`, in stretches each showing the stones' picture, a little uneven on top. */
function addWall(tiles: Tiles, parts: Parts, from: readonly [number, number], to: readonly [number, number]): void {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const length = Math.hypot(dx, dz);
  if (length < 0.5) {
    return;
  }
  const heading = Math.atan2(dx, dz);
  // A meter of wall, a meter tall, standing on the ground, the picture across its length (z): stretched to size.
  const block = (): BufferGeometry => dress(new BoxGeometry(WALL_THICKNESS, 1, 1).translate(0, 0.5, 0), 0xffffff, PROP_ATLAS.stones);
  const stretches = Math.max(1, Math.round(length / WALL_STRETCH));
  const stretch = length / stretches;
  for (let i = 0; i < stretches; i++) {
    const t = (i + 0.5) / stretches;
    const x = from[0] + dx * t;
    const z = from[1] + dz * t;
    const height = WALL_HEIGHT * (0.88 + 0.2 * hash(x, z));
    tiles.add(x, z, parts.place('wall', block, x, z, heading, parts.shape().makeScale(1, height, stretch + 0.02)));
  }
}

/** A boulder of shape `shape` (of ROCK_SHAPES), a meter across: a lumpy, faceted stone, its tint by its shape. */
function rockGeometry(shape: number): BufferGeometry {
  const rock = new IcosahedronGeometry(0.5, shape % 3 === 0 ? 1 : 0);
  const position = rock.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const px = position.getX(i);
    const py = position.getY(i);
    const pz = position.getZ(i);
    // Nudge each corner by a hash of where it is, so the copies of a shared corner move together.
    const bulge = 0.8 + 0.4 * hash(px * 7 + py * 3, pz * 5 + shape);
    position.setXYZ(i, px * bulge, py * bulge, pz * bulge);
  }
  rock.computeVertexNormals();
  // One corner per vertex (flat faces), indexed so it merges with the rest.
  rock.setIndex(Array.from({ length: position.count }, (_, i) => i));
  return dress(rock, ROCK_TINTS[shape % ROCK_TINTS.length]!);
}

/** A bench, a litter bin or a bus shelter, its front toward +z (the road, once placed). */
function furnitureGeometry(kind: StreetFurnitureKind): BufferGeometry {
  const parts: BufferGeometry[] = [];
  if (kind === 'bench') {
    parts.push(
      dress(new BoxGeometry(1.6, 0.06, 0.42).translate(0, 0.45, 0), BENCH_WOOD),
      dress(new BoxGeometry(1.6, 0.34, 0.05).rotateX(-0.2).translate(0, 0.72, -0.22), BENCH_WOOD),
      ...[-0.7, 0.7].map((x) => dress(new BoxGeometry(0.06, 0.45, 0.46).translate(x, 0.225, -0.02), DARK_STEEL)),
    );
  } else if (kind === 'bin') {
    parts.push(
      dress(new CylinderGeometry(0.24, 0.22, 0.75, 10).translate(0, 0.5, 0), BIN_GREEN),
      dress(new CylinderGeometry(0.26, 0.26, 0.05, 10).translate(0, 0.9, 0), DARK_STEEL),
      dress(new BoxGeometry(0.06, 0.2, 0.06).translate(0, 0.1, 0), DARK_STEEL),
    );
  } else {
    // A bus shelter: four posts, a roof, a back and sides, a bench inside, and its sign on a pole beside it.
    for (const [x, z] of [
      [-1.65, -0.65],
      [1.65, -0.65],
      [-1.65, 0.65],
      [1.65, 0.65],
    ] as const) {
      parts.push(dress(new BoxGeometry(0.08, 2.4, 0.08).translate(x, 1.2, z), SHELTER_FRAME));
    }
    parts.push(
      dress(new BoxGeometry(3.7, 0.12, 1.7).translate(0, 2.46, 0), SHELTER_ROOF),
      dress(new BoxGeometry(3.3, 1.9, 0.03).translate(0, 1.3, -0.65), SHELTER_PANEL),
      ...[-1.65, 1.65].map((x) => dress(new BoxGeometry(0.03, 1.9, 1.2).translate(x, 1.3, -0.05), SHELTER_PANEL)),
      dress(new BoxGeometry(2.4, 0.06, 0.4).translate(0, 0.45, -0.4), BENCH_WOOD),
      dress(new BoxGeometry(0.06, 2.6, 0.06).translate(2.2, 1.3, 0.55), DARK_STEEL),
    );
    for (const face of [0, Math.PI]) {
      parts.push(dress(new PlaneGeometry(0.5, 0.5).rotateY(face + Math.PI / 2).translate(2.2 + (face === 0 ? 0.035 : -0.035), 2.35, 0.55), 0xffffff, PROP_ATLAS.busStop));
    }
  }
  return mergeParts(parts);
}

/**
 * A billboard: two steel legs, a dark frame, poster `ad` on the face toward
 * the traffic (+z) and another business's on the back, for the other way.
 */
function billboardGeometry(ad: number): BufferGeometry {
  const posters = PROP_ATLAS.posters;
  return mergeParts([
    ...[-1.6, 1.6].map((x) => dress(new BoxGeometry(0.24, 4.8, 0.24).translate(x, 2.4, -0.12), STEEL)),
    dress(new BoxGeometry(6.4, 3.3, 0.2).translate(0, 4.65, -0.1), DARK_STEEL),
    dress(new PlaneGeometry(6, 3).translate(0, 4.65, 0.005), 0xffffff, posters[ad % posters.length]!),
    dress(new PlaneGeometry(6, 3).rotateY(Math.PI).translate(0, 4.65, -0.205), 0xffffff, posters[(ad + 2) % posters.length]!),
    dress(new BoxGeometry(6.4, 0.08, 0.6).translate(0, 3.0, 0.2), STEEL),
  ]);
}

/** A speed limit sign: a grey post, the limit on its face toward the traffic (+z), its back plain. */
function speedSignGeometry(limitKmh: number): BufferGeometry {
  const face = SPEED_LIMIT_FACES[limitKmh] ?? PROP_ATLAS.speed50;
  return mergeParts([
    dress(new CylinderGeometry(0.04, 0.04, 2.6, 6).translate(0, 1.3, -0.03), STEEL),
    dress(new CircleGeometry(0.4, 24).translate(0, 2.25, 0), 0xffffff, face),
    dress(new CircleGeometry(0.4, 24).rotateY(Math.PI).translate(0, 2.25, -0.012), 0xffffff, PROP_ATLAS.signBack),
  ]);
}

/**
 * A pavement beside its street, along its outline (townscape.ts): the
 * flagstones' top (into `paving`) and the kerb, its face along the road and
 * its back down to the ground (into `tiles`), in pieces of up to
 * SIDEWALK_PIECE_ROWS rows, each filed where its middle is.
 */
function addSidewalk(tiles: Tiles, paving: Tiles, road: RoadPath, sidewalk: Sidewalk): void {
  const rows = sidewalkOutline(road, sidewalk);
  const count = rows.length / OUTLINE_ROW;
  const top = ROAD_TOP_Y + KERB_HEIGHT_METERS;
  for (let first = 0; first < count - 1; first += SIDEWALK_PIECE_ROWS) {
    // Each piece shares its first row with the last one's end.
    const last = Math.min(count - 1, first + SIDEWALK_PIECE_ROWS);
    const tops: number[] = [];
    const topUvs: number[] = [];
    const kerb: number[] = [];
    for (let row = first; row <= last; row++) {
      const at = row * OUTLINE_ROW;
      const along = rows[at]!;
      const [kerbX, kerbZ, backX, backZ] = [rows[at + 1]!, rows[at + 2]!, rows[at + 3]!, rows[at + 4]!];
      tops.push(kerbX, top, kerbZ, backX, top, backZ);
      topUvs.push(0, along / PAVING_TILE_METERS, SIDEWALK_WIDTH_METERS / PAVING_TILE_METERS, along / PAVING_TILE_METERS);
      kerb.push(kerbX, ROAD_TOP_Y, kerbZ, kerbX, top, kerbZ, backX, top, backZ, backX, 0, backZ);
    }
    const middle = Math.round((first + last) / 2) * OUTLINE_ROW;
    const topGeometry = ribbon(tops, 2, last - first, sidewalk.side);
    topGeometry.setAttribute('uv', new BufferAttribute(new Float32Array(topUvs), 2));
    paving.add(rows[middle + 1]!, rows[middle + 2]!, topGeometry);
    tiles.add(rows[middle + 1]!, rows[middle + 2]!, dress(kerbGeometry(kerb, last - first, sidewalk.side), KERB));
  }
}

/**
 * A ribbon through `rows` + 1 rows of `columns` points (x, y, z each),
 * facing up: the pavement's top. `side` says which way the rows run across
 * the road, so the faces are wound to look up either side.
 */
function ribbon(positions: readonly number[], columns: number, rows: number, side: 1 | -1): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array((positions.length / 3) * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  const indices: number[] = [];
  for (let row = 0; row < rows; row++) {
    const a = row * columns;
    const b = a + columns;
    if (side === 1) {
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    } else {
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  geometry.setIndex(indices);
  return geometry;
}

/**
 * The kerb's two faces from four points a row (the road's edge at the
 * road's height and at the kerb's top, the pavement's back at its top and
 * at the ground): the face toward the road and the back toward the verge.
 */
function kerbGeometry(points: readonly number[], rows: number, side: 1 | -1): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const vertex = (row: number, corner: number): [number, number, number] => {
    const i = (row * 4 + corner) * 3;
    return [points[i]!, points[i + 1]!, points[i + 2]!];
  };
  for (const [bottom, upper] of [
    [0, 1],
    [3, 2],
  ] as const) {
    const base = positions.length / 3;
    for (let row = 0; row <= rows; row++) {
      const lower = vertex(row, bottom);
      const higher = vertex(row, upper);
      // The face looks away from the pavement's middle: toward the road for the kerb, the verge for the back.
      const next = vertex(Math.min(rows, row + 1), bottom);
      const previous = vertex(Math.max(0, row - 1), bottom);
      const alongX = next[0] - previous[0];
      const alongZ = next[2] - previous[2];
      const length = Math.hypot(alongX, alongZ) || 1;
      const outward = (bottom === 0 ? -1 : 1) * side;
      normals.push((-alongZ / length) * outward, 0, (alongX / length) * outward, (-alongZ / length) * outward, 0, (alongX / length) * outward);
      positions.push(...lower, ...higher);
    }
    for (let row = 0; row < rows; row++) {
      const a = base + row * 2;
      const b = a + 2;
      if ((bottom === 0) === (side === 1)) {
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      } else {
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array((positions.length / 3) * 2), 2));
  geometry.setIndex(indices);
  return geometry;
}

/** A sheep: a woolly body on dark legs, a tail; its head (turning at the neck) apart. */
function sheepGeometry(): [BufferGeometry, BufferGeometry] {
  const wool = new IcosahedronGeometry(1, 1).scale(0.36, 0.33, 0.56).translate(0, 0.62, 0);
  wool.setIndex(Array.from({ length: wool.getAttribute('position').count }, (_, i) => i));
  const body = mergeParts([
    dress(wool, 0xffffff),
    ...[
      [-0.16, 0.3],
      [0.16, 0.3],
      [-0.16, -0.3],
      [0.16, -0.3],
    ].map(([x, z]) => dress(new BoxGeometry(0.07, 0.42, 0.07).translate(x!, 0.21, z!), 0x2b2622)),
    dress(new BoxGeometry(0.08, 0.14, 0.08).translate(0, 0.62, -0.56), 0xffffff),
  ]);
  const head = mergeParts([
    dress(new BoxGeometry(0.17, 0.19, 0.3).translate(0, -0.04, 0.16), 0xffffff),
    ...[-1, 1].map((side) => dress(new BoxGeometry(0.12, 0.04, 0.06).translate(side * 0.12, 0.02, 0.06), 0xffffff)),
  ]);
  return [body, head];
}

/** A cow: its body, legs, udder and tail, in its hide's colour; its head with horns (turning at the neck) apart. */
function cowGeometry(): [BufferGeometry, BufferGeometry] {
  const body = mergeParts([
    dress(new BoxGeometry(0.62, 0.66, 1.7).translate(0, 1.05, 0), 0xffffff),
    dress(new BoxGeometry(0.56, 0.2, 0.5).translate(0, 1.4, 0.55), 0xffffff),
    ...[
      [-0.22, 0.62],
      [0.22, 0.62],
      [-0.22, -0.62],
      [0.22, -0.62],
    ].map(([x, z]) => dress(new BoxGeometry(0.13, 0.74, 0.13).translate(x!, 0.37, z!), 0xffffff)),
    dress(new BoxGeometry(0.28, 0.14, 0.26).translate(0, 0.66, -0.35), 0xe8b5a8),
    dress(new BoxGeometry(0.05, 0.62, 0.05).translate(0, 0.95, -0.87), 0xffffff),
  ]);
  const head = mergeParts([
    dress(new BoxGeometry(0.3, 0.34, 0.5).translate(0, -0.1, 0.28), 0xffffff),
    dress(new BoxGeometry(0.26, 0.2, 0.12).translate(0, -0.2, 0.55), 0xd9b7a6),
    ...[-1, 1].map((side) => dress(new BoxGeometry(0.14, 0.05, 0.05).rotateZ(side * 0.4).translate(side * 0.2, 0.1, 0.12), 0xe8e2cf)),
  ]);
  return [body, head];
}
