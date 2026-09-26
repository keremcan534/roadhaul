import {
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
import { createPuddleMap, PUDDLE_GLSL } from './puddles';
import { RIBBON_MAX_SPAN_METERS, RIBBON_TOLERANCE_METERS, ribbonRows } from './roadRibbons';
import { createForestFloorMask } from './forestFloor';
import type { GroundMask } from './groundMask';
import { createChannelMask } from './riverChannel';
import { SEASON_GLSL, type SeasonShading } from './SeasonShading';

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
/** The trees that lose their leaves in autumn: they follow the season (SeasonShading). */
const DECIDUOUS: ReadonlySet<TreeKind> = new Set<TreeKind>(['broadleaf', 'poplar']);
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
/** The ground's colour patches (lush, plain, dry) are this big, meters. */
const GROUND_PATCH_METERS = 900;
const LUSH_GROUND = new Color(0.82, 0.98, 0.8);
const DRY_GROUND = new Color(1.12, 1.04, 0.78);

/**
 * The ground's colour at (x, z): large, soft patches of lusher and drier
 * grass, so the tiled grass does not look repeated. Its vertex colour, for
 * the ground and whatever continues it (a river's banks).
 */
export function groundTint(x: number, z: number, target: Color): Color {
  const patch = fractalNoise(x / GROUND_PATCH_METERS, z / GROUND_PATCH_METERS, 6, 3, 77);
  return target.copy(LUSH_GROUND).lerp(DRY_GROUND, Math.max(0, Math.min(1, (patch - 0.35) * 1.8)));
}
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
float groundSnow = 0.0;
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
  #ifdef SEASONS
    // Snow lying in patches that grow together as more of it lies (another scale of the meadows' shade, frayed
    // by the grass's own grain: the lighter tufts whiten first), until the ground is white. Then the season's
    // grass, drier as the year goes on.
    float grain = smoothstep( 0.06, 0.24, sampledDiffuseColor.g );
    float snowLine = 0.2 + 0.55 * texture2D( meadow, meadowUv * 6.1 + vec2( 0.37, 0.61 ) ).r - 0.22 * grain;
    groundSnow = smoothstep( snowLine - 0.06, snowLine + 0.06, snowCover ) * min( 1.0, snowCover * 10.0 );
    sampledDiffuseColor.rgb = dried( sampledDiffuseColor.rgb ) * seasonGrass;
  #endif
  diffuseColor *= sampledDiffuseColor;
#endif
`;

/**
 * The ground plane's masks (GroundMask), sampled where each fragment lies:
 * it is left out where the rivers' channels cut it open (CHANNELS:
 * createChannelMask), their banks and water lying below at their own
 * depth; and it darkens to the forests' floor under the trees (FORESTS:
 * createForestFloorMask).
 */
const GROUND_MASKS_PARS_VERTEX = /* glsl */ `
varying vec2 vGroundXZ;
`;
const GROUND_MASKS_VERTEX = /* glsl */ `
vGroundXZ = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;
`;
const GROUND_MASKS_PARS_FRAGMENT = /* glsl */ `
varying vec2 vGroundXZ;
#ifdef CHANNELS
  uniform sampler2D channelMask;
  uniform vec4 channelFrame;
#endif
#ifdef FORESTS
  uniform sampler2D forestMask;
  uniform vec4 forestFrame;
#endif
`;
const CHANNEL_CUT_FRAGMENT = /* glsl */ `
#ifdef CHANNELS
  if ( texture2D( channelMask, ( vGroundXZ - channelFrame.xy ) * channelFrame.zw ).r < 0.5 ) discard;
#endif
`;
/** Under a forest's trees the grass gives way to needles and fallen leaves in the crowns' shade: the floor's colour, as a factor. */
const FOREST_FLOOR = [0.5, 0.44, 0.3] as const;

/** After the ground's vertex colours: the forests' floor, then the snow lying on it, white in the ground's light. */
const GROUND_SNOW_FRAGMENT = /* glsl */ `
#include <color_fragment>
#ifdef FORESTS
  diffuseColor.rgb *= mix(
    vec3( 1.0 ),
    vec3( ${FOREST_FLOOR.map((value) => value.toFixed(2)).join(', ')} ),
    texture2D( forestMask, ( vGroundXZ - forestFrame.xy ) * forestFrame.zw ).r
  );
#endif
#ifdef SEASONS
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuse * SNOW, groundSnow );
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
/**
 * After three's vertex colours, for the trees that lose their leaves: the
 * season's colours, a tree at a time (seasonLeaves: x autumn, y bare,
 * z blossom). Autumn turns them gold, orange or rust; winter leaves them
 * bare, grey-brown and thinner; spring puts some in white or pink blossom.
 * Linear colours.
 */
const DECIDUOUS_COLOR_VERTEX = /* glsl */ `
#include <color_vertex>
#if defined( SEASONS ) && defined( USE_INSTANCING )
{
  vec2 tree = vec2( instanceMatrix[3][0], instanceMatrix[3][2] );
  float leaf = fract( sin( dot( tree, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
  vec3 turned = leaf < 0.4 ? vec3( 0.66, 0.35, 0.01 ) : leaf < 0.75 ? vec3( 0.64, 0.14, 0.013 ) : vec3( 0.35, 0.05, 0.01 );
  vColor.rgb = mix( vColor.rgb, turned * ( 0.8 + 0.4 * leaf ), seasonLeaves.x );
  vColor.rgb = mix( vColor.rgb, vec3( 0.147, 0.11, 0.084 ), seasonLeaves.y );
  vec3 blossom = leaf < 0.5 ? vec3( 0.94, 0.85, 0.87 ) : vec3( 0.89, 0.48, 0.58 );
  vColor.rgb = mix( vColor.rgb, blossom, seasonLeaves.z * step( 0.6, fract( leaf * 7.0 ) ) );
}
#endif
`;

/** In winter the bare crowns stand thinner round their branches. */
const DECIDUOUS_BEGIN_VERTEX = /* glsl */ `
#include <begin_vertex>
#ifdef SEASONS
  transformed *= 1.0 - 0.38 * seasonLeaves.y;
#endif
`;

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

/** The sky a wet road mirrors when there is none given (a rainy day's haze, a little darker overhead). */
const WET_SKY = 0x7f8b97;
const WET_ZENITH = 0x46525f;
/**
 * The rain rings the puddles: a drop at a time in every cell this many to a
 * meter each way, at its own place and moment, its ring spreading over
 * RING_SECONDS to about half a cell and fading.
 */
const RING_CELLS_PER_METER = 1.6;
const RING_SECONDS = 0.8;

const f = (value: number): string => (Number.isInteger(value) ? `${value}.0` : `${value}`);

/** The wet road's uniforms and helpers (TrackView.wettable). */
const WET_ROAD_PARS = /* glsl */ `
uniform float wetness;
uniform float rainfall;
uniform float rainTime;
uniform vec3 wetSky;
uniform vec3 wetZenith;
varying vec3 vToEye;
varying vec2 vGround;
${PUDDLE_GLSL}
// A hash of a cell, 0..1, steady on large coordinates.
float cellHash( vec2 cell ) {
  vec3 p = fract( vec3( cell.xyx ) * 0.1031 );
  p += dot( p, p.yzx + 33.33 );
  return fract( ( p.x + p.y ) * p.z );
}
`;

/**
 * The wet road, over its lit colour: darker, and mirroring the sky, dully
 * where it is only wet, like glass in its puddles, which the rain rings.
 */
const WET_ROAD = /* glsl */ `
vec3 roadUp = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
float facing = max( dot( normalize( vToEye ), roadUp ), 0.0 );
float grazing = pow( 1.0 - facing, 4.0 );
float puddle = puddleAt( vGround );
// Still water mirrors like glass by Fresnel's term, and seen from above a puddle shows the bright sky over its dark
// bottom more than the term says: the sky outshines the asphalt.
float mirror = wetness * mix( grazing * 0.6, 0.3 + 0.7 * pow( 1.0 - facing, 5.0 ), puddle );
// Along the road it mirrors the horizon; looking down into a puddle, the sky higher up.
vec3 mirrored = mix( wetSky, wetZenith, sqrt( facing ) * puddle );
if ( puddle > 0.0 && rainfall > 0.0 ) {
  // A drop at a time in each cell, at its own place and moment: a ring spreading and fading, tilting the water
  // to mirror more of the sky.
  vec2 cells = vGround * ${f(RING_CELLS_PER_METER)};
  vec2 cell = floor( cells );
  float seed = cellHash( cell );
  float age = fract( rainTime * ${f(1 / RING_SECONDS)} + seed );
  vec2 drop = 0.2 + 0.6 * vec2( seed, cellHash( cell + 17.0 ) );
  float ring = 1.0 - smoothstep( 0.0, 0.05, abs( length( cells - cell - drop ) - age * 0.5 ) );
  mirror = mix( mirror, 1.0, ring * ( 1.0 - age ) * rainfall * puddle * 0.5 );
}
outgoingLight = mix( outgoingLight * ( 1.0 - ( 0.35 + 0.3 * puddle ) * wetness ), mirrored, mirror );
`;

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
  /** The seasons, for the grass, the broadleaf trees and the snow on the ground to follow. */
  readonly seasons?: SeasonShading;
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
  /** The ground plane's width (and depth), meters: its grass's uv runs 0..1 across it. */
  groundSizeMeters = 0;
  /** What the ground's material is made of, shared with createGroundMaterial(). */
  private ground: { readonly grass: Texture; readonly meadow: { value: Texture }; readonly detail: boolean } | null = null;
  /** Where the shadow decals reach without pre-lit materials to follow the sun: the reference sun's way. */
  private readonly fixedShadowReach = { value: new Vector2(SHADOW_OFFSET_PER_METER.x, SHADOW_OFFSET_PER_METER.z) };
  private readonly prelit: PrelitMaterials | undefined;
  private readonly seasons: SeasonShading | null;
  /** Facades whose windows light up at night. */
  private readonly facades: MeshLambertMaterial[] = [];
  private lamps = 0;
  /** How wet the asphalt is (0..1) and how hard it rains, the sky it mirrors and where it holds puddles: its shader's uniforms. */
  private readonly wet: {
    readonly wetness: { value: number };
    readonly rainfall: { value: number };
    readonly wetSky: { readonly value: Color };
    readonly wetZenith: { readonly value: Color };
    readonly puddleMap: { readonly value: Texture };
  };
  /** The wind in the trees' crowns: its clock (seconds) and strength. */
  private readonly wind = { windTime: { value: 0 }, windStrength: { value: 1 } };

  constructor(
    private readonly scene: Scene,
    world: DrivingWorld,
    options: TrackViewOptions = {},
  ) {
    this.prelit = options.prelit;
    this.seasons = options.seasons ?? null;
    this.wet = {
      wetness: { value: 0 },
      rainfall: { value: 0 },
      wetSky: options.sky?.horizon ?? { value: new Color(WET_SKY) },
      wetZenith: options.sky?.zenith ?? { value: new Color(WET_ZENITH) },
      puddleMap: { value: this.texture(createPuddleMap()) },
    };
    const anisotropy = options.anisotropy ?? 1;
    this.root.add(this.createGround(world, anisotropy, options.groundDetail ?? true));
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
   * How wet the roads are, 0..1 (WeatherService.wetness): wet asphalt
   * darkens and mirrors the sky, the more the flatter it is seen, so the
   * road ahead shines; the wetter, the more of its dips hold puddles, which
   * mirror it like glass. Cheap to call every frame.
   */
  setWetness(level: number): void {
    this.wet.wetness.value = level;
  }

  /** How hard it rains, 0..1: the drops ring the puddles, and the wind that comes with it sways the trees harder. */
  setRain(level: number): void {
    this.wet.rainfall.value = level;
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

  /**
   * A new material like the ground's, not cut by the channels, for what
   * continues the ground: a river's banks below the fields, a park's lawn.
   * The same grass, patches, seasons and snow. Its mesh maps the grass like
   * the ground's: uv (0.5 + x / groundSizeMeters, 0.5 - z / groundSizeMeters),
   * with groundTint for its vertex colours.
   */
  createGroundMaterial(): MeshBasicMaterial {
    return this.groundMaterial(null, null);
  }

  /** The ground plane, cut open over the rivers' channels (createChannelMask), darker under the forests (createForestFloorMask). */
  private createGround(world: DrivingWorld, anisotropy: number, detail: boolean): Mesh {
    const size = (world.halfSizeMeters + GROUND_MARGIN) * 2;
    this.groundSizeMeters = size;
    const geometry = this.track(new PlaneGeometry(size, size, 96, 96));
    geometry.rotateX(-Math.PI / 2);
    // Large, soft colour patches (lush, plain, dry) so the tiled grass does not look repeated.
    const positions = geometry.getAttribute('position');
    const colors = new Float32Array(positions.count * 3);
    const tint = new Color();
    for (let i = 0; i < positions.count; i++) {
      groundTint(positions.getX(i), positions.getZ(i), tint);
      colors.set([tint.r, tint.g, tint.b], i * 3);
    }
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    const grass = this.texture(toTexture(grassImage(), { repeat: true, anisotropy }));
    grass.repeat.set(size / GRASS_TILE_METERS, size / GRASS_TILE_METERS);
    this.ground = {
      grass,
      meadow: { value: this.texture(toTexture(meadowImage(), { repeat: true, srgb: false })) },
      detail,
    };
    const channels = createChannelMask(world.rivers);
    const forests = createForestFloorMask(world.forests);
    for (const mask of [channels, forests]) {
      if (mask !== null) {
        this.texture(mask.texture);
      }
    }
    return new Mesh(geometry, this.groundMaterial(channels, forests));
  }

  /**
   * The ground's material: grass, meadows, the seasons and snow, pre-lit.
   * With `channels`, left out where they cut the ground open, the banks and
   * water below showing through; with `forests`, darker under the trees.
   */
  private groundMaterial(channels: GroundMask | null, forests: GroundMask | null): MeshBasicMaterial {
    const ground = this.ground;
    if (ground === null) {
      throw new Error('The ground has not been made yet.');
    }
    const material = this.track(new MeshBasicMaterial({ map: ground.grass, vertexColors: true, color: this.groundLight }));
    const seasons = this.seasons;
    material.defines = {
      ...(ground.detail ? { GROUND_DETAIL: '' } : {}),
      ...(seasons === null ? {} : { SEASONS: '' }),
      ...(channels === null ? {} : { CHANNELS: '' }),
      ...(forests === null ? {} : { FORESTS: '' }),
    };
    material.onBeforeCompile = (shader) => {
      shader.uniforms['meadow'] = ground.meadow;
      seasons?.attach(shader);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform sampler2D meadow;\n${seasons === null ? '' : SEASON_GLSL}`)
        .replace('#include <map_fragment>', GROUND_MAP_FRAGMENT)
        .replace('#include <color_fragment>', GROUND_SNOW_FRAGMENT);
      if (channels !== null || forests !== null) {
        if (channels !== null) {
          shader.uniforms['channelMask'] = { value: channels.texture };
          shader.uniforms['channelFrame'] = { value: channels.frame };
        }
        if (forests !== null) {
          shader.uniforms['forestMask'] = { value: forests.texture };
          shader.uniforms['forestFrame'] = { value: forests.frame };
        }
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>\n${GROUND_MASKS_PARS_VERTEX}`)
          .replace('#include <project_vertex>', `#include <project_vertex>\n${GROUND_MASKS_VERTEX}`);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\n${GROUND_MASKS_PARS_FRAGMENT}`)
          .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${CHANNEL_CUT_FRAGMENT}`);
      }
    };
    this.prelit?.add(material);
    return material;
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
        // A flat quad facing up: only a dash's top shows.
        this.track(new PlaneGeometry(0.18, DASH_LENGTH).rotateX(-Math.PI / 2)),
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
      innerTrunk: this.track(new CylinderGeometry(0.2, 0.28, 1, 4, 1, true).translate(0, 0.5, 0)),
      trunkMaterial: this.track(new MeshLambertMaterial({ color: TRUNK_COLOR })),
      crowns: {
        pine: this.track(pineCrownGeometry()),
        broadleaf: this.track(broadleafCrownGeometry()),
        poplar: this.track(poplarCrownGeometry()),
        cypress: this.track(cypressCrownGeometry()),
        olive: this.track(oliveCrownGeometry()),
      },
      innerCrowns: {
        pine: this.track(innerPineCrownGeometry()),
        broadleaf: this.track(innerBroadleafCrownGeometry()),
      },
      crownMaterials: {
        evergreen: this.track(this.swaying(new MeshLambertMaterial({ color: 0xffffff, flatShading: true }), false)),
        deciduous: this.track(this.swaying(new MeshLambertMaterial({ color: 0xffffff, flatShading: true }), true)),
      },
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
   * species (poplar, cypress, olive), a forest's or a park's its pine or
   * broadleaf; a wild one a pine or a broadleaf by where it stands (pines
   * gather in stands). A forest's inner trees, seen over the trees along its
   * edge, wear simpler crowns on simpler trunks, and cast no decal: the
   * crowns close over. The tree's index picks its spin and tint, so tiling
   * changes nothing. One instanced mesh per kind of crown in the tile, one
   * for each kind of trunk and one for the shadows.
   */
  private createTreeTile(trees: readonly TreeObstacle[], indices: readonly number[], parts: TreeParts): InstancedMesh[] {
    const kindOf = (tree: TreeObstacle): TreeKind =>
      tree.species ?? (fractalNoise(tree.x / 700, tree.z / 700, 4, 2, 5) + (hash(tree.x, tree.z) - 0.5) * 0.5 > 0.5 ? 'pine' : 'broadleaf');
    const isInner = (tree: TreeObstacle, kind: TreeKind): kind is 'pine' | 'broadleaf' =>
      tree.inner === true && (kind === 'pine' || kind === 'broadleaf');
    /** Which crown a tree wears: its kind's, or an inner pine's or broadleaf's simpler one. */
    const crownOf = (tree: TreeObstacle, kind: TreeKind): string => (isInner(tree, kind) ? `${kind}:inner` : kind);
    const counts = new Map<string, { kind: TreeKind; inner: boolean; count: number }>();
    let inner = 0;
    for (const index of indices) {
      const tree = trees[index]!;
      const kind = kindOf(tree);
      const key = crownOf(tree, kind);
      const entry = counts.get(key) ?? { kind, inner: isInner(tree, kind), count: 0 };
      entry.count++;
      counts.set(key, entry);
      if (entry.inner) {
        inner++;
      }
    }
    const trunks = this.track(new InstancedMesh(parts.trunk, parts.trunkMaterial, indices.length - inner));
    const innerTrunks = this.track(new InstancedMesh(parts.innerTrunk, parts.trunkMaterial, inner));
    const shadows = this.track(new InstancedMesh(parts.shadow, parts.shadowMaterial, indices.length - inner));
    const crowns = new Map<string, InstancedMesh>();
    for (const [key, { kind, inner: simple, count }] of counts) {
      const geometry = simple ? parts.innerCrowns[kind as 'pine' | 'broadleaf'] : parts.crowns[kind];
      const crown = this.track(
        new InstancedMesh(geometry, parts.crownMaterials[DECIDUOUS.has(kind) ? 'deciduous' : 'evergreen'], count),
      );
      crown.name = `forest:crowns:${key}`;
      crown.count = 0;
      crowns.set(key, crown);
    }
    for (const mesh of [trunks, innerTrunks, shadows]) {
      mesh.count = 0;
    }

    const matrix = new Matrix4();
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    const color = new Color();
    for (const index of indices) {
      const tree = trees[index]!;
      const kind = kindOf(tree);
      const simple = isInner(tree, kind);
      const shape = TREE_SHAPES[kind];
      const s = tree.scale;
      const trunkHeight = shape.trunkHeight * s;
      rotation.setFromAxisAngle(UP, index * 2.399); // Golden-angle spin so neighbours differ.
      const trunk = simple ? innerTrunks : trunks;
      trunk.setMatrixAt(
        trunk.count++,
        matrix.compose(position.set(tree.x, 0, tree.z), rotation, scale.set(s * shape.trunkGirth, trunkHeight, s * shape.trunkGirth)),
      );
      position.set(tree.x, trunkHeight, tree.z);
      scale.setScalar(s);
      const shade = 0.88 + 0.24 * hash(tree.z, tree.x);
      const crown = crowns.get(crownOf(tree, kind))!;
      crown.setMatrixAt(crown.count, matrix.compose(position, rotation, scale));
      crown.setColorAt(crown.count, color.setHex(shape.colors[index % shape.colors.length]!).multiplyScalar(shade));
      crown.count++;
      if (simple) {
        continue;
      }
      // The shadow falls away from the sun, centred under the crown's projection: the decal's shader moves it
      // there from the tree's foot (followTheSun), by the crown's height, kept in the flat decal's y scale.
      const crownHeight = trunkHeight + shape.crownMiddle * s;
      position.set(tree.x, SHOULDER_Y / 2, tree.z);
      const width = shape.shadowWidth * s;
      shadows.setMatrixAt(shadows.count++, matrix.compose(position, rotation.identity(), scale.set(width, crownHeight, width)));
    }
    const meshes = [shadows, trunks, innerTrunks, ...crowns.values()].filter((mesh) => mesh.count > 0);
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
  /** The wind sways `material`'s crowns; a `deciduous` tree's follow the season too. */
  private swaying(material: MeshLambertMaterial, deciduous: boolean): MeshLambertMaterial {
    const wind = this.wind;
    const seasons = deciduous ? this.seasons : null;
    if (seasons !== null) {
      material.defines = { SEASONS: '' };
    }
    material.onBeforeCompile = (shader) => {
      shader.uniforms['windTime'] = wind.windTime;
      shader.uniforms['windStrength'] = wind.windStrength;
      seasons?.attach(shader);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>\nuniform float windTime;\nuniform float windStrength;\n${seasons === null ? '' : SEASON_GLSL}`,
        )
        .replace('#include <project_vertex>', CROWN_PROJECT_VERTEX);
      if (seasons !== null) {
        shader.vertexShader = shader.vertexShader
          .replace('#include <color_vertex>', DECIDUOUS_COLOR_VERTEX)
          .replace('#include <begin_vertex>', DECIDUOUS_BEGIN_VERTEX);
      }
    };
    material.customProgramCacheKey = () => (seasons === null ? 'tree-crown-wind' : 'tree-crown-wind|seasons');
    return material;
  }

  /**
   * Lets the rain wet `material` (setWetness): it darkens, and mirrors the
   * sky by a Fresnel term, the view grazing the road mirroring the most (the
   * lamps' streaks are WetReflections'). Its dips fill with puddles, darker,
   * that mirror the sky like still water, toward the zenith's colour looking
   * down into them; the rain rings them (setRain).
   */
  private wettable(material: MeshBasicMaterial): MeshBasicMaterial {
    wetUnderLamps(material);
    const wet = this.wet;
    const clock = this.wind.windTime;
    material.onBeforeCompile = (shader) => {
      shader.uniforms['wetness'] = wet.wetness;
      shader.uniforms['puddleWetness'] = wet.wetness;
      shader.uniforms['rainfall'] = wet.rainfall;
      shader.uniforms['rainTime'] = clock;
      shader.uniforms['wetSky'] = wet.wetSky;
      shader.uniforms['wetZenith'] = wet.wetZenith;
      shader.uniforms['puddleMap'] = wet.puddleMap;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vToEye;\nvarying vec2 vGround;')
        .replace(
          '#include <project_vertex>',
          '#include <project_vertex>\nvToEye = -mvPosition.xyz;\nvGround = (modelMatrix * vec4(transformed, 1.0)).xz;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${WET_ROAD_PARS}`)
        .replace('#include <opaque_fragment>', `${WET_ROAD}\n#include <opaque_fragment>`);
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
/** An inner pine's crown: two open cones (the tiers' outline, seen over the trees in front). */
function innerPineCrownGeometry(): BufferGeometry {
  const tiers = [
    new ConeGeometry(2.1, 3.9, 6, 1, true).translate(0, 1.75, 0),
    new ConeGeometry(1.4, 3.2, 6, 1, true).translate(0, 4.0, 0),
  ];
  const crown = mergeGeometries(tiers);
  for (const tier of tiers) {
    tier.dispose();
  }
  return crown;
}

/** An inner broadleaf's crown: two faceted blobs, the full crown's cluster in outline. */
function innerBroadleafCrownGeometry(): BufferGeometry {
  return blobCrown([
    [0, 1.8, 0, 2.2],
    [0.3, 3.0, -0.2, 1.6],
  ]);
}

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
  /** A forest's inner trees' trunks: four sides, open, hardly seen behind the trees along its edge. */
  readonly innerTrunk: BufferGeometry;
  readonly trunkMaterial: Material;
  readonly crowns: Readonly<Record<TreeKind, BufferGeometry>>;
  /** The inner trees' crowns: the same shape, in a few faces (their shape is seen over the edge's crowns). */
  readonly innerCrowns: Readonly<Record<'pine' | 'broadleaf', BufferGeometry>>;
  /** The crowns of trees in leaf all year, and of those that lose their leaves (they follow the season). */
  readonly crownMaterials: { readonly evergreen: Material; readonly deciduous: Material };
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
 * rejects are left out. A ribbon keeps only the samples it needs to stay
 * within a few centimetres of the road (ribbonRows): long pieces where the
 * road runs straight, short ones round its bends.
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
  const kept = ribbonRows(road, RIBBON_TOLERANCE_METERS, RIBBON_MAX_SPAN_METERS, keep);
  const rows = kept.length;
  const positions = new Float32Array(bands.length * rows * 2 * 3);
  const normals = new Float32Array(positions.length);
  const uvs = new Float32Array(bands.length * rows * 2 * 2);
  const indices: number[] = [];
  bands.forEach((band, bandIndex) => {
    const base = bandIndex * rows * 2;
    for (let row = 0; row < rows; row++) {
      const i = kept[row]! % count;
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
      const along = (kept[row] === count ? road.lengthMeters : (road.distances[i] ?? 0)) / tileMeters;
      uvs.set([0, along, 1, along], (base + row * 2) * 2);
    }
    for (let row = 0; row + 1 < rows; row++) {
      if (!keep(kept[row]! % count) || !keep(kept[row + 1]! % count)) {
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
