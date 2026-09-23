import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Material,
  type Scene,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BuildingObstacle, DrivingWorld, TreeObstacle } from '../../domain/world/DrivingWorld';
import type { RoadPath } from '../../domain/world/RoadPath';
import { fractalNoise } from '../textures/noise';
import type { PixelImage } from '../textures/pixelImage';
import {
  asphaltImage,
  grassImage,
  gravelImage,
  officeFacadeImage,
  softBoxShadowImage,
  softShadowImage,
  warehouseFacadeImage,
} from '../textures/proceduralImages';
import { toTexture } from '../textures/toTexture';
import { flatGroundLight, SHADOW_OFFSET_PER_METER } from './lighting';

const MARKING_COLOR = 0xf4f3ec;
const TRUNK_COLOR = 0x5e4330;
const ROOF_COLOR = 0x5a5f66;
const BUILDING_TINTS = [0xf2ede2, 0xdfe6ec, 0xe9dcc6, 0xd9e2d3, 0xf0e4dc] as const;
const PINE_COLORS = [0x2f5e34, 0x355f2e, 0x2a5233, 0x3b6a37] as const;
const BROADLEAF_COLORS = [0x4f8a3c, 0x5c9442, 0x44803e, 0x6b9a3f, 0x7f9b3a] as const;

/** Layers lie flat on the ground; each sits a little higher and is pulled a little further toward the camera. */
const SHOULDER_Y = 0.01;
const ROAD_Y = 0.03;
const MARKING_Y = 0.06;
const SHOULDER_WIDTH = 1.4;
const EDGE_LINE_WIDTH = 0.2;
const EDGE_LINE_INSET = 0.6;
const DASH_LENGTH = 3;
const DASH_SPACING = 12;
/** One grass texture tile covers this many meters; the road textures repeat along the road. */
const GRASS_TILE_METERS = 14;
const ASPHALT_TILE_METERS = 10;
const GRAVEL_TILE_METERS = 4;
/** One facade texture tile covers 2 bays × 2 floors. */
const FACADE_TILE_WIDTH = 8;
const FACADE_TILE_HEIGHT = 7;
/** Footprints larger than this are warehouses (ribbed cladding), smaller ones offices. */
const WAREHOUSE_MIN_AREA = 350;
/** The ground reaches this far past the map edge, so it fades into the haze instead of ending. */
const GROUND_MARGIN = 1000;

const UP = new Vector3(0, 1, 0);

export interface TrackViewOptions {
  /** Texture anisotropy for the ground and road (renderer capability). */
  readonly anisotropy?: number;
}

/**
 * Draws a DrivingWorld: textured grass, roads with gravel shoulders, lines and
 * dashes, two species of trees, buildings with facades and roofs, and soft
 * shadows baked onto the ground. Everything repeated is instanced or merged:
 * about 15 draw calls for the test track. The ground layers are pre-lit, so
 * the pixels that cover most of the screen skip lighting. It reads the same
 * geometry the simulation collides with, so visuals and physics cannot drift
 * apart.
 */
export class TrackView {
  private readonly root = new Group();
  private readonly resources: { dispose(): void }[] = [];
  /** Flat, upward-facing surfaces are pre-lit: see flatGroundLight(). */
  private readonly groundLight = flatGroundLight();

  constructor(
    private readonly scene: Scene,
    world: DrivingWorld,
    options: TrackViewOptions = {},
  ) {
    const anisotropy = options.anisotropy ?? 1;
    this.root.add(this.createGround(world.halfSizeMeters, anisotropy));
    const asphalt = this.texture(toTexture(asphaltImage(), { repeat: true, anisotropy }));
    const gravel = this.texture(toTexture(gravelImage(), { repeat: true, anisotropy }));
    for (const road of world.roads) {
      this.root.add(
        this.createShoulders(road, gravel),
        this.createRoadSurface(road, asphalt),
        this.createEdgeLines(road),
        this.createCentreDashes(road),
      );
    }
    if (world.trees.length > 0) {
      this.root.add(...this.createTrees(world.trees));
    }
    if (world.buildings.length > 0) {
      this.root.add(...this.createBuildings(world.buildings));
    }
    scene.add(this.root);
  }

  dispose(): void {
    this.scene.remove(this.root);
    for (const resource of this.resources) {
      resource.dispose();
    }
  }

  private createGround(halfSize: number, anisotropy: number): Mesh {
    const size = (halfSize + GROUND_MARGIN) * 2;
    const geometry = this.track(new PlaneGeometry(size, size, 96, 96));
    geometry.rotateX(-Math.PI / 2);
    // Large, soft colour patches (lush, plain, dry) so the tiled grass does not look repeated.
    const positions = geometry.getAttribute('position');
    const colors = new Float32Array(positions.count * 3);
    const lush = new Color(0.82, 0.98, 0.8);
    const dry = new Color(1.12, 1.04, 0.78);
    const tint = new Color();
    for (let i = 0; i < positions.count; i++) {
      const u = positions.getX(i) / 900;
      const v = positions.getZ(i) / 900;
      const patch = fractalNoise(u, v, 6, 3, 77);
      tint.copy(lush).lerp(dry, Math.max(0, Math.min(1, (patch - 0.35) * 1.8)));
      colors.set([tint.r, tint.g, tint.b], i * 3);
    }
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    const grass = this.texture(toTexture(grassImage(), { repeat: true, anisotropy }));
    grass.repeat.set(size / GRASS_TILE_METERS, size / GRASS_TILE_METERS);
    return new Mesh(geometry, this.track(new MeshBasicMaterial({ map: grass, vertexColors: true, color: this.groundLight })));
  }

  private createShoulders(road: RoadPath, gravel: Texture): Mesh {
    const offset = road.widthMeters / 2 + SHOULDER_WIDTH / 2 - 0.2;
    const geometry = this.track(
      stripGeometry(
        road,
        [
          { offset: -offset, width: SHOULDER_WIDTH },
          { offset, width: SHOULDER_WIDTH },
        ],
        SHOULDER_Y,
        GRAVEL_TILE_METERS,
      ),
    );
    return new Mesh(geometry, this.overlayMaterial({ map: gravel }, 1));
  }

  private createRoadSurface(road: RoadPath, asphalt: Texture): Mesh {
    const geometry = this.track(stripGeometry(road, [{ offset: 0, width: road.widthMeters }], ROAD_Y, ASPHALT_TILE_METERS));
    return new Mesh(geometry, this.overlayMaterial({ map: asphalt }, 2));
  }

  private createEdgeLines(road: RoadPath): Mesh {
    const edge = road.widthMeters / 2 - EDGE_LINE_INSET;
    const geometry = this.track(
      stripGeometry(
        road,
        [
          { offset: -edge, width: EDGE_LINE_WIDTH },
          { offset: edge, width: EDGE_LINE_WIDTH },
        ],
        MARKING_Y,
        1,
      ),
    );
    return new Mesh(geometry, this.overlayMaterial({ color: MARKING_COLOR }, 3));
  }

  private createCentreDashes(road: RoadPath): InstancedMesh {
    const count = Math.max(1, Math.floor(road.lengthMeters / DASH_SPACING));
    const dashes = this.track(
      new InstancedMesh(
        this.track(new BoxGeometry(0.18, 0.01, DASH_LENGTH)),
        this.overlayMaterial({ color: MARKING_COLOR }, 3),
        count,
      ),
    );
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3(1, 1, 1);
    const matrix = new Matrix4();
    for (let i = 0; i < count; i++) {
      const heading = pointAlong(road, (i + 0.5) * DASH_SPACING, position);
      position.y = MARKING_Y;
      rotation.setFromAxisAngle(UP, heading);
      dashes.setMatrixAt(i, matrix.compose(position, rotation, scale));
    }
    dashes.instanceMatrix.needsUpdate = true;
    return dashes;
  }

  /**
   * Pines and broadleaf trees, picked per tree from its position so the forest
   * is the same every time. Trunks share one instanced mesh; each species has
   * its own crowns, tinted per tree. Shadows are soft decals on the ground.
   */
  private createTrees(trees: readonly TreeObstacle[]): (InstancedMesh | Mesh)[] {
    const isPine = trees.map((tree) => fractalNoise(tree.x / 700, tree.z / 700, 4, 2, 5) + (hash(tree.x, tree.z) - 0.5) * 0.5 > 0.5);
    const pineCount = isPine.filter(Boolean).length;
    const trunks = this.track(
      new InstancedMesh(
        this.track(new CylinderGeometry(0.2, 0.3, 1, 6).translate(0, 0.5, 0)),
        this.track(new MeshLambertMaterial({ color: TRUNK_COLOR })),
        trees.length,
      ),
    );
    const crownMaterial = this.track(new MeshLambertMaterial({ color: 0xffffff, flatShading: true }));
    const pines = this.track(new InstancedMesh(this.track(pineCrownGeometry()), crownMaterial, Math.max(1, pineCount)));
    const broadleaves = this.track(
      new InstancedMesh(this.track(broadleafCrownGeometry()), crownMaterial, Math.max(1, trees.length - pineCount)),
    );
    pines.count = pineCount;
    broadleaves.count = trees.length - pineCount;
    const shadows = this.track(
      new InstancedMesh(this.track(flatQuad()), this.shadowMaterial(softShadowImage(), 0.42), trees.length),
    );

    const matrix = new Matrix4();
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    const color = new Color();
    let pineIndex = 0;
    let broadleafIndex = 0;
    trees.forEach((tree, index) => {
      const pine = isPine[index]!;
      const s = tree.scale;
      const trunkHeight = (pine ? 2.2 : 2.8) * s;
      rotation.setFromAxisAngle(UP, index * 2.399); // Golden-angle spin so neighbours differ.
      trunks.setMatrixAt(index, matrix.compose(position.set(tree.x, 0, tree.z), rotation, scale.set(s, trunkHeight, s)));
      position.set(tree.x, trunkHeight, tree.z);
      scale.setScalar(s);
      const shade = 0.88 + 0.24 * hash(tree.z, tree.x);
      if (pine) {
        pines.setMatrixAt(pineIndex, matrix.compose(position, rotation, scale));
        pines.setColorAt(pineIndex++, color.setHex(PINE_COLORS[index % PINE_COLORS.length]!).multiplyScalar(shade));
      } else {
        broadleaves.setMatrixAt(broadleafIndex, matrix.compose(position, rotation, scale));
        broadleaves.setColorAt(
          broadleafIndex++,
          color.setHex(BROADLEAF_COLORS[index % BROADLEAF_COLORS.length]!).multiplyScalar(shade),
        );
      }
      // The shadow falls away from the sun, centred under the crown's projection.
      const crownHeight = trunkHeight + 2.6 * s;
      position.set(
        tree.x + SHADOW_OFFSET_PER_METER.x * crownHeight * 0.5,
        SHOULDER_Y / 2,
        tree.z + SHADOW_OFFSET_PER_METER.z * crownHeight * 0.5,
      );
      shadows.setMatrixAt(index, matrix.compose(position, rotation.identity(), scale.set(5.5 * s, 1, 5.5 * s)));
    });
    for (const mesh of [trunks, pines, broadleaves, shadows]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor !== null) {
        mesh.instanceColor.needsUpdate = true;
      }
    }
    return [shadows, trunks, pines, broadleaves];
  }

  /** Walls (office and warehouse facades), roofs and ground shadows, each merged into one mesh. */
  private createBuildings(buildings: readonly BuildingObstacle[]): Mesh[] {
    const offices: BufferGeometry[] = [];
    const warehouses: BufferGeometry[] = [];
    const roofs: BufferGeometry[] = [];
    const shadows: BufferGeometry[] = [];
    buildings.forEach((box, index) => {
      const width = box.maxX - box.minX;
      const depth = box.maxZ - box.minZ;
      const tint = new Color(BUILDING_TINTS[index % BUILDING_TINTS.length]!);
      (width * depth >= WAREHOUSE_MIN_AREA ? warehouses : offices).push(wallsGeometry(box, tint));
      roofs.push(
        new BoxGeometry(width + 0.6, 0.45, depth + 0.6).translate(box.minX + width / 2, box.heightMeters + 0.2, box.minZ + depth / 2),
      );
      const reachX = SHADOW_OFFSET_PER_METER.x * box.heightMeters;
      const reachZ = SHADOW_OFFSET_PER_METER.z * box.heightMeters;
      shadows.push(
        flatQuad(width + Math.abs(reachX) + 3, depth + Math.abs(reachZ) + 3).translate(
          box.minX + width / 2 + reachX / 2,
          SHOULDER_Y / 2,
          box.minZ + depth / 2 + reachZ / 2,
        ),
      );
    });
    const meshes: Mesh[] = [];
    const add = (parts: BufferGeometry[], material: Material): void => {
      if (parts.length > 0) {
        meshes.push(new Mesh(this.track(mergeGeometries(parts)), material));
      }
      for (const part of parts) {
        part.dispose();
      }
    };
    add(shadows, this.shadowMaterial(softBoxShadowImage(), 0.38));
    add(offices, this.facadeMaterial(officeFacadeImage()));
    add(warehouses, this.facadeMaterial(warehouseFacadeImage()));
    add(roofs, this.track(new MeshLambertMaterial({ color: ROOF_COLOR })));
    return meshes;
  }

  private facadeMaterial(image: PixelImage): MeshLambertMaterial {
    return this.track(new MeshLambertMaterial({ map: this.texture(toTexture(image, { repeat: true })), vertexColors: true }));
  }

  private shadowMaterial(image: PixelImage, opacity: number): MeshBasicMaterial {
    return this.track(
      new MeshBasicMaterial({
        map: this.texture(toTexture(image, { srgb: false })),
        color: 0x000000,
        transparent: true,
        opacity,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
  }

  /**
   * Road layers lie flat on the ground: pull them toward the camera instead of
   * relying on tiny height gaps. Higher `layer`s win over lower ones. Like
   * the ground they are unlit, tinted with the light a flat surface receives.
   */
  private overlayMaterial(parameters: { map?: Texture; color?: number }, layer: number): MeshBasicMaterial {
    const { map, color = 0xffffff } = parameters;
    return this.track(
      new MeshBasicMaterial({
        ...(map === undefined ? {} : { map }),
        color: new Color(color).multiply(this.groundLight),
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -2 * layer,
      }),
    );
  }

  private texture<T extends Texture>(texture: T): T {
    return this.track(texture);
  }

  /** Remembers a GPU resource so dispose() can release it. */
  private track<T extends { dispose(): void }>(resource: T): T {
    this.resources.push(resource);
    return resource;
  }
}

/** A small, stable hash of two coordinates, 0..1: per-tree variation without a random stream. */
function hash(a: number, b: number): number {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** A horizontal quad facing up, centred on the origin. */
function flatQuad(width = 1, depth = 1): BufferGeometry {
  return new PlaneGeometry(width, depth).rotateX(-Math.PI / 2);
}

/** Three stacked cones on top of the trunk (origin at the crown's base). */
function pineCrownGeometry(): BufferGeometry {
  const tiers = [
    new ConeGeometry(2.1, 3.2, 7).translate(0, 1.4, 0),
    new ConeGeometry(1.65, 2.8, 7).translate(0, 3.0, 0),
    new ConeGeometry(1.1, 2.4, 7).translate(0, 4.4, 0),
  ];
  const crown = mergeGeometries(tiers);
  for (const tier of tiers) {
    tier.dispose();
  }
  return crown;
}

/** A lumpy canopy of faceted blobs (origin at the crown's base). */
function broadleafCrownGeometry(): BufferGeometry {
  const blobs = [
    [0, 1.9, 0, 2.2],
    [1.2, 1.4, 0.4, 1.6],
    [-1.0, 1.5, -0.5, 1.7],
    [0.2, 2.9, -0.2, 1.5],
    [-0.3, 1.2, 1.1, 1.4],
  ].map(([x, y, z, r]) => {
    const blob = new IcosahedronGeometry(r!, 0).translate(x!, y!, z!);
    // Nudge each corner by a hash of where it is, so the copies of a shared corner move together.
    const position = blob.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      const px = position.getX(i);
      const py = position.getY(i);
      const pz = position.getZ(i);
      position.setXYZ(i, px + (hash(py, pz) - 0.5) * 0.3, py + (hash(pz, px) - 0.5) * 0.3, pz + (hash(px, py) - 0.5) * 0.3);
    }
    return blob;
  });
  const crown = mergeGeometries(blobs);
  crown.computeVertexNormals();
  for (const blob of blobs) {
    blob.dispose();
  }
  return crown;
}

/**
 * The four walls of a building as outward-facing quads, with texture
 * coordinates in facade tiles (so windows keep their size on any building)
 * and the building's tint as vertex colour.
 */
function wallsGeometry(box: BuildingObstacle, tint: Color): BufferGeometry {
  const corners = [
    [box.minX, box.maxZ],
    [box.maxX, box.maxZ],
    [box.maxX, box.minZ],
    [box.minX, box.minZ],
  ] as const;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const height = box.heightMeters;
  corners.forEach(([ax, az], side) => {
    const [bx, bz] = corners[(side + 1) % 4]!;
    const length = Math.hypot(bx - ax, bz - az);
    // The corners go round so that the wall's outward normal is (b - a) turned 90° toward the outside.
    const nx = -(bz - az) / length;
    const nz = (bx - ax) / length;
    const base = positions.length / 3;
    positions.push(ax, 0, az, bx, 0, bz, bx, height, bz, ax, height, az);
    for (let i = 0; i < 4; i++) {
      normals.push(nx, 0, nz);
      colors.push(tint.r, tint.g, tint.b);
    }
    const u = length / FACADE_TILE_WIDTH;
    const v = height / FACADE_TILE_HEIGHT;
    uvs.push(0, 0, u, 0, u, v, 0, v);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  geometry.setIndex(indices);
  return geometry;
}

/**
 * Builds flat ribbons that follow the road, one per band. `offset` is the
 * band's centre measured sideways from the centreline (positive to the right
 * of the direction of travel). Texture u runs across each band and v along
 * the road, one unit per `tileMeters`.
 */
function stripGeometry(
  road: RoadPath,
  bands: readonly { offset: number; width: number }[],
  y: number,
  tileMeters: number,
): BufferGeometry {
  const count = road.pointCount;
  // A closed road repeats its first point at the end, so v keeps growing across the seam.
  const rows = road.closed ? count + 1 : count;
  const positions = new Float32Array(bands.length * rows * 2 * 3);
  const normals = new Float32Array(positions.length);
  const uvs = new Float32Array(bands.length * rows * 2 * 2);
  const indices: number[] = [];
  bands.forEach((band, bandIndex) => {
    const base = bandIndex * rows * 2;
    for (let row = 0; row < rows; row++) {
      const i = row % count;
      // Tangent from the neighbouring samples; "right" is the tangent turned 90° clockwise from above.
      const previous = road.closed ? (i - 1 + count) % count : Math.max(0, i - 1);
      const next = road.closed ? (i + 1) % count : Math.min(count - 1, i + 1);
      const tx = road.x(next) - road.x(previous);
      const tz = road.z(next) - road.z(previous);
      const length = Math.hypot(tx, tz) || 1;
      const rightX = -tz / length;
      const rightZ = tx / length;
      const inner = band.offset - band.width / 2;
      const outer = band.offset + band.width / 2;
      const vertex = (base + row * 2) * 3;
      positions.set([road.x(i) + rightX * inner, y, road.z(i) + rightZ * inner], vertex);
      positions.set([road.x(i) + rightX * outer, y, road.z(i) + rightZ * outer], vertex + 3);
      normals.set([0, 1, 0, 0, 1, 0], vertex);
      const along = (row === count ? road.lengthMeters : (road.distances[i] ?? 0)) / tileMeters;
      uvs.set([0, along, 1, along], (base + row * 2) * 2);
    }
    for (let row = 0; row + 1 < rows; row++) {
      const leftI = base + row * 2;
      const rightI = leftI + 1;
      const leftJ = leftI + 2;
      const rightJ = leftJ + 1;
      // Wound so (right − left) × (next − this) points up: the ribbon's front face looks at the sky.
      indices.push(leftI, rightI, leftJ, rightI, rightJ, leftJ);
    }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

/** Writes the centreline point `distance` meters along the road into `out`; returns the heading there. */
function pointAlong(road: RoadPath, distance: number, out: Vector3): number {
  const count = road.pointCount;
  let index = 0;
  while (index < count - 1 && (road.distances[index + 1] ?? Infinity) <= distance) {
    index++;
  }
  const next = road.closed ? (index + 1) % count : Math.min(count - 1, index + 1);
  const start = road.distances[index] ?? 0;
  const end = next === 0 ? road.lengthMeters : (road.distances[next] ?? start);
  const t = end > start ? Math.min(1, (distance - start) / (end - start)) : 0;
  const dx = road.x(next) - road.x(index);
  const dz = road.z(next) - road.z(index);
  out.set(road.x(index) + dx * t, 0, road.z(index) + dz * t);
  return Math.atan2(dx, dz);
}
