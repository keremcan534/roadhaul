import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
  type Scene,
} from 'three';
import { SeededRandom } from '../../core/random/SeededRandom';
import { rectangleContains } from '../../data/definitions/MapDefinition';
import type { Fraction } from '../../data/units';
import type { BuildingObstacle, DrivingWorld, Field } from '../../domain/world/DrivingWorld';
import { createRoadPoint } from '../../domain/world/RoadPath';
import type { PrelitMaterials } from './lighting';

/** What grows on the verges: tufts of grass, tufts in flower, and low bushes. */
export const ROADSIDE_KINDS = ['tuft', 'flower', 'bush'] as const;
export type RoadsideKind = (typeof ROADSIDE_KINDS)[number];

/**
 * At full density a clump of plants grows every this many meters along
 * each side of every road, between these distances out from the asphalt's
 * edge (past the gravel shoulder), the most near it; a clump is up to this
 * many tufts within this far of each other. This share of the clumps are in
 * flower, and this share are bushes, which keep further out.
 */
const SPACING_METERS = 0.8;
const VERGE_METERS = { near: 1.5, far: 7 } as const;
const BUSH_VERGE_METERS = { near: 3, far: 12 } as const;
const CLUMP_TUFTS = 4;
const CLUMP_METERS = 0.7;
const FLOWER_SHARE = 0.16;
const BUSH_SHARE = 0.05;
/** Plants keep this far from the sea's edge (the beach), fields and buildings. */
const SEA_MARGIN_METERS = 8;
const FIELD_MARGIN_METERS = 1.5;
const BUILDING_MARGIN_METERS = 1.5;
/**
 * The plants are kept in square cells this wide. Those within the draw
 * distance of the camera (at full density; nearer at lower) are drawn,
 * gathered again once the camera has moved this far.
 */
const CELL_METERS = 40;
const DRAW_DISTANCE_METERS: Readonly<Record<RoadsideKind, number>> = { tuft: 120, flower: 100, bush: 220 };
/** At the lowest density plants are drawn this share of their distance. */
const NEAREST_DRAW = 0.6;
const REGATHER_METERS = 20;
/** Most plants of each kind drawn at once. */
const CAPACITY: Readonly<Record<RoadsideKind, number>> = { tuft: 6000, flower: 1400, bush: 700 };
/** How far the wind bends a plant, per meter of height squared. */
const WIND_BEND: Readonly<Record<RoadsideKind, number>> = { tuft: 0.28, flower: 0.24, bush: 0.035 };
/** The wind's time runs round this many seconds, so it keeps its precision. */
const WIND_PERIOD_SECONDS = 3600;

const UP = new Vector3(0, 1, 0);

export interface RoadsideViewOptions {
  /** Share of the plants grown and how far away they are drawn (the graphics preset's). Default: 1. */
  readonly density?: Fraction;
  /** Where their material registers to be lit like the ground (pre-lit, like it). */
  readonly prelit?: PrelitMaterials;
}

/**
 * The plants grown along the roads through one cell, by kind: where each
 * stands and how it is turned and sized (PLACE_FLOATS each: x, z, turn,
 * scale), and its tint. Their matrices are made only for the plants drawn.
 */
type CellPlants = Readonly<Record<RoadsideKind, { readonly places: Float32Array; readonly colors: Float32Array }>>;

const PLACE_FLOATS = 4;

/** What a cell's plants must keep clear of: whether the sea is near, and the fields and buildings that reach into it. */
interface CellSurroundings {
  readonly sea: boolean;
  readonly fields: readonly Field[];
  readonly buildings: readonly BuildingObstacle[];
}

/**
 * Plants on the roads' verges (roadmap: graphics): tufts of grass along both
 * sides of every road, some in flower (white, yellow, violet, red), and low
 * bushes further out, never on a road, yard, lot, field, building or beach.
 * Each kind is one instanced mesh, pre-lit like the ground and fogged like
 * it, holding only the plants near the camera: copied from a grid of cells
 * whenever the camera has moved a few tens of meters (update), so the rest
 * of the map costs nothing. A cell's plants grow the first time it comes
 * near (a fraction of a millisecond), from a seed of its own, so the same
 * world always grows the same plants whatever the way it is explored. They
 * sway in the wind (a vertex shader), the taller the more.
 */
export class RoadsideView {
  private readonly root = new Group();
  private readonly meshes: Readonly<Record<RoadsideKind, InstancedMesh>>;
  /** The stretches of road whose centreline runs through each cell: road index, from and to (meters along), in threes. */
  private readonly stretches = new Map<number, number[]>();
  /** Each cell's plants, once grown (null: none grow there). */
  private readonly grown = new Map<number, CellPlants | null>();
  private readonly surroundings = new Map<number, CellSurroundings>();
  private readonly grownCounts: Record<RoadsideKind, number> = { tuft: 0, flower: 0, bush: 0 };
  private readonly spacing: number;
  private readonly wind = { value: 0 };
  private readonly drawScale: number;
  private readonly point = createRoadPoint();
  private readonly matrix = new Matrix4();
  private readonly rotation = new Quaternion();
  private readonly position = new Vector3();
  private readonly size = new Vector3();
  private gatheredX = Number.NaN;
  private gatheredZ = Number.NaN;

  constructor(
    private readonly scene: Scene,
    private readonly world: DrivingWorld,
    options: RoadsideViewOptions = {},
  ) {
    const density = Math.min(1, Math.max(0, options.density ?? 1));
    this.spacing = SPACING_METERS / Math.max(0.05, density);
    this.drawScale = NEAREST_DRAW + (1 - NEAREST_DRAW) * density;
    world.roads.forEach((road, index) => {
      // Consecutive samples in one cell make one stretch.
      let from = 0;
      let cell = cellOf(road.x(0), road.z(0));
      for (let sample = 1; sample <= road.pointCount; sample++) {
        const next = sample < road.pointCount ? cellOf(road.x(sample), road.z(sample)) : Number.NaN;
        if (next !== cell) {
          const to = sample < road.pointCount ? road.distances[sample]! : road.lengthMeters;
          const list = this.stretches.get(cell);
          if (list === undefined) {
            this.stretches.set(cell, [index, from, to]);
          } else {
            list.push(index, from, to);
          }
          from = to;
          cell = next;
        }
      }
    });
    const geometries: Record<RoadsideKind, BufferGeometry> = {
      tuft: tuftGeometry(new SeededRandom(3), 8, []),
      flower: tuftGeometry(new SeededRandom(5), 5, [0xf4f1e6, 0xf2cf3a, 0x9a6fd0, 0xd8413a]),
      bush: bushGeometry(new SeededRandom(9)),
    };
    const meshes = {} as Record<RoadsideKind, InstancedMesh>;
    for (const kind of ROADSIDE_KINDS) {
      const material = new MeshBasicMaterial({ vertexColors: true });
      // A blade is one triangle: seen from either side.
      if (kind !== 'bush') {
        material.side = DoubleSide;
      }
      this.sway(material, WIND_BEND[kind]);
      options.prelit?.add(material);
      const capacity = CAPACITY[kind];
      const mesh = new InstancedMesh(geometries[kind], material, capacity);
      mesh.name = `roadside:${kind}`;
      mesh.count = 0;
      mesh.visible = false;
      // The instances change as the camera moves: bounds computed once would go stale.
      mesh.frustumCulled = false;
      mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      meshes[kind] = mesh;
      this.root.add(mesh);
    }
    this.meshes = meshes;
    this.root.name = 'roadside';
    scene.add(this.root);
  }

  /** How many plants of `kind` have grown so far (near where the camera has been), and how many are drawn now. */
  plants(kind: RoadsideKind): { readonly grown: number; readonly drawn: number } {
    return { grown: this.grownCounts[kind], drawn: this.meshes[kind].count };
  }

  /**
   * Draws the plants near the camera at (`cameraX`, `cameraZ`), gathering
   * them again (and growing the cells that come near for the first time)
   * when it has moved far enough, and lets the wind blow `deltaSeconds` on.
   * Allocation-free, but for the cells it grows.
   */
  update(cameraX: number, cameraZ: number, deltaSeconds: number): void {
    this.wind.value = (this.wind.value + deltaSeconds) % WIND_PERIOD_SECONDS;
    const moved = Math.hypot(cameraX - this.gatheredX, cameraZ - this.gatheredZ);
    if (moved < REGATHER_METERS) {
      return;
    }
    this.gatheredX = cameraX;
    this.gatheredZ = cameraZ;
    for (let i = 0; i < ROADSIDE_KINDS.length; i++) {
      this.gather(ROADSIDE_KINDS[i]!, cameraX, cameraZ);
    }
  }

  dispose(): void {
    this.scene.remove(this.root);
    for (const kind of ROADSIDE_KINDS) {
      const mesh = this.meshes[kind];
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
      mesh.dispose();
    }
  }

  /** Copies `kind`'s plants in the cells within its draw distance of (x, z) into its mesh, up to its capacity. */
  private gather(kind: RoadsideKind, x: number, z: number): void {
    const mesh = this.meshes[kind];
    const capacity = mesh.instanceMatrix.count;
    const matrices = mesh.instanceMatrix.array as Float32Array;
    const colors = mesh.instanceColor!.array as Float32Array;
    const distance = DRAW_DISTANCE_METERS[kind] * this.drawScale;
    const reach = Math.ceil(distance / CELL_METERS);
    const homeX = Math.floor(x / CELL_METERS);
    const homeZ = Math.floor(z / CELL_METERS);
    const within = (distance + CELL_METERS * 0.71) ** 2;
    const flatten = kind === 'bush' ? 0.8 : 1;
    let count = 0;
    for (let dz = -reach; dz <= reach && count < capacity; dz++) {
      for (let dx = -reach; dx <= reach && count < capacity; dx++) {
        const centreX = (homeX + dx + 0.5) * CELL_METERS;
        const centreZ = (homeZ + dz + 0.5) * CELL_METERS;
        if ((centreX - x) ** 2 + (centreZ - z) ** 2 > within) {
          continue;
        }
        const cell = this.plantsIn(cellKey(homeX + dx, homeZ + dz));
        if (cell === null) {
          continue;
        }
        const { places, colors: tints } = cell[kind];
        const take = Math.min(places.length / PLACE_FLOATS, capacity - count);
        for (let i = 0; i < take; i++) {
          const scale = places[i * PLACE_FLOATS + 3]!;
          this.rotation.setFromAxisAngle(UP, places[i * PLACE_FLOATS + 2]!);
          this.position.set(places[i * PLACE_FLOATS]!, 0, places[i * PLACE_FLOATS + 1]!);
          this.size.set(scale, scale * flatten, scale);
          this.matrix.compose(this.position, this.rotation, this.size).toArray(matrices, (count + i) * 16);
          colors[(count + i) * 3] = tints[i * 3]!;
          colors[(count + i) * 3 + 1] = tints[i * 3 + 1]!;
          colors[(count + i) * 3 + 2] = tints[i * 3 + 2]!;
        }
        count += take;
      }
    }
    mesh.count = count;
    mesh.visible = count > 0;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.needsUpdate = true;
  }

  /** The plants along the roads through the cell `key`, grown now if they have not been yet; null where no road runs. */
  private plantsIn(key: number): CellPlants | null {
    const known = this.grown.get(key);
    if (known !== undefined) {
      return known;
    }
    const stretches = this.stretches.get(key);
    const plants = stretches === undefined ? null : this.grow(key, stretches);
    this.grown.set(key, plants);
    return plants;
  }

  /** Grows the plants along `stretches` (road index, from, to, in threes), from the cell's own seed. */
  private grow(key: number, stretches: readonly number[]): CellPlants {
    const random = new SeededRandom(key % 2147483647);
    const found: Record<RoadsideKind, number[]> = { tuft: [], flower: [], bush: [] };
    const tint: Record<RoadsideKind, number[]> = { tuft: [], flower: [], bush: [] };
    const point = this.point;
    const spacing = this.spacing;
    for (let i = 0; i < stretches.length; i += 3) {
      const road = this.world.roads[stretches[i]!]!;
      const to = stretches[i + 2]!;
      const edge = road.widthMeters / 2;
      for (let along = stretches[i + 1]! + random.range(0, spacing); along < to; along += spacing * random.range(0.6, 1.4)) {
        road.pointAt(along, point);
        for (let side = -1; side <= 1; side += 2) {
          const roll = random.next();
          const kind: RoadsideKind = roll < BUSH_SHARE ? 'bush' : roll < BUSH_SHARE + FLOWER_SHARE ? 'flower' : 'tuft';
          const verge = kind === 'bush' ? BUSH_VERGE_METERS : VERGE_METERS;
          // Thickest by the road, thinning out into the meadow.
          const out = edge + verge.near + (verge.far - verge.near) * random.next() ** 1.8;
          // Across the road: its direction turned a right angle.
          const centreX = point.x + point.directionZ * out * side;
          const centreZ = point.z - point.directionX * out * side;
          const shade = random.range(0.82, 1.12);
          const dry = random.next();
          const clump = kind === 'bush' ? 1 : random.int(1, CLUMP_TUFTS);
          for (let plant = 0; plant < clump; plant++) {
            const x = centreX + random.range(-CLUMP_METERS, CLUMP_METERS);
            const z = centreZ + random.range(-CLUMP_METERS, CLUMP_METERS);
            const scale = kind === 'bush' ? random.range(0.6, 1.4) : random.range(0.75, 1.4);
            const turn = random.range(0, Math.PI * 2);
            const tone = shade * random.range(0.94, 1.06);
            if (this.free(x, z)) {
              found[kind].push(x, z, turn, scale);
              // Greens that vary, some grass drier; flowers keep their colours.
              if (kind === 'flower') {
                tint[kind].push(tone, tone, tone);
              } else {
                tint[kind].push(tone * (1 + dry * 0.18), tone, tone * (1 - dry * 0.15));
              }
            }
          }
        }
      }
    }
    const plants = {} as Record<RoadsideKind, { places: Float32Array; colors: Float32Array }>;
    for (const kind of ROADSIDE_KINDS) {
      plants[kind] = { places: new Float32Array(found[kind]), colors: new Float32Array(tint[kind]) };
      this.grownCounts[kind] += found[kind].length / PLACE_FLOATS;
    }
    return plants;
  }

  /** Whether a plant may grow at (x, z): on the grass, off the beach, out of fields and clear of buildings. */
  private free(x: number, z: number): boolean {
    const world = this.world;
    const half = world.halfSizeMeters - 5;
    if (Math.abs(x) > half || Math.abs(z) > half || world.surfaceAt(x, z).name !== 'grass') {
      return false;
    }
    const near = this.surroundingsOf(x, z);
    if (near.sea && world.isWater(x, z, SEA_MARGIN_METERS)) {
      return false;
    }
    for (const field of near.fields) {
      if (rectangleContains(field.area, x, z, FIELD_MARGIN_METERS)) {
        return false;
      }
    }
    for (const building of near.buildings) {
      if (
        x > building.minX - BUILDING_MARGIN_METERS &&
        x < building.maxX + BUILDING_MARGIN_METERS &&
        z > building.minZ - BUILDING_MARGIN_METERS &&
        z < building.maxZ + BUILDING_MARGIN_METERS
      ) {
        return false;
      }
    }
    return true;
  }

  /** The surroundings of the cell (x, z) lies in, worked out the first time a plant there asks. */
  private surroundingsOf(x: number, z: number): CellSurroundings {
    const key = cellOf(x, z);
    const cached = this.surroundings.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const world = this.world;
    const minX = Math.floor(x / CELL_METERS) * CELL_METERS;
    const minZ = Math.floor(z / CELL_METERS) * CELL_METERS;
    const maxX = minX + CELL_METERS;
    const maxZ = minZ + CELL_METERS;
    const reach = (CELL_METERS / 2) * Math.SQRT2;
    const surroundings: CellSurroundings = {
      sea: world.isWater(minX + CELL_METERS / 2, minZ + CELL_METERS / 2, SEA_MARGIN_METERS + reach),
      fields: world.fields.filter(({ area }) => {
        const radius = Math.hypot(area.lengthMeters, area.widthMeters) / 2 + FIELD_MARGIN_METERS;
        return area.x + radius > minX && area.x - radius < maxX && area.z + radius > minZ && area.z - radius < maxZ;
      }),
      buildings: world.buildings.filter(
        (building) =>
          building.maxX + BUILDING_MARGIN_METERS > minX &&
          building.minX - BUILDING_MARGIN_METERS < maxX &&
          building.maxZ + BUILDING_MARGIN_METERS > minZ &&
          building.minZ - BUILDING_MARGIN_METERS < maxZ,
      ),
    };
    this.surroundings.set(key, surroundings);
    return surroundings;
  }

  /**
   * Bends `material`'s plants in the wind: the tips the most, each plant at
   * its own phase. The bend is a uniform, so every kind shares one program.
   */
  private sway(material: MeshBasicMaterial, bend: number): void {
    const wind = this.wind;
    const windBend = { value: bend };
    material.onBeforeCompile = (shader) => {
      shader.uniforms['windTime'] = wind;
      shader.uniforms['windBend'] = windBend;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float windTime;\nuniform float windBend;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 plantRoot = instanceMatrix[3].xyz;
          #else
            vec3 plantRoot = vec3( 0.0 );
          #endif
          float gust = sin( windTime * 1.9 + plantRoot.x * 0.35 + plantRoot.z * 0.27 )
            + 0.5 * sin( windTime * 3.3 + plantRoot.x * 0.9 - plantRoot.z * 0.6 );
          float bend = gust * position.y * position.y * windBend;
          transformed.x += bend;
          transformed.z += bend * 0.6;`,
        );
    };
    material.customProgramCacheKey = () => 'roadside-wind';
  }
}

/**
 * A tuft of `blades` grass blades, each a thin triangle leaning out from the
 * root, dark at the root and light at the tip; with `blossoms` colours, as
 * many small flowers stand among them on stalks. About half a meter tall.
 */
function tuftGeometry(random: SeededRandom, blades: number, blossoms: readonly number[]): BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const root = new Color(0x2e4a1d);
  const tip = new Color(0x86a64c);
  const add = (x: number, y: number, z: number, color: Color): void => {
    positions.push(x, y, z);
    colors.push(color.r, color.g, color.b);
  };
  for (let blade = 0; blade < blades; blade++) {
    const angle = (blade / blades) * Math.PI * 2 + random.range(-0.3, 0.3);
    const from = random.range(0, 0.12);
    const lean = random.range(0.1, 0.3);
    const height = random.range(0.42, 0.82);
    const baseX = Math.cos(angle) * from;
    const baseZ = Math.sin(angle) * from;
    const acrossX = -Math.sin(angle) * 0.045;
    const acrossZ = Math.cos(angle) * 0.045;
    add(baseX - acrossX, 0, baseZ - acrossZ, root);
    add(baseX + acrossX, 0, baseZ + acrossZ, root);
    add(baseX + Math.cos(angle) * lean, height, baseZ + Math.sin(angle) * lean, tip);
  }
  const blossom = new Color();
  blossoms.forEach((hex, index) => {
    blossom.setHex(hex);
    const angle = (index / blossoms.length) * Math.PI * 2 + random.range(-0.4, 0.4);
    const x = Math.cos(angle) * random.range(0.06, 0.16);
    const z = Math.sin(angle) * random.range(0.06, 0.16);
    const y = random.range(0.4, 0.62);
    const petal = 0.07;
    // A stalk, then the flower as two crossed, flat-ish triangles facing up.
    add(x - 0.008, 0, z, root);
    add(x + 0.008, 0, z, root);
    add(x, y, z, tip);
    add(x - petal, y, z - petal, blossom);
    add(x + petal, y, z - petal * 0.3, blossom);
    add(x, y + 0.02, z + petal, blossom);
    add(x - petal * 0.3, y, z + petal * 0.9, blossom);
    add(x + petal * 0.9, y + 0.01, z + petal * 0.4, blossom);
    add(x - petal * 0.6, y + 0.02, z - petal * 0.8, blossom);
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  return geometry;
}

/**
 * A low, lumpy bush: a squashed icosahedron with its corners pushed in and
 * out, each face shaded as if lit from above (the material is unlit, like
 * the ground's), darker underneath. About a meter across, standing on the
 * ground.
 */
function bushGeometry(random: SeededRandom): BufferGeometry {
  const geometry = new IcosahedronGeometry(0.6, 0);
  const position = geometry.getAttribute('position');
  // The icosahedron repeats each corner for every face that meets there: move them together, or it tears.
  const pushes = new Map<string, number>();
  for (let i = 0; i < position.count; i++) {
    const key = `${position.getX(i).toFixed(3)},${position.getY(i).toFixed(3)},${position.getZ(i).toFixed(3)}`;
    let push = pushes.get(key);
    if (push === undefined) {
      push = random.range(0.82, 1.15);
      pushes.set(key, push);
    }
    position.setXYZ(i, position.getX(i) * push, Math.max(-0.1, position.getY(i) * push) + 0.42, position.getZ(i) * push);
  }
  const colors = new Float32Array(position.count * 3);
  const light = new Vector3(0.35, 1, 0.25).normalize();
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const edge = new Vector3();
  const normal = new Vector3();
  const dark = new Color(0x2b4a22);
  const lit = new Color(0x5f8a3a);
  const shade = new Color();
  for (let face = 0; face < position.count; face += 3) {
    a.fromBufferAttribute(position, face);
    b.fromBufferAttribute(position, face + 1);
    c.fromBufferAttribute(position, face + 2);
    normal.subVectors(c, b).cross(edge.subVectors(a, b)).normalize();
    const brightness = Math.max(0, normal.dot(light)) * 0.8 + 0.2 * Math.min(1, (a.y + b.y + c.y) / 3 / 0.9);
    shade.copy(dark).lerp(lit, Math.min(1, brightness));
    for (let corner = 0; corner < 3; corner++) {
      shade.toArray(colors, (face + corner) * 3);
    }
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.deleteAttribute('normal');
  geometry.deleteAttribute('uv');
  return geometry;
}

/** The cell (x, z) lies in, as one number (column and row packed in 16 bits each). */
function cellOf(x: number, z: number): number {
  return cellKey(Math.floor(x / CELL_METERS), Math.floor(z / CELL_METERS));
}

function cellKey(column: number, row: number): number {
  return (column + 32768) * 65536 + (row + 32768);
}
