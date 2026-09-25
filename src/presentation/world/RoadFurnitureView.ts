import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { DrivingWorld } from '../../domain/world/DrivingWorld';
import type { GuardRail } from '../../domain/world/guardRails';
import { createRoadPoint } from '../../domain/world/RoadPath';
import type { SkyUniforms } from './EnvironmentView';
import { reflectSky } from './skyReflection';

/**
 * Delineator posts stand every this many meters along both sides of rural
 * roads and highways, this far out from the asphalt's edge (on the verge,
 * past the gravel), and keep this far from junctions.
 */
const POST_SPACING_METERS = 40;
const POST_OUT_METERS = 1.9;
const JUNCTION_CLEARANCE_METERS = 18;
/** …and this far from a guard rail's posts. */
const RAIL_CLEARANCE_METERS = 3;
/**
 * Only the posts within this distance of the truck are drawn (further out
 * they are specks), gathered again whenever it has moved this far.
 */
const POST_DRAW_METERS = 300;
const POST_REGATHER_METERS = 20;
/**
 * A guard rail's beam: its W profile from the bottom up, each row's height
 * and how far it stands out toward the road (DrivingWorld places the rails).
 */
const BEAM_PROFILE = [
  { y: 0.53, out: 0 },
  { y: 0.6, out: 0.05 },
  { y: 0.685, out: 0.012 },
  { y: 0.77, out: 0.05 },
  { y: 0.84, out: 0 },
] as const;
/** Its posts stand this far behind the beam, a spacer block between; its ends bend away from the road. */
const RAIL_POST_BEHIND_METERS = 0.2;
const RAIL_END = { along: 1.3, away: 0.4 } as const;
/** Rails are cut into square tiles this wide, so those out of view are not drawn. */
const RAIL_TILE_METERS = 600;
/**
 * A reflector shines in the headlights (setLamps, update): brightest dead
 * ahead of the truck within this distance, fading out by the next, and
 * across this cone (the cosine of its half-angle).
 */
const REFLECTOR_REACH_METERS = { bright: 50, gone: 150 } as const;
const REFLECTOR_CONE_COS = 0.88;
const REFLECTOR_COLOR = 0xffb21e;

export interface RoadFurnitureViewOptions {
  /** The sky the rails' galvanised steel mirrors (EnvironmentView.sky). */
  readonly sky?: SkyUniforms;
  /** Posts and rails cast the sun's real-time shadows (the high preset's shadow map). Default: false. */
  readonly castShadows?: boolean;
  /** How far from the truck delineator posts are drawn, meters. Default: 300. */
  readonly postDrawMeters?: number;
}

/**
 * The roads' furniture (roadmap: graphics): white delineator posts along
 * rural roads and highways, each with an amber reflector that lights up in
 * the truck's headlights at night, and the world's guard rails
 * (DrivingWorld.guardRails) in galvanised steel. Posts and reflectors are
 * instanced (two draw calls), holding only the posts near the truck; the
 * rails are merged per 600 m tile, which the camera culls. Placed once,
 * deterministically.
 */
export class RoadFurnitureView {
  private readonly root = new Group();
  private readonly posts: InstancedMesh;
  private readonly reflectors: InstancedMesh;
  private readonly rails: Mesh[] = [];
  private readonly resources: { dispose(): void }[] = [];
  /** Every post: where it stands, its matrix and its two reflectors' (16 floats each), in the same order. */
  private readonly postX: Float32Array;
  private readonly postZ: Float32Array;
  private readonly postMatrices: Float32Array;
  private readonly reflectorMatrices: Float32Array;
  private readonly postDrawMeters: number;
  /** Where the drawn posts were gathered round (NaN: not yet). */
  private gatheredX = Number.NaN;
  private gatheredZ = Number.NaN;
  /** The headlights, as the reflectors' shader sees them: where the truck is and faces, and how bright its lamps are. */
  private readonly headlights = {
    truck: { value: new Vector3() },
    forward: { value: new Vector3(0, 0, 1) },
    lamps: { value: 0 },
  };

  constructor(
    private readonly scene: Scene,
    world: DrivingWorld,
    options: RoadFurnitureViewOptions = {},
  ) {
    const spots = delineatorSpots(world);
    this.postDrawMeters = options.postDrawMeters ?? POST_DRAW_METERS;
    this.postX = Float32Array.from(spots, (spot) => spot.x);
    this.postZ = Float32Array.from(spots, (spot) => spot.z);
    this.postMatrices = new Float32Array(spots.length * 16);
    this.reflectorMatrices = new Float32Array(spots.length * 32);
    const postGeometry = this.track(postGeometryOf());
    this.posts = this.track(new InstancedMesh(postGeometry, this.track(new MeshLambertMaterial({ vertexColors: true })), Math.max(1, spots.length)));
    this.posts.name = 'road-furniture:posts';
    // Lit like the posts, so by night they are dark until the headlights catch them.
    const reflectorMaterial = this.track(new MeshLambertMaterial({ color: REFLECTOR_COLOR }));
    this.glowInHeadlights(reflectorMaterial);
    this.reflectors = this.track(
      new InstancedMesh(this.track(new BoxGeometry(0.1, 0.18, 0.02)), reflectorMaterial, Math.max(1, spots.length * 2)),
    );
    this.reflectors.name = 'road-furniture:reflectors';
    const matrix = new Matrix4();
    const reflector = new Matrix4();
    const rotation = new Quaternion();
    const position = new Vector3();
    const one = new Vector3(1, 1, 1);
    const up = new Vector3(0, 1, 0);
    spots.forEach(({ x, z, heading }, index) => {
      rotation.setFromAxisAngle(up, heading);
      matrix.compose(position.set(x, 0, z), rotation, one);
      matrix.toArray(this.postMatrices, index * 16);
      // One on each face, toward the traffic either way, near the post's top.
      for (const face of [0, 1] as const) {
        reflector.makeTranslation(0, 0.86, face === 0 ? 0.07 : -0.07).premultiply(matrix);
        reflector.toArray(this.reflectorMatrices, (index * 2 + face) * 16);
      }
    });
    // Nothing drawn until update() gathers the posts round the truck; they move, so no culling by the map-wide bounds.
    for (const mesh of [this.posts, this.reflectors]) {
      mesh.count = 0;
      mesh.visible = false;
      mesh.frustumCulled = false;
    }
    this.posts.castShadow = options.castShadows === true;

    const railMaterial = this.track(new MeshLambertMaterial({ vertexColors: true }));
    if (options.sky !== undefined) {
      reflectSky(railMaterial, options.sky, { facing: 0.3, strength: 0.7, metal: true });
    }
    for (const [tile, parts] of railTiles(world.guardRails)) {
      const mesh = new Mesh(this.track(mergeGeometries(parts)), railMaterial);
      for (const part of parts) {
        part.dispose();
      }
      mesh.name = `road-furniture:rails:${tile}`;
      mesh.castShadow = options.castShadows === true;
      this.rails.push(mesh);
    }
    this.root.add(this.posts, this.reflectors, ...this.rails);
    this.root.name = 'road-furniture';
    scene.add(this.root);
  }

  /** How many delineator posts there are, how many are drawn now, and how many rail tiles. */
  get counts(): { readonly posts: number; readonly drawnPosts: number; readonly railTiles: number } {
    return { posts: this.postX.length, drawnPosts: this.posts.count, railTiles: this.rails.length };
  }

  /** How brightly the truck's lamps shine, 0..1 (the weather's): the reflectors ahead catch them. Cheap. */
  setLamps(level: number): void {
    this.headlights.lamps.value = level;
  }

  /**
   * Where the truck is and which way it faces (heading 0 along +z): the
   * reflectors' headlights, and the posts drawn round it, gathered again
   * after it has moved POST_REGATHER_METERS. Allocation-free.
   */
  update(truckX: number, truckZ: number, heading: number): void {
    this.headlights.truck.value.set(truckX, 0, truckZ);
    this.headlights.forward.value.set(Math.sin(heading), 0, Math.cos(heading));
    if (!(Math.hypot(truckX - this.gatheredX, truckZ - this.gatheredZ) < POST_REGATHER_METERS)) {
      this.gather(truckX, truckZ);
    }
  }

  dispose(): void {
    this.scene.remove(this.root);
    for (const resource of this.resources) {
      resource.dispose();
    }
  }

  /** Copies the posts within postDrawMeters of (x, z), and their reflectors, into the instanced meshes. */
  private gather(x: number, z: number): void {
    this.gatheredX = x;
    this.gatheredZ = z;
    const posts = this.posts.instanceMatrix.array;
    const reflectors = this.reflectors.instanceMatrix.array;
    const reach = this.postDrawMeters * this.postDrawMeters;
    let count = 0;
    for (let index = 0; index < this.postX.length; index++) {
      const dx = this.postX[index]! - x;
      const dz = this.postZ[index]! - z;
      if (dx * dx + dz * dz > reach) {
        continue;
      }
      for (let k = 0; k < 16; k++) {
        posts[count * 16 + k] = this.postMatrices[index * 16 + k]!;
      }
      for (let k = 0; k < 32; k++) {
        reflectors[count * 32 + k] = this.reflectorMatrices[index * 32 + k]!;
      }
      count++;
    }
    this.posts.count = count;
    this.reflectors.count = count * 2;
    this.posts.visible = count > 0;
    this.reflectors.visible = count > 0;
    this.posts.instanceMatrix.needsUpdate = true;
    this.reflectors.instanceMatrix.needsUpdate = true;
  }

  /** Lights a reflector up in the headlights: bright dead ahead and near, nothing behind or far. */
  private glowInHeadlights(material: MeshLambertMaterial): void {
    const headlights = this.headlights;
    material.onBeforeCompile = (shader) => {
      shader.uniforms['truck'] = headlights.truck;
      shader.uniforms['forward'] = headlights.forward;
      shader.uniforms['lamps'] = headlights.lamps;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vReflectorWorld;')
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          vec4 reflectorWorld = vec4( transformed, 1.0 );
          #ifdef USE_INSTANCING
            reflectorWorld = instanceMatrix * reflectorWorld;
          #endif
          vReflectorWorld = ( modelMatrix * reflectorWorld ).xyz;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform vec3 truck;\nuniform vec3 forward;\nuniform float lamps;\nvarying vec3 vReflectorWorld;',
        )
        .replace(
          '#include <opaque_fragment>',
          `{
            vec2 toReflector = vReflectorWorld.xz - truck.xz;
            float distance = length( toReflector );
            float ahead = dot( toReflector / max( distance, 1e-3 ), forward.xz );
            float caught = lamps * smoothstep( ${REFLECTOR_CONE_COS.toFixed(3)}, 1.0, ahead )
              * ( 1.0 - smoothstep( ${REFLECTOR_REACH_METERS.bright.toFixed(1)}, ${REFLECTOR_REACH_METERS.gone.toFixed(1)}, distance ) );
            // It sends the headlights straight back: far brighter than white, so it blooms.
            outgoingLight += diffuseColor.rgb * caught * 6.0;
          }
          #include <opaque_fragment>`,
        );
    };
    material.customProgramCacheKey = () => 'road-furniture-reflector';
  }

  private track<T extends { dispose(): void }>(resource: T): T {
    this.resources.push(resource);
    return resource;
  }
}

/** A delineator post: white, a black band under its top, about a meter tall. Coloured per vertex. */
function postGeometryOf(): BufferGeometry {
  const white = new Color(0xf1f1ec);
  const black = new Color(0x1b1c1e);
  const body = coloured(new BoxGeometry(0.12, 0.8, 0.12).translate(0, 0.4, 0), white);
  const band = coloured(new BoxGeometry(0.125, 0.22, 0.125).translate(0, 0.91, 0), black);
  const cap = coloured(new BoxGeometry(0.12, 0.08, 0.12).translate(0, 1.06, 0), white);
  const post = mergeGeometries([body, band, cap]);
  for (const part of [body, band, cap]) {
    part.dispose();
  }
  return post;
}

/**
 * Where delineator posts stand: along both sides of every rural road and
 * highway, on the grass, clear of junctions and guard rails.
 */
function delineatorSpots(world: DrivingWorld): { x: number; z: number; heading: number }[] {
  const spots: { x: number; z: number; heading: number }[] = [];
  const railPosts = world.guardRails.flatMap((rail) => rail.points);
  const byRail = (x: number, z: number): boolean =>
    railPosts.some(([railX, railZ]) => Math.hypot(railX - x, railZ - z) < RAIL_CLEARANCE_METERS);
  const point = createRoadPoint();
  for (const road of world.roads) {
    if (road.kind !== 'rural' && road.kind !== 'highway') {
      continue;
    }
    const out = road.widthMeters / 2 + POST_OUT_METERS;
    for (let along = POST_SPACING_METERS / 2; along < road.lengthMeters; along += POST_SPACING_METERS) {
      road.pointAt(along, point);
      const heading = Math.atan2(point.directionX, point.directionZ);
      for (const side of [-1, 1] as const) {
        const x = point.x + point.directionZ * out * side;
        const z = point.z - point.directionX * out * side;
        if (onVerge(world, x, z) && !byRail(x, z)) {
          spots.push({ x, z, heading });
        }
      }
    }
  }
  return spots;
}

/**
 * The guard rails' beams, posts and spacer blocks, and the ends bent away
 * from the road, merged by the square tile (key "column,row") each piece
 * starts in.
 */
function railTiles(rails: readonly GuardRail[]): Map<string, BufferGeometry[]> {
  const tiles = new Map<string, BufferGeometry[]>();
  const steel = new Color(0xb9c0c6);
  const post = new Color(0x8f969c);
  const partsAt = (x: number, z: number): BufferGeometry[] => {
    const key = `${Math.floor(x / RAIL_TILE_METERS)},${Math.floor(z / RAIL_TILE_METERS)}`;
    let parts = tiles.get(key);
    if (parts === undefined) {
      parts = [];
      tiles.set(key, parts);
    }
    return parts;
  };
  for (const rail of rails) {
    const { points } = rail;
    // Toward the road from the rail, as it runs along (dx, dz): its left is (dz, -dx).
    const toRoad = rail.roadSide === 'left' ? 1 : -1;
    for (let index = 0; index < points.length; index++) {
      const [x, z] = points[index]!;
      // The rail's direction here: along its piece (the last post: the piece before it).
      const [fromX, fromZ] = points[Math.min(index, points.length - 2)]!;
      const [toX, toZ] = points[Math.min(index, points.length - 2) + 1]!;
      const length = Math.hypot(toX - fromX, toZ - fromZ) || 1;
      const dx = (toX - fromX) / length;
      const dz = (toZ - fromZ) / length;
      const roadX = dz * toRoad;
      const roadZ = -dx * toRoad;
      const parts = partsAt(x, z);
      const heading = Math.atan2(dx, dz);
      const behind = RAIL_POST_BEHIND_METERS;
      parts.push(
        coloured(new BoxGeometry(0.1, 0.84, 0.1).rotateY(heading).translate(x - roadX * behind, 0.42, z - roadZ * behind), post),
        coloured(new BoxGeometry(0.08, 0.2, behind).rotateY(heading).translate(x - (roadX * behind) / 2, 0.685, z - (roadZ * behind) / 2), post),
      );
      if (index + 1 < points.length) {
        const [nextX, nextZ] = points[index + 1]!;
        parts.push(beamPiece(x, z, nextX, nextZ, roadX, roadZ, steel));
      }
      // Each end bends back, away from the road, so no bare edge faces the traffic.
      if (index === 0 || index === points.length - 1) {
        const outward = index === 0 ? -1 : 1;
        const endX = x + dx * RAIL_END.along * outward - roadX * RAIL_END.away;
        const endZ = z + dz * RAIL_END.along * outward - roadZ * RAIL_END.away;
        parts.push(beamPiece(x, z, endX, endZ, roadX, roadZ, steel));
      }
    }
  }
  return tiles;
}

/**
 * A length of beam from (ax, az) to (bx, bz): the W profile (BEAM_PROFILE)
 * folded toward (roadX, roadZ), both faces, flat-shaded so the folds catch
 * the light differently.
 */
function beamPiece(ax: number, az: number, bx: number, bz: number, roadX: number, roadZ: number, color: Color): BufferGeometry {
  const positions: number[] = [];
  for (const { y, out } of BEAM_PROFILE) {
    positions.push(ax + roadX * out, y, az + roadZ * out, bx + roadX * out, y, bz + roadZ * out);
  }
  const indices: number[] = [];
  for (let row = 0; row < BEAM_PROFILE.length - 1; row++) {
    const a = row * 2;
    // Both faces: the rail is seen from the road and from the meadow.
    indices.push(a, a + 1, a + 3, a, a + 3, a + 2, a, a + 3, a + 1, a, a + 2, a + 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  const flat = geometry.toNonIndexed();
  geometry.dispose();
  flat.computeVertexNormals();
  return coloured(flat, color);
}

/** Whether (x, z) is on the grass beside a road, clear of junctions and the sea: where posts and rails may stand. */
function onVerge(world: DrivingWorld, x: number, z: number): boolean {
  const junctions = world.network.junctions;
  for (let i = 0; i < junctions.length; i++) {
    const junction = junctions[i]!;
    if (Math.hypot(junction.x - x, junction.z - z) <= JUNCTION_CLEARANCE_METERS) {
      return false;
    }
  }
  return world.surfaceAt(x, z).name === 'grass' && !world.isWater(x, z, 1);
}

/** `geometry` in one colour, without uv, flat (non-indexed), to merge with the other pieces. */
function coloured(geometry: BufferGeometry, color: Color): BufferGeometry {
  const flat = geometry.index === null ? geometry : geometry.toNonIndexed();
  if (flat !== geometry) {
    geometry.dispose();
  }
  if (flat.getAttribute('uv') !== undefined) {
    flat.deleteAttribute('uv');
  }
  const colors = new Float32Array(flat.getAttribute('position').count * 3);
  for (let i = 0; i < colors.length; i += 3) {
    color.toArray(colors, i);
  }
  flat.setAttribute('color', new BufferAttribute(colors, 3));
  return flat;
}
