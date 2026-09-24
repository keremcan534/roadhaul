import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
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
  officeWindowLightsImage,
  softBoxShadowImage,
  softShadowImage,
  warehouseFacadeImage,
  warehouseWindowLightsImage,
} from '../textures/proceduralImages';
import { toTexture } from '../textures/toTexture';
import { flatGroundLight, SHADOW_OFFSET_PER_METER, type PrelitMaterials } from './lighting';
import type { SkyUniforms } from './EnvironmentView';

const MARKING_COLOR = 0xf4f3ec;
const TRUNK_COLOR = 0x5e4330;
const ROOF_COLOR = 0x5a5f66;
const BUILDING_TINTS = [0xf2ede2, 0xdfe6ec, 0xe9dcc6, 0xd9e2d3, 0xf0e4dc] as const;
const PINE_COLORS = [0x2f5e34, 0x355f2e, 0x2a5233, 0x3b6a37] as const;
const BROADLEAF_COLORS = [0x4f8a3c, 0x5c9442, 0x44803e, 0x6b9a3f, 0x7f9b3a] as const;

/**
 * Layers lie flat on the ground; each sits a little higher and is pulled a
 * little further toward the camera. Where roads overlap at a junction, each
 * road's surface sits ROAD_STACK above the one before, so they never fight
 * over the same depth; the markings stay above them all.
 */
const SHOULDER_Y = 0.01;
const ROAD_Y = 0.03;
const ROAD_STACK = 0.004;
const MARKING_GAP = 0.02;
const SHOULDER_WIDTH = 1.4;
const LINE_WIDTH = 0.2;
const EDGE_LINE_INSET = 0.6;
const DASH_LENGTH = 3;
const DASH_SPACING = 12;
/** Markings stop this far short of a junction, measured past the widest road's edge. */
const JUNCTION_MARKING_GAP = 2;
/** One grass texture tile covers this many meters; the road textures repeat along the road. */
const GRASS_TILE_METERS = 14;
const ASPHALT_TILE_METERS = 10;
const GRAVEL_TILE_METERS = 4;
/** One facade texture tile covers 2 bays × 2 floors. */
const FACADE_TILE_WIDTH = 8;
const FACADE_TILE_HEIGHT = 7;
/** The lit-window maps cover this many facade tiles each way; walls start at different tiles of them. */
const WINDOW_LIGHT_TILES = 4;
/** How brightly lit windows glow at night (setLamps(1)). */
const WINDOW_GLOW = 1.2;
/** Footprints larger than this are warehouses (ribbed cladding), smaller ones offices. */
const WAREHOUSE_MIN_AREA = 350;
/** The ground reaches this far past the map edge, so it fades into the haze instead of ending. */
const GROUND_MARGIN = 1000;
/** Side of the square tiles the forest is cut into, so trees out of view are not drawn. */
const TREE_TILE_METERS = 600;

const UP = new Vector3(0, 1, 0);

/** The sky a wet road mirrors when there is none given (a rainy day's haze). */
const WET_SKY = 0x7f8b97;

export interface TrackViewOptions {
  /** The sky, for a wet road to mirror (EnvironmentView.sky); without it, a rainy day's haze. */
  readonly sky?: SkyUniforms;
  /** Texture anisotropy for the ground and road (renderer capability). */
  readonly anisotropy?: number;
  /** Where the pre-lit ground and road and the shadows register, to follow the weather's light. */
  readonly prelit?: PrelitMaterials;
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
  private readonly prelit: PrelitMaterials | undefined;
  /** Facades whose windows light up at night. */
  private readonly facades: MeshLambertMaterial[] = [];
  private lamps = 0;
  /** How wet the asphalt is (0..1), and the sky it mirrors: its shader's uniforms. */
  private readonly wet: { readonly wetness: { value: number }; readonly wetSky: { readonly value: Color } };

  constructor(
    private readonly scene: Scene,
    world: DrivingWorld,
    options: TrackViewOptions = {},
  ) {
    this.prelit = options.prelit;
    this.wet = { wetness: { value: 0 }, wetSky: options.sky?.horizon ?? { value: new Color(WET_SKY) } };
    const anisotropy = options.anisotropy ?? 1;
    this.root.add(this.createGround(world.halfSizeMeters, anisotropy));
    if (world.roads.length > 0) {
      this.root.add(...this.createRoads(world, anisotropy));
    }
    if (world.trees.length > 0) {
      const forest = new Group();
      forest.name = 'forest';
      forest.add(...this.createTrees(world.trees));
      this.root.add(forest);
    }
    if (world.buildings.length > 0) {
      this.root.add(...this.createBuildings(world.buildings));
    }
    scene.add(this.root);
  }

  /** How brightly lamps shine, 0..1 (the weather: 0 by day, 1 at night): lit windows glow. Cheap to call every frame. */
  setLamps(level: number): void {
    if (level === this.lamps) {
      return;
    }
    this.lamps = level;
    for (const facade of this.facades) {
      facade.emissive.setScalar(level * WINDOW_GLOW);
    }
  }

  /**
   * How wet the roads are, 0..1 (the rain's): wet asphalt darkens and
   * mirrors the sky, the more the flatter it is seen, so the road ahead
   * shines. Cheap to call every frame.
   */
  setWetness(level: number): void {
    this.wet.wetness.value = level;
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
    const material = this.track(new MeshBasicMaterial({ map: grass, vertexColors: true, color: this.groundLight }));
    this.prelit?.add(material);
    return new Mesh(geometry, material);
  }

  /**
   * Every road in four draw calls: gravel shoulders, asphalt, painted lines
   * and instanced dashes. The markings follow each road's kind (see
   * roadMarkings) and stop short of junctions, where another road crosses,
   * and of the turning circles at dead ends, which are paved like the road.
   */
  private createRoads(world: DrivingWorld, anisotropy: number): (Mesh | InstancedMesh)[] {
    const { roads, network, turningCircles } = world;
    const asphalt = this.texture(toTexture(asphaltImage(), { repeat: true, anisotropy }));
    const gravel = this.texture(toTexture(gravelImage(), { repeat: true, anisotropy }));
    const markingY = ROAD_Y + roads.length * ROAD_STACK + MARKING_GAP;
    const junctionReach = Math.max(...roads.map((road) => road.widthMeters)) / 2 + JUNCTION_MARKING_GAP;
    const clearOfJunctions = (x: number, z: number): boolean =>
      network.junctions.every((junction) => Math.hypot(junction.x - x, junction.z - z) > junctionReach) &&
      turningCircles.every(
        (circle) => Math.hypot(circle.x - x, circle.z - z) > circle.radiusMeters + JUNCTION_MARKING_GAP,
      );

    const shoulders: BufferGeometry[] = [];
    const surfaces: BufferGeometry[] = [];
    const lines: BufferGeometry[] = [];
    const dashes: { road: RoadPath; offset: number }[] = [];
    roads.forEach((road, index) => {
      const shoulder = road.widthMeters / 2 + SHOULDER_WIDTH / 2 - 0.2;
      shoulders.push(
        stripGeometry(
          road,
          [
            { offset: -shoulder, width: SHOULDER_WIDTH },
            { offset: shoulder, width: SHOULDER_WIDTH },
          ],
          SHOULDER_Y,
          GRAVEL_TILE_METERS,
        ),
      );
      surfaces.push(
        stripGeometry(road, [{ offset: 0, width: road.widthMeters }], ROAD_Y + index * ROAD_STACK, ASPHALT_TILE_METERS),
      );
      const markings = roadMarkings(road);
      if (markings.solid.length > 0) {
        const keep = (i: number): boolean => clearOfJunctions(road.x(i), road.z(i));
        lines.push(
          stripGeometry(
            road,
            markings.solid.map((offset) => ({ offset, width: LINE_WIDTH })),
            markingY,
            1,
            keep,
          ),
        );
      }
      for (const offset of markings.dashed) {
        dashes.push({ road, offset });
      }
    });
    // Turning circles lie over the end of their road, with a gravel rim like its shoulders.
    for (const circle of turningCircles) {
      shoulders.push(
        flatDisc(circle.x, circle.z, circle.radiusMeters + SHOULDER_WIDTH - 0.2, SHOULDER_Y, GRAVEL_TILE_METERS),
      );
      surfaces.push(
        flatDisc(circle.x, circle.z, circle.radiusMeters, ROAD_Y + roads.length * ROAD_STACK, ASPHALT_TILE_METERS),
      );
    }

    const meshes: (Mesh | InstancedMesh)[] = [
      new Mesh(this.merged(shoulders), this.overlayMaterial({ map: gravel }, 1)),
      new Mesh(this.merged(surfaces), this.wettable(this.overlayMaterial({ map: asphalt }, 2))),
    ];
    if (lines.length > 0) {
      meshes.push(new Mesh(this.merged(lines), this.overlayMaterial({ color: MARKING_COLOR }, 3)));
    }
    const dashMesh = this.createDashes(dashes, markingY, clearOfJunctions);
    if (dashMesh !== null) {
      meshes.push(dashMesh);
    }
    return meshes;
  }

  /** Dashed lines as one instanced mesh: a dash every DASH_SPACING meters along each line, clear of junctions. */
  private createDashes(
    lines: readonly { road: RoadPath; offset: number }[],
    y: number,
    clearOfJunctions: (x: number, z: number) => boolean,
  ): InstancedMesh | null {
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3(1, 1, 1);
    const matrices: Matrix4[] = [];
    for (const { road, offset } of lines) {
      const count = Math.floor(road.lengthMeters / DASH_SPACING);
      for (let i = 0; i < count; i++) {
        const heading = pointAlong(road, (i + 0.5) * DASH_SPACING, position);
        // Right of the direction of travel: the tangent turned 90° clockwise seen from above.
        position.x -= Math.cos(heading) * offset;
        position.z += Math.sin(heading) * offset;
        if (!clearOfJunctions(position.x, position.z)) {
          continue;
        }
        position.y = y;
        rotation.setFromAxisAngle(UP, heading);
        matrices.push(new Matrix4().compose(position, rotation, scale));
      }
    }
    if (matrices.length === 0) {
      return null;
    }
    const dashes = this.track(
      new InstancedMesh(
        this.track(new BoxGeometry(0.18, 0.01, DASH_LENGTH)),
        this.overlayMaterial({ color: MARKING_COLOR }, 3),
        matrices.length,
      ),
    );
    matrices.forEach((matrix, index) => dashes.setMatrixAt(index, matrix));
    dashes.instanceMatrix.needsUpdate = true;
    return dashes;
  }

  /** Merges `parts` into one tracked geometry and releases the parts. */
  private merged(parts: BufferGeometry[]): BufferGeometry {
    const geometry = this.track(mergeGeometries(parts));
    for (const part of parts) {
      part.dispose();
    }
    return geometry;
  }

  /**
   * Pines and broadleaf trees, picked per tree from its position so the forest
   * is the same every time. Trunks share one instanced mesh; each species has
   * its own crowns, tinted per tree. Shadows are soft decals on the ground.
   *
   * The forest is cut into square tiles of TREE_TILE_METERS, each with its own
   * instanced meshes, so tiles out of view (behind the camera or past the far
   * plane) are culled instead of drawn: on a map kilometres wide, most trees
   * are out of sight.
   */
  private createTrees(trees: readonly TreeObstacle[]): InstancedMesh[] {
    const parts = {
      trunk: this.track(new CylinderGeometry(0.2, 0.3, 1, 6).translate(0, 0.5, 0)),
      trunkMaterial: this.track(new MeshLambertMaterial({ color: TRUNK_COLOR })),
      pine: this.track(pineCrownGeometry()),
      broadleaf: this.track(broadleafCrownGeometry()),
      crownMaterial: this.track(new MeshLambertMaterial({ color: 0xffffff, flatShading: true })),
      shadow: this.track(flatQuad()),
      shadowMaterial: this.shadowMaterial(softShadowImage(), 0.42),
    };
    const tiles = new Map<string, number[]>();
    trees.forEach((tree, index) => {
      const key = `${Math.floor(tree.x / TREE_TILE_METERS)},${Math.floor(tree.z / TREE_TILE_METERS)}`;
      const tile = tiles.get(key);
      if (tile === undefined) {
        tiles.set(key, [index]);
      } else {
        tile.push(index);
      }
    });
    return [...tiles.values()].flatMap((indices) => this.createTreeTile(trees, indices, parts));
  }

  /** One tile of the forest: `indices` into `trees`. The tree's index picks its spin and tint, so tiling changes nothing. */
  private createTreeTile(
    trees: readonly TreeObstacle[],
    indices: readonly number[],
    parts: {
      readonly trunk: BufferGeometry;
      readonly trunkMaterial: Material;
      readonly pine: BufferGeometry;
      readonly broadleaf: BufferGeometry;
      readonly crownMaterial: Material;
      readonly shadow: BufferGeometry;
      readonly shadowMaterial: Material;
    },
  ): InstancedMesh[] {
    const isPine = (tree: TreeObstacle): boolean =>
      fractalNoise(tree.x / 700, tree.z / 700, 4, 2, 5) + (hash(tree.x, tree.z) - 0.5) * 0.5 > 0.5;
    const pineCount = indices.filter((index) => isPine(trees[index]!)).length;
    const trunks = this.track(new InstancedMesh(parts.trunk, parts.trunkMaterial, indices.length));
    const pines = this.track(new InstancedMesh(parts.pine, parts.crownMaterial, Math.max(1, pineCount)));
    const broadleaves = this.track(
      new InstancedMesh(parts.broadleaf, parts.crownMaterial, Math.max(1, indices.length - pineCount)),
    );
    pines.count = pineCount;
    broadleaves.count = indices.length - pineCount;
    const shadows = this.track(new InstancedMesh(parts.shadow, parts.shadowMaterial, indices.length));

    const matrix = new Matrix4();
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    const color = new Color();
    let pineIndex = 0;
    let broadleafIndex = 0;
    indices.forEach((index, slot) => {
      const tree = trees[index]!;
      const pine = isPine(tree);
      const s = tree.scale;
      const trunkHeight = (pine ? 2.2 : 2.8) * s;
      rotation.setFromAxisAngle(UP, index * 2.399); // Golden-angle spin so neighbours differ.
      trunks.setMatrixAt(slot, matrix.compose(position.set(tree.x, 0, tree.z), rotation, scale.set(s, trunkHeight, s)));
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
      shadows.setMatrixAt(slot, matrix.compose(position, rotation.identity(), scale.set(5.5 * s, 1, 5.5 * s)));
    });
    const meshes = [shadows, trunks, pines, broadleaves].filter((mesh) => mesh.count > 0);
    for (const mesh of meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor !== null) {
        mesh.instanceColor.needsUpdate = true;
      }
      mesh.computeBoundingSphere();
    }
    return meshes;
  }

  private createBuildings(buildings: readonly BuildingObstacle[]): Mesh[] {
    const offices: BufferGeometry[] = [];
    const warehouses: BufferGeometry[] = [];
    const roofs: BufferGeometry[] = [];
    const shadows: BufferGeometry[] = [];
    buildings.forEach((box, index) => {
      const width = box.maxX - box.minX;
      const depth = box.maxZ - box.minZ;
      const tint = new Color(BUILDING_TINTS[index % BUILDING_TINTS.length]!);
      (width * depth >= WAREHOUSE_MIN_AREA ? warehouses : offices).push(wallsGeometry(box, tint, index));
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
    add(offices, this.facadeMaterial(officeFacadeImage(), officeWindowLightsImage(WINDOW_LIGHT_TILES)));
    add(warehouses, this.facadeMaterial(warehouseFacadeImage(), warehouseWindowLightsImage(WINDOW_LIGHT_TILES)));
    add(roofs, this.track(new MeshLambertMaterial({ color: ROOF_COLOR })));
    return meshes;
  }

  /** A facade from `image`, with the windows in `lights` glowing at night (see setLamps). */
  private facadeMaterial(image: PixelImage, lights: PixelImage): MeshLambertMaterial {
    const emissiveMap = this.texture(toTexture(lights, { repeat: true }));
    // The facade repeats every tile; the lit windows every WINDOW_LIGHT_TILES tiles.
    emissiveMap.repeat.set(1 / WINDOW_LIGHT_TILES, 1 / WINDOW_LIGHT_TILES);
    const material = this.track(
      new MeshLambertMaterial({
        map: this.texture(toTexture(image, { repeat: true })),
        vertexColors: true,
        emissive: 0x000000,
        emissiveMap,
      }),
    );
    this.facades.push(material);
    return material;
  }

  private shadowMaterial(image: PixelImage, opacity: number): MeshBasicMaterial {
    return this.registerShadow(
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

  private registerShadow(material: MeshBasicMaterial): MeshBasicMaterial {
    this.prelit?.addShadow(material);
    return this.track(material);
  }

  /**
   * Road layers lie flat on the ground: pull them toward the camera instead of
   * relying on tiny height gaps. Higher `layer`s win over lower ones. Like
   * the ground they are unlit, tinted with the light a flat surface receives.
   */
  private overlayMaterial(parameters: { map?: Texture; color?: number }, layer: number): MeshBasicMaterial {
    const { map, color = 0xffffff } = parameters;
    return this.registerLit(
      new MeshBasicMaterial({
        ...(map === undefined ? {} : { map }),
        color: new Color(color).multiply(this.groundLight),
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -2 * layer,
      }),
    );
  }

  /**
   * Lets the rain wet `material` (setWetness): it darkens, and mirrors the
   * sky by a Fresnel term, the view grazing the road mirroring the most.
   */
  private wettable(material: MeshBasicMaterial): MeshBasicMaterial {
    const wet = this.wet;
    material.onBeforeCompile = (shader) => {
      shader.uniforms['wetness'] = wet.wetness;
      shader.uniforms['wetSky'] = wet.wetSky;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vToEye;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvToEye = -mvPosition.xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float wetness;\nuniform vec3 wetSky;\nvarying vec3 vToEye;')
        .replace(
          '#include <opaque_fragment>',
          [
            'vec3 roadUp = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);',
            'float grazing = pow(1.0 - max(dot(normalize(vToEye), roadUp), 0.0), 4.0);',
            'outgoingLight = mix(outgoingLight * (1.0 - 0.35 * wetness), wetSky, wetness * grazing * 0.6);',
            '#include <opaque_fragment>',
          ].join('\n'),
        );
    };
    return material;
  }

  private registerLit(material: MeshBasicMaterial): MeshBasicMaterial {
    this.prelit?.add(material);
    return this.track(material);
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

/** A flat disc facing up at (x, y, z), textured in world space: one texture tile per `tileMeters`. */
function flatDisc(x: number, z: number, radius: number, y: number, tileMeters: number): BufferGeometry {
  const disc = new CircleGeometry(radius, 32).rotateX(-Math.PI / 2).translate(x, y, z);
  const positions = disc.getAttribute('position');
  const uvs = disc.getAttribute('uv');
  for (let i = 0; i < positions.count; i++) {
    uvs.setXY(i, positions.getX(i) / tileMeters, positions.getZ(i) / tileMeters);
  }
  return disc;
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
 * and the building's tint as vertex colour. Each wall starts at a whole
 * tile picked by the building's `index` and side: the facade looks the
 * same, but the pattern of windows lit at night differs from wall to wall.
 */
function wallsGeometry(box: BuildingObstacle, tint: Color, index: number): BufferGeometry {
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
    const u0 = (index * 3 + side) % WINDOW_LIGHT_TILES;
    const v0 = (index + side * 2) % WINDOW_LIGHT_TILES;
    const u1 = u0 + length / FACADE_TILE_WIDTH;
    const v1 = v0 + height / FACADE_TILE_HEIGHT;
    uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
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
 * the road, one unit per `tileMeters`. Pieces between samples that `keep`
 * rejects are left out.
 */
function stripGeometry(
  road: RoadPath,
  bands: readonly { offset: number; width: number }[],
  y: number,
  tileMeters: number,
  keep: (sampleIndex: number) => boolean = () => true,
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
      if (!keep(row % count) || !keep((row + 1) % count)) {
        continue;
      }
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

/**
 * Where a road's lines are painted, meters from its centreline (positive to
 * the right). Streets and the ring road have edge lines and a dashed centre
 * line; the highway has two lanes each way, a double centre line and dashed
 * lane lines; country roads only a dashed centre line.
 */
function roadMarkings(road: RoadPath): { readonly solid: readonly number[]; readonly dashed: readonly number[] } {
  const edge = road.widthMeters / 2 - EDGE_LINE_INSET;
  switch (road.kind) {
    case 'street':
    case 'ringRoad':
      return { solid: [-edge, edge], dashed: [0] };
    case 'highway': {
      const lane = road.widthMeters / 4;
      return { solid: [-edge, -0.15, 0.15, edge], dashed: [-lane, lane] };
    }
    case 'rural':
      return { solid: [], dashed: [0] };
  }
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
