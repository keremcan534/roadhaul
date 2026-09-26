import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  Vector2,
  Vector3,
  type Material,
  type Scene,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SeededRandom } from '../../core/random/SeededRandom';
import type { TreeSpecies } from '../../domain/world/countryside';
import type { BuildingObstacle, DrivingWorld, TreeObstacle } from '../../domain/world/DrivingWorld';
import { createRoadPoint, type RoadPath } from '../../domain/world/RoadPath';
import { fractalNoise } from '../textures/noise';
import type { PixelImage } from '../textures/pixelImage';
import {
  asphaltImage,
  grassImage,
  gravelImage,
  meadowImage,
  officeFacadeImage,
  officeWindowLightsImage,
  roofTilesImage,
  softBoxShadowImage,
  softShadowImage,
  warehouseFacadeImage,
  warehouseWindowLightsImage,
} from '../textures/proceduralImages';
import { toTexture } from '../textures/toTexture';
import {
  flatRoofGeometry,
  gableRoofGeometry,
  hipRoofGeometry,
  plinthGeometry,
  roofStyleOf,
  rooftopGeometry,
} from './buildingParts';
import { flatGroundLight, SHADOW_OFFSET_PER_METER, SUN_DIRECTION, type PrelitMaterials } from './lighting';
import type { SkyUniforms } from './EnvironmentView';
import { wetUnderLamps } from './LampLighting';

const MARKING_COLOR = 0xf4f3ec;
const TRUNK_COLOR = 0x5e4330;
/** Warm plasters: cream, peach, sand, pale sage, apricot, pale grey. */
const BUILDING_TINTS = [0xf3e7d3, 0xecd3b9, 0xe6dac1, 0xd9ded3, 0xf0dac5, 0xdfe2e3] as const;
/** Terracotta roofs, a shade apart building to building. */
const ROOF_TILE_TINTS = [0xffffff, 0xf2e2dc, 0xffeede, 0xe8d8d0] as const;
const PINE_COLORS = [0x2f5e34, 0x355f2e, 0x2a5233, 0x3b6a37] as const;
const BROADLEAF_COLORS = [0x4f8a3c, 0x5c9442, 0x44803e, 0x6b9a3f, 0x7f9b3a] as const;
/** The trees: the wild ones (pine, broadleaf) and the planted species (countryside.ts). */
type TreeKind = 'pine' | 'broadleaf' | TreeSpecies;
/**
 * Each kind of tree's shape: its trunk's height (and girth, times the
 * trunk's), where the middle of its crown is over the trunk (for the
 * shadow's reach), how wide its shadow is, and its leaves' colours.
 */
const TREE_SHAPES: Readonly<
  Record<TreeKind, { trunkHeight: number; trunkGirth: number; crownMiddle: number; shadowWidth: number; colors: readonly number[] }>
> = {
  pine: { trunkHeight: 2.2, trunkGirth: 1, crownMiddle: 2.6, shadowWidth: 5.5, colors: PINE_COLORS },
  broadleaf: { trunkHeight: 2.8, trunkGirth: 1, crownMiddle: 2.6, shadowWidth: 5.5, colors: BROADLEAF_COLORS },
  poplar: { trunkHeight: 1.4, trunkGirth: 0.8, crownMiddle: 4.6, shadowWidth: 3, colors: [0x5f9440, 0x6a9c45, 0x56893a] },
  cypress: { trunkHeight: 0.4, trunkGirth: 0.9, crownMiddle: 3.4, shadowWidth: 2.2, colors: [0x31603a, 0x386841, 0x2c5835] },
  olive: { trunkHeight: 1.1, trunkGirth: 1.5, crownMiddle: 1.3, shadowWidth: 4.6, colors: [0x7d8f5f, 0x86956a, 0x73865a] },
};

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
/**
 * A zebra crossing lies this far further out from a junction than the
 * markings stop; its stripes are this wide across the road, this long along
 * it, with this gap between them.
 */
const CROSSWALK_SETBACK_METERS = 2.2;
const CROSSWALK_STRIPE = { width: 0.5, length: 2.6, gap: 0.55 } as const;
/** Markings stop this far short of a junction, measured past the widest road's edge. */
const JUNCTION_MARKING_GAP = 2;
/** One grass texture tile covers this many meters; the road textures repeat along the road. */
const GRASS_TILE_METERS = 14;
/** The meadow's lusher and drier blotches repeat every this many meters. */
const MEADOW_TILE_METERS = 110;
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

/**
 * The grass, sampled twice: as tiled, and larger and turned (a period of
 * about 38 m at an angle), half and half, so the tiles' grain does not line
 * up in a grid; then lusher or drier in meadow-sized blotches from a second,
 * small texture, sampled at about 110 m and, turned, at about 33 m. Without
 * GROUND_DETAIL (TrackViewOptions.groundDetail) each is sampled once.
 */
const GROUND_MAP_FRAGMENT = /* glsl */ `
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  vec2 meadowUv = vMapUv * ${(GRASS_TILE_METERS / MEADOW_TILE_METERS).toFixed(4)};
  #ifdef GROUND_DETAIL
    vec2 turnedUv = mat2( 0.8, 0.6, -0.6, 0.8 ) * vMapUv * 0.37 + vec2( 0.31, 0.17 );
    sampledDiffuseColor = mix( sampledDiffuseColor, texture2D( map, turnedUv ), 0.5 );
    float meadowShade = texture2D( meadow, meadowUv ).r * 0.65
      + texture2D( meadow, mat2( 0.6, -0.8, 0.8, 0.6 ) * meadowUv * 3.3 + vec2( 0.53, 0.29 ) ).r * 0.35;
  #else
    float meadowShade = texture2D( meadow, meadowUv ).r;
  #endif
  sampledDiffuseColor.rgb *= mix( vec3( 0.8, 0.92, 0.8 ), vec3( 1.16, 1.08, 0.8 ), meadowShade );
  diffuseColor *= sampledDiffuseColor;
#endif
`;

/**
 * The trees' crowns sway in the wind, the more the higher (meters per meter
 * squared up the crown), toward the wind and back: a gust every few seconds,
 * each tree a little out of step with its neighbours. In the rain the wind
 * blows this much harder.
 */
const CROWN_SWAY = 0.011;
const RAIN_WIND = 1.3;
const WIND_DIRECTION = { x: 0.8, z: 0.6 } as const;
/** Replaces three.js's project_vertex: the crown, placed by its instance, then swayed in the world. */
const CROWN_PROJECT_VERTEX = /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );
// Where the tree stands, and how high over the crown's base this point is.
vec2 treeAt = vec2( 0.0 );
float up = max( transformed.y, 0.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
  treeAt = vec2( instanceMatrix[3][0], instanceMatrix[3][2] );
  up = max( mvPosition.y - instanceMatrix[3][1], 0.0 );
#endif
{
  float phase = dot( treeAt, vec2( 0.071, 0.113 ) );
  float gust = sin( windTime * 1.3 + phase ) + 0.35 * sin( windTime * 2.9 + phase * 1.7 );
  float sway = up * up * ${CROWN_SWAY.toFixed(4)} * windStrength * ( 0.55 + 0.45 * gust );
  mvPosition.xz += vec2( ${WIND_DIRECTION.x.toFixed(2)}, ${WIND_DIRECTION.z.toFixed(2)} ) * sway;
}
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;

/** The sky a wet road mirrors when there is none given (a rainy day's haze). */
const WET_SKY = 0x7f8b97;

export interface TrackViewOptions {
  /** The sky, for a wet road to mirror (EnvironmentView.sky); without it, a rainy day's haze. */
  readonly sky?: SkyUniforms;
  /** Texture anisotropy for the ground and road (renderer capability). */
  readonly anisotropy?: number;
  /** Where the pre-lit ground and road and the shadows register, to follow the weather's light. */
  readonly prelit?: PrelitMaterials;
  /**
   * The ground samples its grass and meadow textures twice each, so nothing
   * repeats; false samples each once (half the texture reads on the largest
   * surface on screen, for rendering without a GPU). Default: true.
   */
  readonly groundDetail?: boolean;
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
  /** Where the shadow decals reach without pre-lit materials to follow the sun: the reference sun's way. */
  private readonly fixedShadowReach = { value: new Vector2(SHADOW_OFFSET_PER_METER.x, SHADOW_OFFSET_PER_METER.z) };
  private readonly prelit: PrelitMaterials | undefined;
  /** Facades whose windows light up at night. */
  private readonly facades: MeshLambertMaterial[] = [];
  private lamps = 0;
  /** How wet the asphalt is (0..1), and the sky it mirrors: its shader's uniforms. */
  private readonly wet: { readonly wetness: { value: number }; readonly wetSky: { readonly value: Color } };
  /** The wind in the trees' crowns: its clock (seconds) and strength. */
  private readonly wind = { windTime: { value: 0 }, windStrength: { value: 1 } };

  constructor(
    private readonly scene: Scene,
    world: DrivingWorld,
    options: TrackViewOptions = {},
  ) {
    this.prelit = options.prelit;
    this.wet = { wetness: { value: 0 }, wetSky: options.sky?.horizon ?? { value: new Color(WET_SKY) } };
    const anisotropy = options.anisotropy ?? 1;
    this.root.add(this.createGround(world.halfSizeMeters, anisotropy, options.groundDetail ?? true));
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
    // The rain comes with wind: the trees sway harder.
    this.wind.windStrength.value = 1 + level * RAIN_WIND;
  }

  /** Advances the wind in the trees by `deltaSeconds` (0 while paused). Allocation-free. */
  update(deltaSeconds: number): void {
    this.wind.windTime.value += deltaSeconds;
  }

  dispose(): void {
    this.scene.remove(this.root);
    for (const resource of this.resources) {
      resource.dispose();
    }
  }

  private createGround(halfSize: number, anisotropy: number, detail: boolean): Mesh {
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
    if (detail) {
      material.defines = { GROUND_DETAIL: '' };
    }
    const meadow = { value: this.texture(toTexture(meadowImage(), { repeat: true, srgb: false })) };
    material.onBeforeCompile = (shader) => {
      shader.uniforms['meadow'] = meadow;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D meadow;')
        .replace('#include <map_fragment>', GROUND_MAP_FRAGMENT);
    };
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

    // Zebra crossings on the city streets' arms of every junction, painted with the lines.
    lines.push(...crosswalkGeometries(world, junctionReach + CROSSWALK_SETBACK_METERS, markingY));

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
    const parts: TreeParts = {
      trunk: this.track(new CylinderGeometry(0.2, 0.3, 1, 6).translate(0, 0.5, 0)),
      trunkMaterial: this.track(new MeshLambertMaterial({ color: TRUNK_COLOR })),
      crowns: {
        pine: this.track(pineCrownGeometry()),
        broadleaf: this.track(broadleafCrownGeometry()),
        poplar: this.track(poplarCrownGeometry()),
        cypress: this.track(cypressCrownGeometry()),
        olive: this.track(oliveCrownGeometry()),
      },
      crownMaterial: this.track(this.swaying(new MeshLambertMaterial({ color: 0xffffff, flatShading: true }))),
      shadow: this.track(flatQuad()),
      shadowMaterial: this.shadowMaterial(softShadowImage(), 0.42, 'tree'),
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

  /**
   * One tile of the forest: `indices` into `trees`. A planted tree is its
   * species (poplar, cypress, olive); a wild one a pine or a broadleaf by
   * where it stands (pines gather in stands). The tree's index picks its
   * spin and tint, so tiling changes nothing. One instanced mesh per kind
   * of crown in the tile, one for the trunks and one for the shadows.
   */
  private createTreeTile(trees: readonly TreeObstacle[], indices: readonly number[], parts: TreeParts): InstancedMesh[] {
    const kindOf = (tree: TreeObstacle): TreeKind =>
      tree.species ?? (fractalNoise(tree.x / 700, tree.z / 700, 4, 2, 5) + (hash(tree.x, tree.z) - 0.5) * 0.5 > 0.5 ? 'pine' : 'broadleaf');
    const counts = new Map<TreeKind, number>();
    for (const index of indices) {
      const kind = kindOf(trees[index]!);
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    const trunks = this.track(new InstancedMesh(parts.trunk, parts.trunkMaterial, indices.length));
    const crowns = new Map<TreeKind, InstancedMesh>();
    for (const [kind, count] of counts) {
      const crown = this.track(new InstancedMesh(parts.crowns[kind], parts.crownMaterial, count));
      crown.name = `forest:crowns:${kind}`;
      crown.count = 0;
      crowns.set(kind, crown);
    }
    const shadows = this.track(new InstancedMesh(parts.shadow, parts.shadowMaterial, indices.length));

    const matrix = new Matrix4();
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    const color = new Color();
    indices.forEach((index, slot) => {
      const tree = trees[index]!;
      const kind = kindOf(tree);
      const shape = TREE_SHAPES[kind];
      const s = tree.scale;
      const trunkHeight = shape.trunkHeight * s;
      rotation.setFromAxisAngle(UP, index * 2.399); // Golden-angle spin so neighbours differ.
      trunks.setMatrixAt(
        slot,
        matrix.compose(position.set(tree.x, 0, tree.z), rotation, scale.set(s * shape.trunkGirth, trunkHeight, s * shape.trunkGirth)),
      );
      position.set(tree.x, trunkHeight, tree.z);
      scale.setScalar(s);
      const shade = 0.88 + 0.24 * hash(tree.z, tree.x);
      const crown = crowns.get(kind)!;
      crown.setMatrixAt(crown.count, matrix.compose(position, rotation, scale));
      crown.setColorAt(crown.count, color.setHex(shape.colors[index % shape.colors.length]!).multiplyScalar(shade));
      crown.count++;
      // The shadow falls away from the sun, centred under the crown's projection: the decal's shader moves it
      // there from the tree's foot (followTheSun), by the crown's height, kept in the flat decal's y scale.
      const crownHeight = trunkHeight + shape.crownMiddle * s;
      position.set(tree.x, SHOULDER_Y / 2, tree.z);
      const width = shape.shadowWidth * s;
      shadows.setMatrixAt(slot, matrix.compose(position, rotation.identity(), scale.set(width, crownHeight, width)));
    });
    const meshes = [shadows, trunks, ...crowns.values()].filter((mesh) => mesh.count > 0);
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
    const tiledRoofs: BufferGeometry[] = [];
    const details: BufferGeometry[] = [];
    const shadows: BufferGeometry[] = [];
    const random = new SeededRandom(311);
    // Solar water heaters face the sun.
    const sunBearing = Math.atan2(SUN_DIRECTION.x, SUN_DIRECTION.z);
    buildings.forEach((box, index) => {
      const width = box.maxX - box.minX;
      const depth = box.maxZ - box.minZ;
      const tint = new Color(BUILDING_TINTS[index % BUILDING_TINTS.length]!);
      (width * depth >= WAREHOUSE_MIN_AREA ? warehouses : offices).push(wallsGeometry(box, tint, index));
      details.push(...plinthGeometry(box));
      switch (roofStyleOf(box, random)) {
        case 'hip':
          tiledRoofs.push(
            hipRoofGeometry(box, Math.min(width, depth) * random.range(0.2, 0.28), new Color(ROOF_TILE_TINTS[index % ROOF_TILE_TINTS.length]!)),
          );
          break;
        case 'gable':
          details.push(gableRoofGeometry(box, Math.min(width, depth) * 0.12, tint));
          break;
        case 'flat':
          details.push(...flatRoofGeometry(box), ...rooftopGeometry(box, random, sunBearing));
          break;
      }
      shadows.push(buildingShadowQuad(box.minX + width / 2, box.minZ + depth / 2, width + 3, depth + 3, box.heightMeters));
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
    add(shadows, this.shadowMaterial(softBoxShadowImage(), 0.38, 'building'));
    add(offices, this.facadeMaterial(officeFacadeImage(), officeWindowLightsImage(WINDOW_LIGHT_TILES)));
    add(warehouses, this.facadeMaterial(warehouseFacadeImage(), warehouseWindowLightsImage(WINDOW_LIGHT_TILES)));
    add(
      tiledRoofs,
      this.track(
        new MeshLambertMaterial({
          map: this.texture(toTexture(roofTilesImage(), { repeat: true })),
          vertexColors: true,
          // Seen from under the eaves too.
          side: DoubleSide,
        }),
      ),
    );
    add(details, this.track(new MeshLambertMaterial({ vertexColors: true })));
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

  /** A baked shadow decal's material: it fades with the sun's light and follows it round (followTheSun). */
  private shadowMaterial(image: PixelImage, opacity: number, kind: ShadowDecalKind): MeshBasicMaterial {
    const material = new MeshBasicMaterial({
      map: this.texture(toTexture(image, { srgb: false })),
      color: 0x000000,
      transparent: true,
      opacity,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    followTheSun(material, this.prelit?.shadowReach ?? this.fixedShadowReach, kind);
    return this.registerShadow(material);
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

  /** Sways the trees' crowns (instanced) in the wind (update, setWetness). Returns the material. */
  private swaying(material: MeshLambertMaterial): MeshLambertMaterial {
    const wind = this.wind;
    material.onBeforeCompile = (shader) => {
      shader.uniforms['windTime'] = wind.windTime;
      shader.uniforms['windStrength'] = wind.windStrength;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float windTime;\nuniform float windStrength;')
        .replace('#include <project_vertex>', CROWN_PROJECT_VERTEX);
    };
    material.customProgramCacheKey = () => 'tree-crown-wind';
    return material;
  }

  /**
   * Lets the rain wet `material` (setWetness): it darkens, and mirrors the
   * sky by a Fresnel term, the view grazing the road mirroring the most (and
   * the lamps at night: LampLighting).
   */
  private wettable(material: MeshBasicMaterial): MeshBasicMaterial {
    wetUnderLamps(material);
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

/** The baked shadow decals: under a tree's crown (instanced), or round a building's footprint (merged). */
type ShadowDecalKind = 'tree' | 'building';

/**
 * A building's shadow decal: a flat quad round its footprint at (x, z)
 * whose shader stretches it away from the sun by the building's height
 * (followTheSun): each corner carries which way it lies from the middle
 * (x, z: ±1) and the height.
 */
function buildingShadowQuad(x: number, z: number, width: number, depth: number, height: number): BufferGeometry {
  const quad = flatQuad(width, depth).translate(x, SHOULDER_Y / 2, z);
  const positions = quad.getAttribute('position');
  const cast = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i++) {
    cast[i * 3] = Math.sign(positions.getX(i) - x);
    cast[i * 3 + 1] = Math.sign(positions.getZ(i) - z);
    cast[i * 3 + 2] = height;
  }
  quad.setAttribute('shadowCast', new BufferAttribute(cast, 3));
  return quad;
}

/**
 * Moves a baked shadow decal away from the key light, as far as `reach`
 * says per meter of height (PrelitMaterials.shadowReach, following the sun
 * across the sky): a tree's soft spot to under its crown's shadow,
 * stretched along its way the lower the sun (the crown's height rides in
 * the flat decal's y scale); a building's quad grown from its footprint to
 * where its roof's shadow falls.
 */
function followTheSun(material: MeshBasicMaterial, reach: { readonly value: Vector2 }, kind: ShadowDecalKind): void {
  const move =
    kind === 'tree'
      ? /* glsl */ `
        vec2 decalScale = vec2(instanceMatrix[0][0], instanceMatrix[2][2]);
        vec2 reach = shadowReach * instanceMatrix[1][1] * 0.5;
        float reachLength = length(reach);
        vec2 along = reachLength > 1e-4 ? reach / reachLength : vec2(1.0, 0.0);
        vec2 spot = transformed.xz * decalScale;
        spot += along * dot(spot, along) * (reachLength / decalScale.x);
        transformed.xz = (spot + reach) / decalScale;`
      : /* glsl */ `
        vec2 reach = shadowReach * shadowCast.z;
        transformed.xz += reach * 0.5 + shadowCast.xy * abs(reach) * 0.5;`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms['shadowReach'] = reach;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform vec2 shadowReach;${kind === 'building' ? '\nattribute vec3 shadowCast;' : ''}`,
      )
      .replace('#include <begin_vertex>', `#include <begin_vertex>${move}`);
  };
  material.customProgramCacheKey = () => `shadow-decal-${kind}`;
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

/** The parts every tile of trees shares: the trunk, each kind's crown, their materials, and the shadow decal. */
interface TreeParts {
  readonly trunk: BufferGeometry;
  readonly trunkMaterial: Material;
  readonly crowns: Readonly<Record<TreeKind, BufferGeometry>>;
  readonly crownMaterial: Material;
  readonly shadow: BufferGeometry;
  readonly shadowMaterial: Material;
}

/** Faceted blobs (x, y, z, radius), each corner nudged by a hash of where it is, merged (origin at the crown's base). */
function blobCrown(blobs: readonly (readonly [number, number, number, number])[], squash: readonly [number, number, number] = [1, 1, 1]): BufferGeometry {
  const pieces = blobs.map(([x, y, z, r]) => {
    const blob = new IcosahedronGeometry(r, 0).scale(...squash).translate(x, y, z);
    const position = blob.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      const px = position.getX(i);
      const py = position.getY(i);
      const pz = position.getZ(i);
      position.setXYZ(i, px + (hash(py, pz) - 0.5) * 0.25, py + (hash(pz, px) - 0.5) * 0.25, pz + (hash(px, py) - 0.5) * 0.25);
    }
    return blob;
  });
  const crown = mergeGeometries(pieces);
  crown.computeVertexNormals();
  for (const piece of pieces) {
    piece.dispose();
  }
  return crown;
}

/** A Lombardy poplar's tall, slim column of leaves. */
function poplarCrownGeometry(): BufferGeometry {
  return blobCrown(
    [
      [0, 2.2, 0, 1.2],
      [0.1, 4.2, -0.1, 1.15],
      [-0.1, 6.1, 0.05, 1],
      [0, 7.7, 0, 0.75],
    ],
    [0.85, 1.5, 0.85],
  );
}

/** A cypress's outline from its foot to its tip: radius and height (meters), widest a third of the way up. */
const CYPRESS_OUTLINE = [
  [0, 0],
  [0.5, 0.15],
  [0.78, 0.9],
  [0.86, 2.1],
  [0.8, 3.5],
  [0.64, 4.9],
  [0.42, 6.1],
  [0.2, 7.1],
  [0, 7.7],
] as const;

/** A cypress: a dark, slender flame of a tree, its surface a little uneven. */
function cypressCrownGeometry(): BufferGeometry {
  const crown = new LatheGeometry(
    CYPRESS_OUTLINE.map(([radius, height]) => new Vector2(radius, height)),
    9,
  );
  const position = crown.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const px = position.getX(i);
    const py = position.getY(i);
    const pz = position.getZ(i);
    // Out or in by a hash of where it is, so the seam's two copies of a corner move together.
    const bulge = 0.88 + 0.24 * hash(Math.round(px * 100) + py * 7, Math.round(pz * 100) + py * 3);
    position.setXYZ(i, px * bulge, py, pz * bulge);
  }
  // The lathe's own normals: smooth all round, the seam included.
  return crown;
}

/** An olive: a low, wide, uneven crown of grey-green, on a short thick trunk. */
function oliveCrownGeometry(): BufferGeometry {
  return blobCrown(
    [
      [0, 1.1, 0, 1.35],
      [1.0, 0.8, 0.5, 1],
      [-0.9, 0.9, -0.4, 1.05],
      [0.2, 1.7, -0.7, 0.9],
      [-0.3, 0.7, 1.0, 0.85],
    ],
    [1, 0.7, 1],
  );
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
 * Zebra crossings where city streets meet: on each street arm of every
 * junction, `setback` meters out from its middle, stripes across the whole
 * road, each a flat quad `y` over the ground (with the painted lines' uv and
 * normal, to merge with them).
 */
function crosswalkGeometries(world: DrivingWorld, setback: number, y: number): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  const point = createRoadPoint();
  for (const junction of world.network.junctions) {
    for (const member of junction.members) {
      const road = world.roads[member.roadIndex]!;
      if (road.kind !== 'street') {
        continue;
      }
      const at = road.distances[member.sampleIndex]!;
      for (const arm of [-1, 1] as const) {
        const along = at + arm * setback;
        if (!road.closed && (along < 0 || along > road.lengthMeters)) {
          continue;
        }
        road.pointAt(along, point);
        const heading = Math.atan2(point.directionX, point.directionZ);
        const usable = road.widthMeters - 1;
        const stripes = Math.floor((usable + CROSSWALK_STRIPE.gap) / (CROSSWALK_STRIPE.width + CROSSWALK_STRIPE.gap));
        const span = stripes * CROSSWALK_STRIPE.width + (stripes - 1) * CROSSWALK_STRIPE.gap;
        for (let stripe = 0; stripe < stripes; stripe++) {
          const across = -span / 2 + CROSSWALK_STRIPE.width / 2 + stripe * (CROSSWALK_STRIPE.width + CROSSWALK_STRIPE.gap);
          parts.push(
            new PlaneGeometry(CROSSWALK_STRIPE.width, CROSSWALK_STRIPE.length)
              .rotateX(-Math.PI / 2)
              .rotateY(heading)
              .translate(point.x + point.directionZ * across, y, point.z - point.directionX * across),
          );
        }
      }
    }
  }
  return parts;
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
