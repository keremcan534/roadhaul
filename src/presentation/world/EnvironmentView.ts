import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  Group,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  ShadowMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  Vector4,
  type Scene,
} from 'three';
import { clamp, degreesToRadians, smoothstep } from '../../core/math/scalar';
import { SeededRandom } from '../../core/random/SeededRandom';
import type { SkyLook } from '../../domain/sky/skyLook';
import type { SkyDirection } from '../../domain/sky/solar';
import { createColorGrade, type ColorGrade } from '../PostProcessing';
import { fractalNoise } from '../textures/noise';
import { cloudPuffImage, moonImage } from '../textures/proceduralImages';
import { toTexture } from '../textures/toTexture';
import {
  GROUND_LIGHT_COLOR,
  relativeGroundLight,
  SKY_LIGHT_COLOR,
  SKY_LIGHT_INTENSITY,
  SUN_COLOR,
  SUN_DIRECTION,
  SUN_INTENSITY,
  sunShareOfGroundLight,
  type PrelitMaterials,
} from './lighting';
import { unlitByLamps } from './LampLighting';
import { Mist, MIST_GLSL, MIST_SKY_METERS } from './Mist';

const ZENITH = 0x3f7fc7;
const HORIZON = 0xc4dcef;
const GROUND_HAZE = 0xa9bfcf;
/** Exponential fog: about 60% at 400 m, fully hazy by 700 m. */
const FOG_DENSITY = 0.0023;
/**
 * Through the colour pass (EnvironmentViewOptions.hdr) the fog mixes into
 * linear light, where the same share of haze shows much more than on the
 * screen's curve: this share of the weather's density looks as hazy.
 */
const LINEAR_FOG_SCALE = 0.65;
const DOME_RADIUS = 800;
/**
 * The hills round the horizon, in two ridges (createHills): how far from the
 * camera their feet are and how deep they reach back, how high their ridges
 * rise (between low and high, as the noise goes), how many swells go round
 * the ring, their colours at the foot and the ridge (sRGB), and how much of
 * the horizon's haze they take at the foot and more at the ridge. The far
 * ridge is drawn first, so the near one stands before it.
 */
const HILL_LAYERS = [
  { radius: 690, depth: 70, low: 38, high: 105, swells: 6, seed: 29, foot: 0x4a5f70, ridge: 0x7d90a2, haze: 0.5, hazeUp: 0.2 },
  { radius: 590, depth: 60, low: 10, high: 52, swells: 10, seed: 7, foot: 0x3a5733, ridge: 0x6a8752, haze: 0.2, hazeUp: 0.14 },
] as const;
/** Steps round the ring and up each ridge's face. */
const HILL_SEGMENTS = 240;
const HILL_ROWS = 5;
/** Clouds in a fully overcast sky; the weather shows a share of them. */
export const CLOUD_COUNT = 48;
/**
 * A cloud's puffs, in units of its size: along its length, up from its flat
 * base, across it, and each puff's radius. A wide base, a heaped middle and
 * a crown, like a fair-weather cumulus.
 */
const PUFF_LAYOUT = [
  [0, 0.6, 0, 1.15],
  [1.05, 0.42, 0.15, 0.95],
  [-1.05, 0.45, -0.12, 0.95],
  [0.5, 1.1, -0.15, 0.9],
  [-0.55, 1, 0.2, 0.85],
  [1.85, 0.28, -0.05, 0.7],
  [-1.9, 0.3, 0.08, 0.72],
  [0.15, 0.4, 0.8, 0.85],
  [-0.2, 0.42, -0.75, 0.85],
  [0.15, 1.55, 0, 0.7],
  [1.4, 0.8, -0.3, 0.7],
  [-1.35, 0.78, 0.3, 0.68],
] as const;
export const PUFFS_PER_CLOUD = PUFF_LAYOUT.length;
/** A puff's billboard is this much wider than the puff: its picture's ball fills about three quarters of it. */
const PUFF_QUAD = 1.33;
/** How tall a cloud is, from its base to its crown, in units of its size: its light goes from grey to white up it. */
const CLOUD_HEIGHT = 1.9;
/** The clouds turn slowly round the camera: this many radians a second (once round in 40 minutes). */
const CLOUD_DRIFT = (Math.PI * 2) / 2400;
/**
 * Real-time shadows (EnvironmentViewOptions.shadowMapSize) fall this far
 * either way round their focus (focusShadows), meters; the sun's shadow
 * camera stands this far up its rays from there. Without shadows the light
 * stands this far from the middle of the map.
 */
const SHADOW_EXTENT_METERS = 50;
const SHADOW_DISTANCE_METERS = 150;
const SUN_DISTANCE_METERS = 300;
/** How dark a shadow is in full sun, like the soft ones under trees; below this much sunlight there are none. */
const SHADOW_OPACITY = 0.5;
const MIN_SHADOW_SUNLIGHT = 0.2;
/** The ground that shows the shadows lies this high, over the road's markings (polygon offset) and under the pools of light. */
const SHADOW_Y = 0.02;
const UP = new Vector3(0, 1, 0);
/** The ground below the horizon is the horizon's colour, this much darker. */
const GROUND_HAZE_SHADE = 0.86;
/**
 * The looks were drawn for a clear day with the sun as high as
 * SUN_DIRECTION: the light on flat ground is measured against its. The sky
 * round the sun glows more the lower it stands, from this high (radians)
 * down to this low.
 */
const REFERENCE_SUN_SINE = SUN_DIRECTION.y;
const HIGH_SUN_ELEVATION = degreesToRadians(48);
const LOW_SUN_ELEVATION = degreesToRadians(3);
/**
 * The eye adapts: by day a low sun (a winter's, a morning's) looks brighter
 * than its light on the ground is, up to this much, from the day's full
 * look (DAY_ELEVATION) on; not at dawn and dusk, which stay low and warm.
 */
const MAX_DAY_EXPOSURE = 1.3;
const DAY_ELEVATION = degreesToRadians(12);
/** Past sunset the sky keeps a glow where the sun went down, this strong, gone by this far below the horizon. */
const AFTERGLOW = 0.45;
const AFTERGLOW_ENDS = degreesToRadians(-9);
const SUNSET_BELOW = degreesToRadians(-1);
const SUNSET_ABOVE = degreesToRadians(3);
/**
 * Twilight's colours opposite the sun (the Earth's shadow on the horizon,
 * the Belt of Venus above it) come as the sun sinks below TWILIGHT_STARTS,
 * are at their fullest down to TWILIGHT_DEEPEST and gone by TWILIGHT_ENDS;
 * the same at dawn. The shadow's top rises this much (as a sine) per radian
 * the sun is down, from EARTH_SHADOW_LOW.
 */
const TWILIGHT_STARTS = degreesToRadians(4);
const TWILIGHT_DEEPEST = degreesToRadians(-3);
const TWILIGHT_ENDS = degreesToRadians(-8);
const EARTH_SHADOW_LOW = 0.045;
const EARTH_SHADOW_RISE = 1.4;
/**
 * At night the towns' lamps light the haze over them (at most GLOWING_TOWNS),
 * showing as the twilight fades (from SUNSET_BELOW down to TWILIGHT_ENDS):
 * a warm dome of light on the horizon toward each, all round from within
 * TOWN_GLOW_NEAR_METERS. The lit haze is about TOWN_GLOW_HAZE_METERS high and
 * TOWN_GLOW_WIDTH_METERS wide either way, so a far town's dome is as bright
 * but smaller (lower and narrower) than a near one's, dimmed only by the air
 * (by a factor e per TOWN_GLOW_REACH_METERS); inside a town it stands as tall
 * as from TOWN_GLOW_INSIDE_METERS off. Cloud sends more of it back down.
 */
export const GLOWING_TOWNS = 4;
const TOWN_GLOW = 0.035;
const TOWN_GLOW_NEAR_METERS = 700;
const TOWN_GLOW_HAZE_METERS = 350;
const TOWN_GLOW_WIDTH_METERS = 500;
const TOWN_GLOW_REACH_METERS = 5000;
const TOWN_GLOW_INSIDE_METERS = 500;
/**
 * The towns' glow toward `bearing` (level, unit), `height` up (a sine), from
 * the townGlow uniform (EnvironmentView.update): for the sky, the hills and
 * the clouds. A dome's width follows its height (both shrink with distance):
 * cos^n of the angle off the town, n from how fast it fades upward. Costs
 * nothing by day (every town dark).
 */
const TOWN_GLOW_NARROWING = 2 * (TOWN_GLOW_HAZE_METERS / TOWN_GLOW_WIDTH_METERS) ** 2;
const TOWNS_GLOW = /* glsl */ `
  uniform vec4 townGlow[${GLOWING_TOWNS}];
  vec3 townsGlow( vec2 bearing, float height ) {
    float glow = 0.0;
    for ( int i = 0; i < ${GLOWING_TOWNS}; i ++ ) {
      vec4 town = townGlow[ i ];
      if ( town.z <= 0.0 ) continue;
      float far = length( town.xy );
      float toward = far > 1e-4 ? max( dot( bearing, town.xy / far ), 0.0 ) : 0.0;
      float across = pow( toward, ${TOWN_GLOW_NARROWING.toFixed(4)} * town.w * town.w );
      glow += town.z * mix( 1.0, across, far ) * exp( -height * town.w );
    }
    return vec3( 1.0, 0.55, 0.28 ) * glow;
  }
`;
/**
 * A rainbow stands opposite the sun in the drops of rain passing by, or just
 * gone with the ground still wet (setWetness), while the sun shines on them
 * (fully from RAINBOW_SUNLIT of a clear day's light): only with the sun low
 * enough for the bow to clear the hills, from RAINBOW_HIGHEST_SUN down,
 * fully from RAINBOW_LOW_SUN, and not once it has set. Its colours and the
 * brighter sky inside it, the darker band out to the fainter second bow,
 * are the dome's (RAINBOW).
 */
const RAINBOW_LOW_SUN = degreesToRadians(20);
const RAINBOW_HIGHEST_SUN = degreesToRadians(34);
const RAINBOW_SUNLIT = 0.55;
/**
 * The morning mist's light (Mist): the horizon's, this much of the way to
 * its own grey (its droplets scatter every colour alike), and toward the
 * sun this share of the sky's glow round it more.
 */
const MIST_GREY = 0.45;
const MIST_SUN_GLOW = 1.2;
/**
 * The sun's shafts (sunShafts) show this strongly in clear air, fully in
 * the mist; with any real sunlight, while the sun is no further under the
 * horizon than its glow over it (a sine).
 */
const CLEAR_AIR_SHAFTS = 0.45;
const SHAFTS_SUNLIGHT = 0.3;
const SHAFTS_SUN_BELOW = -0.03;
/**
 * The rainbow on the sky, `strength` (the rainbow uniform) strong, lit by the
 * sun (`light`) round the point opposite it (`direction` is toward the
 * sun), `up` the height of the sky's point (a sine): the primary bow 40° to
 * 42.4° round (violet inside, red outside), the secondary, fainter and the
 * other way round, 50° to 53.4°; the sky brighter inside the primary and
 * darker between them (Alexander's band). Strongest in the bows' feet,
 * where the rain is thickest.
 */
const RAINBOW = /* glsl */ `
  uniform float rainbow;
  vec3 bowColours( float t ) {
    // t: 0 violet … 1 red, fading at both edges (the red one sharper) and fainter toward the violet.
    float h = 0.78 * clamp( ( 1.0 - t ) * 1.15 - 0.05, 0.0, 1.0 );
    vec3 hue = clamp( abs( mod( h * 6.0 + vec3( 0.0, 4.0, 2.0 ), 6.0 ) - 3.0 ) - 1.0, 0.0, 1.0 );
    return hue * ( 0.4 + 0.6 * t ) * smoothstep( 0.0, 0.3, t ) * ( 1.0 - smoothstep( 0.9, 1.0, t ) );
  }
  vec3 rainbowOver( vec3 sky, vec3 direction, float up, vec3 toSun, vec3 light, float strength ) {
    float angle = degrees( acos( clamp( -dot( direction, toSun ), -1.0, 1.0 ) ) );
    float feet = smoothstep( -0.02, 0.03, up ) * mix( 1.0, 0.6, smoothstep( 0.1, 0.7, up ) ) * strength;
    vec3 bows = bowColours( clamp( ( angle - 40.0 ) / 2.4, 0.0, 1.0 ) )
      + 0.4 * bowColours( clamp( ( 53.4 - angle ) / 3.4, 0.0, 1.0 ) );
    float inside = 1.0 - smoothstep( 36.0, 40.5, angle );
    float between = smoothstep( 42.0, 43.0, angle ) * ( 1.0 - smoothstep( 49.5, 50.5, angle ) );
    // Under the primary bow the sky gives way a little to its colours, so they show on a bright sky too.
    float primary = smoothstep( 39.8, 40.6, angle ) * ( 1.0 - smoothstep( 42.0, 42.6, angle ) );
    return sky * ( 1.0 - ( 0.12 * between + 0.22 * primary ) * feet ) + ( bows * 0.4 + inside * 0.05 ) * light * feet;
  }
`;
/**
 * Lightning's flash (setLightning, 0..1) lights up the sky and the haze in
 * this bluish white, the clouds by this much of their full brightness, and
 * the world by this much of a clear day's light from the sky.
 */
const LIGHTNING_SKY = 0xc2cbff;
const LIGHTNING_SKY_LEVEL = 0.85;
const LIGHTNING_CLOUDS = 1.2;
const LIGHTNING_SKYLIGHT = 1.3;
/** With the moon down, the night's faint key light (the stars', the towns') comes from high up. */
const NIGHT_KEY = new Vector3(0.25, 0.9, 0.35).normalize();
/** The moon's glow round it, as the sun's is round the sun (times the moonlight). */
const MOON_GLOW = 0xc8d4f0;
/** The moon counts as up from this height of its direction (a sine), the key light's source from the next. */
const MOON_SHOWS = -0.03;
const MOON_KEY = 0.05;
/** The key light never comes from lower than this (a sine), so a setting sun lights nothing from below. */
const MIN_KEY_HEIGHT = 0.02;
/** The region's latitude by default, degrees: the stars turn round the pole this high over the north. */
const DEFAULT_LATITUDE = 39;
/**
 * The night sky, beyond the clouds and inside the dome: this many stars, as
 * far as this, each this wide in radians (the brightest the widest); and the
 * moon, this far and this wide (about 3°, bigger than life, like the sun).
 */
const STAR_COUNT = 1400;
const STAR_DISTANCE = 780;
const STAR_SIZE = { faint: 0.0028, bright: 0.007 } as const;
const MOON_DISTANCE = 760;
const MOON_SIZE_METERS = 42;
const MOON_COLOR = 0xeef2ff;
/** Time for the stars' twinkling runs round this many seconds, so it keeps its precision. */
const TWINKLE_PERIOD_SECONDS = 3600;
/** The picture's corners are this much darker by day, and this much more with the lamps on (the colour pass). */
const VIGNETTE = 0.28;
const NIGHT_VIGNETTE = 0.22;
const Z_AXIS = new Vector3(0, 0, 1);

export interface EnvironmentViewOptions {
  /**
   * The picture goes through the colour pass (RenderHost.postProcessing),
   * where the scene's light stays linear and the fog is thinned to look the
   * same. Default: false.
   */
  readonly hdr?: boolean;
  /**
   * The sun casts real-time shadows round a focus (focusShadows) into a map
   * this many texels square (the renderer's shadow map must be on); 0 or
   * absent: none. The objects that cast them set castShadow.
   */
  readonly shadowMapSize?: number;
  /**
   * The share of the weather's clouds shown, 0..1 (fewer, for rendering
   * without a GPU, where every layer of a cloud's puffs costs). Default: 1.
   */
  readonly cloudShare?: number;
  /** The region's latitude, degrees north: where the pole stands that the stars turn round. Default: 39. */
  readonly latitudeDegrees?: number;
}

/**
 * Where the sun, the moon and the stars stand (TimeOfDayService): toward
 * the sun and the moon in the world's axes (x east, y up, z south), how
 * far through its phases the moon is (0 new, 0.5 full), and how far the
 * stars have turned round the pole (radians).
 */
export interface SkyPlacement {
  readonly sun: Readonly<SkyDirection>;
  readonly moon: Readonly<SkyDirection>;
  readonly moonPhase: number;
  readonly starTurn: number;
}

/**
 * The sky as other shaders see it (the sea mirrors it): its colours and the
 * light that glows in it, the sun's (at night the moon's), kept up to date
 * by applySky().
 */
export interface SkyUniforms {
  readonly zenith: { readonly value: Color };
  readonly horizon: { readonly value: Color };
  readonly sunColor: { readonly value: Color };
  readonly sunDirection: { readonly value: Vector3 };
}

/**
 * The scene's light as its lights shade things, for shaders that light
 * themselves (the cab's inside): kept up to date by applySky().
 */
export interface SceneLight {
  /** Toward the key light, unit: the sun's, the moon's, or the night sky's. */
  readonly keyDirection: Readonly<Vector3>;
  /** The key light's colour times its intensity. */
  readonly key: Readonly<Color>;
  /** The sky light's colours from above and from below, times its intensity. */
  readonly sky: Readonly<Color>;
  readonly ground: Readonly<Color>;
}

/**
 * Sky, horizon and light: a gradient dome with a sun glow, soft drifting
 * clouds, two ridges of hazy hills, fog, and the sun and sky lights; at
 * night the stars and the moon. The dome, clouds, hills, stars and moon
 * follow the camera (call update() every frame), so they always sit at the
 * horizon. About three draw calls, two more at night. applySky() turns it
 * all to the time of day and the weather (spec §38–39): sky, haze, light,
 * the sun and the moon where they stand, the moon's phase, the turning
 * stars, clouds, a rainbow after the rain, the morning mist (`mist`), the
 * pre-lit ground with it, the picture's grade (`grade`) and the sun's glare
 * and shafts, for the renderer's colour pass.
 */
export class EnvironmentView {
  private readonly backdrop = new Group();
  private readonly lights: readonly (HemisphereLight | DirectionalLight)[];
  private readonly skyLight: HemisphereLight;
  private readonly sunLight: DirectionalLight;
  private readonly fog: FogExp2;
  private readonly background: Color;
  private readonly skyUniforms: {
    readonly zenith: { value: Color };
    readonly horizon: { value: Color };
    readonly groundHaze: { value: Color };
    readonly sunColor: { value: Color };
    readonly sunDirection: { value: Vector3 };
    /** 0 with the sun high, toward 1 as it nears the horizon: the sky round it glows. */
    readonly sunLow: { value: number };
    /** How strongly twilight colours the sky opposite the sun (0..1), the way away from it, and the Earth's shadow's top (a sine). */
    readonly twilight: { value: number };
    readonly twilightAway: { value: Vector2 };
    readonly earthShadow: { value: number };
    /**
     * Per town: the way toward it (x, z: shorter the nearer it is, its glow then all round), how brightly it
     * glows and how fast the glow fades up the sky (per unit of height's sine): the farther, the faster.
     */
    readonly townGlow: { value: Vector4[] };
    /** How strongly the rainbow shows, 0..1. */
    readonly rainbow: { value: number };
  };
  /**
   * The morning mist over the land (setMist): its uniforms, shared by the
   * sky, the hills and, through Mist.shadeScene(), the world's materials.
   */
  readonly mist = new Mist();
  private mistAmount = 0;
  private readonly mistLight = new Color();
  private readonly mistGlow = new Color();
  private readonly towardSun = new Vector3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z).normalize();
  private glare = 0;
  private shafts = 0;
  private groundSunShare = 0;
  /** Where the towns are (setTowns), and how brightly their lamps light the night's haze (applySky). */
  private readonly towns: { readonly x: number; readonly z: number }[] = [];
  private townLight = 0;
  /** How wet the ground is (setWetness): the rain's drops still in the air, for a rainbow. */
  private wetness = 0;
  /** How bright lightning flashes now (setLightning), and its light in the sky as it adds to the sky's colours. */
  private lightning = 0;
  private readonly lightningSky = new Color();
  private readonly clouds: Mesh;
  private readonly cloudGeometry: InstancedBufferGeometry;
  private readonly cloudUniforms = { brightness: { value: 1 }, drift: { value: 0 } };
  private readonly stars: Mesh;
  private readonly starUniforms = { time: { value: 0 }, level: { value: 0 } };
  private readonly moon: Mesh;
  private readonly moonMaterial: MeshBasicMaterial;
  /** Toward the sun, in the moon picture's own axes: which of its face is lit. */
  private readonly moonLit = { value: new Vector3(0, 0, 1) };
  private readonly toMoon = new Vector3();
  private readonly fromMoon = new Quaternion();
  /** Where the key light comes from (the sun's, the moon's or the night sky's): the shadows' and the ground's light. */
  private readonly keyDirection = new Vector3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z);
  /** The axis the stars turn round: the sky's north pole, the latitude high over the north. */
  private readonly pole: Vector3;
  private readonly resources: { dispose(): void }[] = [];
  private readonly colorGrade = createColorGrade();
  private readonly fogScale: number;
  /** Real-time shadows: the ground that shows them and its material, or null without them. */
  private readonly shadowGround: Mesh | null = null;
  private readonly shadowMaterial: ShadowMaterial | null = null;
  private readonly shadowMapSize: number;
  private readonly cloudShare: number;
  private readonly shadowAcross = new Vector3();
  private readonly shadowUp = new Vector3();
  private shadowFocusX = 0;
  private shadowFocusZ = 0;
  /** Scratch colours for the look. */
  private readonly tint = new Color();
  private readonly groundLight = new Color();
  private readonly sceneLight = { keyDirection: this.keyDirection, key: new Color(), sky: new Color(), ground: new Color() };

  constructor(
    private readonly scene: Scene,
    options: EnvironmentViewOptions = {},
  ) {
    this.fogScale = options.hdr === true ? LINEAR_FOG_SCALE : 1;
    const latitude = degreesToRadians(options.latitudeDegrees ?? DEFAULT_LATITUDE);
    this.pole = new Vector3(0, Math.sin(latitude), -Math.cos(latitude));
    this.background = new Color(HORIZON);
    scene.background = this.background;
    this.fog = new FogExp2(HORIZON, FOG_DENSITY * this.fogScale);
    scene.fog = this.fog;

    this.sunLight = new DirectionalLight(SUN_COLOR, SUN_INTENSITY);
    this.sunLight.position.set(
      SUN_DIRECTION.x * SUN_DISTANCE_METERS,
      SUN_DIRECTION.y * SUN_DISTANCE_METERS,
      SUN_DIRECTION.z * SUN_DISTANCE_METERS,
    );
    this.skyLight = new HemisphereLight(SKY_LIGHT_COLOR, GROUND_LIGHT_COLOR, SKY_LIGHT_INTENSITY);
    this.lights = [this.skyLight, this.sunLight];
    this.keepSceneLight();
    scene.add(...this.lights);
    this.shadowMapSize = options.shadowMapSize ?? 0;
    this.cloudShare = Math.min(1, Math.max(0, options.cloudShare ?? 1));
    if (this.shadowMapSize > 0) {
      [this.shadowGround, this.shadowMaterial] = this.createShadows(this.shadowMapSize);
      // The shadow camera follows its focus: the light's target moves, so it must be in the scene.
      scene.add(this.sunLight.target, this.shadowGround);
    }

    this.skyUniforms = {
      zenith: { value: new Color(ZENITH) },
      horizon: { value: new Color(HORIZON) },
      groundHaze: { value: new Color(GROUND_HAZE) },
      sunColor: { value: new Color(SUN_COLOR) },
      sunDirection: { value: new Vector3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z) },
      sunLow: { value: 0 },
      twilight: { value: 0 },
      twilightAway: { value: new Vector2(0, 1) },
      earthShadow: { value: EARTH_SHADOW_LOW },
      townGlow: { value: Array.from({ length: GLOWING_TOWNS }, () => new Vector4()) },
      rainbow: { value: 0 },
    };
    this.cloudGeometry = this.track(new InstancedBufferGeometry());
    this.clouds = this.createClouds(this.cloudGeometry);
    this.showClouds(0.55);
    this.stars = this.createStars();
    this.moonMaterial = this.track(
      new MeshBasicMaterial({
        map: this.track(toTexture(moonImage())),
        color: MOON_COLOR,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      }),
    );
    this.showMoonPhase(this.moonMaterial);
    this.moon = new Mesh(this.track(new PlaneGeometry(MOON_SIZE_METERS, MOON_SIZE_METERS)), this.moonMaterial);
    // Over the stars, under the clouds and everything else see-through; hidden (no draw call) by day.
    this.moon.renderOrder = -2;
    this.moon.frustumCulled = false;
    this.moon.visible = false;
    this.backdrop.add(this.createDome(), this.createHills(), this.clouds, this.stars, this.moon);
    // The sky, its clouds and hills are far past the lamps' reach.
    unlitByLamps(this.backdrop);
    scene.add(this.backdrop);
  }

  /**
   * Shows the sky `look` (composeSky: the time of day with the weather over
   * it) with the sun, the moon and the stars where `sky` places them, and
   * relights the pre-lit ground in `prelit`: colours, haze, the key light
   * (the sun's; at night the moon's, or the night sky's with the moon down)
   * and the sky's, the glow round the sun (after sunset, where it went
   * down; at night, round the moon), the moon's lit side toward the sun,
   * the stars, clouds, a rainbow in the rain passing or just gone (as wet
   * as setWetness() says), real-time shadows and the grade. By day a low sun
   * is exposed a little brighter, as the eye adapts. Allocation-free.
   */
  applySky(look: Readonly<SkyLook>, sky: SkyPlacement, prelit?: PrelitMaterials): void {
    const sun = sky.sun;
    const moon = sky.moon;
    const elevation = Math.asin(clamp(sun.y, -1, 1));
    const adapted = clamp(Math.sqrt(REFERENCE_SUN_SINE / Math.max(sun.y, 0.05)), 1, MAX_DAY_EXPOSURE);
    const exposure = 1 + (adapted - 1) * smoothstep(LOW_SUN_ELEVATION, DAY_ELEVATION, elevation);
    const sunlight = look.sunlight * exposure;
    // A lightning flash lights the world from the whole sky.
    const flash = this.lightning;
    const skylight = look.skylight * exposure + flash * LIGHTNING_SKYLIGHT;
    const moonlight = look.moonlight;
    this.tint.setHex(look.lightColor);

    // The key light: the sun's, or at night the moon's; with the moon down, the night sky's from high up.
    const key = this.keyDirection;
    const moonUp = moon.y > MOON_KEY;
    let keyLight: number;
    if (sunlight >= moonlight) {
      key.set(sun.x, Math.max(sun.y, MIN_KEY_HEIGHT), sun.z).normalize();
      keyLight = sunlight;
    } else {
      if (moonUp) {
        key.set(moon.x, moon.y, moon.z).normalize();
      } else {
        key.copy(NIGHT_KEY);
      }
      keyLight = moonlight;
    }

    const uniforms = this.skyUniforms;
    uniforms.zenith.value.setHex(look.zenithColor).multiplyScalar(exposure);
    uniforms.horizon.value.setHex(look.horizonColor).multiplyScalar(exposure);
    if (flash > 0) {
      this.lightningSky.setHex(LIGHTNING_SKY).multiplyScalar(flash * LIGHTNING_SKY_LEVEL);
      uniforms.zenith.value.add(this.lightningSky);
      uniforms.horizon.value.add(this.lightningSky);
    }
    uniforms.groundHaze.value.copy(uniforms.horizon.value).multiplyScalar(GROUND_HAZE_SHADE);
    // The glow in the sky: round the sun while it is up and while its twilight lasts (orange at dusk), then
    // round the moon, pale.
    const afterglow = AFTERGLOW * smoothstep(AFTERGLOW_ENDS, SUNSET_BELOW, elevation) * (1 - smoothstep(SUNSET_BELOW, SUNSET_ABOVE, elevation));
    if (elevation > AFTERGLOW_ENDS || !moonUp) {
      uniforms.sunDirection.value.set(sun.x, sun.y, sun.z).normalize();
      uniforms.sunColor.value.setHex(SUN_COLOR).multiply(this.tint).multiplyScalar(Math.max(sunlight, afterglow));
    } else {
      uniforms.sunDirection.value.set(moon.x, moon.y, moon.z).normalize();
      uniforms.sunColor.value.setHex(MOON_GLOW).multiply(this.tint).multiplyScalar(moonlight);
    }
    uniforms.sunLow.value = (1 - smoothstep(LOW_SUN_ELEVATION, HIGH_SUN_ELEVATION, elevation)) ** 2;
    // Twilight opposite the sun, in a clear sky: clouds and rain hide it.
    uniforms.twilight.value =
      smoothstep(TWILIGHT_ENDS, TWILIGHT_DEEPEST, elevation) *
      (1 - smoothstep(0, TWILIGHT_STARTS, elevation)) *
      (1 - 0.85 * look.cloudCover) *
      (1 - look.rain);
    uniforms.twilightAway.value.set(-sun.x, -sun.z);
    if (uniforms.twilightAway.value.lengthSq() > 1e-8) {
      uniforms.twilightAway.value.normalize();
    }
    uniforms.earthShadow.value = EARTH_SHADOW_LOW + Math.max(0, -elevation) * EARTH_SHADOW_RISE;
    // A rainbow in the rain passing by (halfway through a turn of the weather) or just gone (the ground still wet).
    const showers = Math.max(this.wetness - look.rain, 4 * look.rain * (1 - look.rain));
    uniforms.rainbow.value =
      smoothstep(0.05, 0.5, showers) *
      smoothstep(0.15, RAINBOW_SUNLIT, look.sunlight) *
      smoothstep(SUNSET_BELOW, SUNSET_ABOVE, elevation) *
      (1 - smoothstep(RAINBOW_LOW_SUN, RAINBOW_HIGHEST_SUN, elevation));
    // The sun glares while it is up and bright: less through haze and cloud, not at all in the rain.
    this.towardSun.set(sun.x, sun.y, sun.z).normalize();
    this.glare = Math.min(1, look.sunlight) * smoothstep(-0.01, 0.04, sun.y) * (1 - look.rain) * (1 - 0.7 * look.cloudCover);
    // Its shafts: in hazy air, through gaps in trees and cloud; the strongest in the morning's mist.
    this.shafts =
      smoothstep(0, SHAFTS_SUNLIGHT, look.sunlight) *
      smoothstep(SHAFTS_SUN_BELOW, 0.03, sun.y) *
      (1 - look.rain) *
      (1 - 0.5 * look.cloudCover) *
      (CLEAR_AIR_SHAFTS + (1 - CLEAR_AIR_SHAFTS) * this.mistAmount);
    // The towns glow once it is dark (not under a day's rain clouds, lamps lit or not), more back off cloud.
    this.townLight =
      TOWN_GLOW * look.lamps * (1 - smoothstep(TWILIGHT_ENDS, SUNSET_BELOW, elevation)) * (0.6 + 0.8 * look.cloudCover);
    this.placeSun();

    // The moon where it stands, facing the camera, lit on the side toward the sun.
    this.moon.visible = look.moon > 0.01 && moon.y > MOON_SHOWS;
    this.moonMaterial.opacity = look.moon;
    this.toMoon.set(moon.x, moon.y, moon.z).normalize();
    this.moon.position.copy(this.toMoon).multiplyScalar(MOON_DISTANCE);
    this.moon.quaternion.setFromUnitVectors(Z_AXIS, this.toMoon.negate());
    this.fromMoon.copy(this.moon.quaternion).invert();
    this.moonLit.value.set(sun.x, sun.y, sun.z).normalize().applyQuaternion(this.fromMoon);
    // The stars, turned round the pole.
    this.stars.visible = look.stars > 0.01;
    this.starUniforms.level.value = look.stars;
    this.stars.quaternion.setFromAxisAngle(this.pole, sky.starTurn);

    // Flat ground catches less of a low light, and its baked shadows fade with it.
    const groundSun = (keyLight * Math.max(key.y, 0)) / REFERENCE_SUN_SINE;
    this.background.copy(uniforms.horizon.value);
    this.fog.color.copy(uniforms.horizon.value);
    this.fog.density = look.fogDensity * this.fogScale;
    // The mist: the horizon's light, greyer, and glowing round the sky's light (the sun's; before dawn, its glow).
    const horizon = uniforms.horizon.value;
    this.mistLight.setScalar(horizon.r * 0.2126 + horizon.g * 0.7152 + horizon.b * 0.0722);
    this.mistLight.lerp(horizon, 1 - MIST_GREY);
    this.mistGlow.copy(uniforms.sunColor.value).multiplyScalar(MIST_SUN_GLOW);
    this.mist.set(this.mistAmount, this.mistLight, this.mistGlow, uniforms.sunDirection.value);

    this.skyLight.intensity = SKY_LIGHT_INTENSITY * skylight;
    this.skyLight.color.setHex(SKY_LIGHT_COLOR).multiply(this.tint);
    this.sunLight.intensity = SUN_INTENSITY * keyLight;
    this.sunLight.color.setHex(SUN_COLOR).multiply(this.tint);

    this.keepSceneLight();

    this.cloudUniforms.brightness.value = look.cloudBrightness * exposure + flash * LIGHTNING_CLOUDS;
    this.showClouds(look.cloudCover);

    prelit?.setLight(relativeGroundLight(groundSun, skylight, this.tint, this.groundLight), groundSun);
    prelit?.setSun(key);
    this.groundSunShare = sunShareOfGroundLight(groundSun, skylight);
    if (this.shadowGround !== null && this.shadowMaterial !== null) {
      // Long, fainter shadows from a low sun; none under a weak one (night, rain), and then the map is not drawn.
      const shown = keyLight >= MIN_SHADOW_SUNLIGHT;
      this.shadowMaterial.opacity = SHADOW_OPACITY * Math.min(keyLight, 1) * (0.55 + 0.45 * Math.min(1, groundSun / Math.max(keyLight, 1e-3)));
      this.shadowGround.visible = shown;
      if (shown && !this.sunLight.shadow.autoUpdate) {
        this.sunLight.shadow.needsUpdate = true;
      }
      this.sunLight.shadow.autoUpdate = shown;
    }

    const grade = this.colorGrade;
    grade.saturation = look.saturation;
    grade.contrast = look.contrast;
    grade.warmth = look.warmth;
    grade.bloom = look.bloom;
    // At night the lamps light the middle of the picture: darker corners draw the eye there.
    grade.vignette = VIGNETTE + NIGHT_VIGNETTE * look.lamps;
  }

  /** How the renderer's colour pass grades the picture for the sky shown (applySky). Updated in place. */
  get grade(): Readonly<ColorGrade> {
    return this.colorGrade;
  }

  /** The sky's colours and the sun as shader uniforms: share them, and they follow the weather. */
  get sky(): SkyUniforms {
    return this.skyUniforms;
  }

  /** The towns whose lamps glow on the night's horizon (the first GLOWING_TOWNS): where their middles are. */
  setTowns(towns: readonly Readonly<{ x: number; z: number }>[]): void {
    this.towns.length = 0;
    for (const town of towns.slice(0, GLOWING_TOWNS)) {
      this.towns.push({ x: town.x, z: town.z });
    }
  }

  /**
   * How wet the ground is, 0..1 (WeatherService.wetness): with the rain gone
   * or passing, its drops are still in the air out there, and a low sun
   * shows a rainbow in them. Takes effect at the next applySky().
   */
  setWetness(wetness: number): void {
    this.wetness = clamp(wetness, 0, 1);
  }

  /**
   * How thick the morning mist lies, 0..1 (morningMist): over the land, the
   * sky's horizon and the hills, and the sun's shafts through it. Takes
   * effect at the next applySky().
   */
  setMist(amount: number): void {
    this.mistAmount = clamp(amount, 0, 1);
  }

  /**
   * How bright lightning flashes now, 0..1 (Thunderstorm.flash): it lights
   * up the sky, the haze and the clouds, and the world from the sky. Takes
   * effect at the next applySky().
   */
  setLightning(flash: number): void {
    this.lightning = clamp(flash, 0, 1);
  }

  /** Toward the sun (unit; below the horizon at night), as applySky() last placed it. Updated in place. */
  get sunTowards(): Readonly<Vector3> {
    return this.towardSun;
  }

  /** How strongly the sun may glare on the picture (0..1): up, bright, the sky clear (RenderHost.setSun). */
  get sunGlare(): number {
    return this.glare;
  }

  /** How strongly the sun's shafts may show (0..1): the sun up or just under the horizon, hazy air, most in mist (RenderHost.setSun). */
  get sunShafts(): number {
    return this.shafts;
  }

  /** The sun's share of the light on flat ground now (0..1): what the clouds' shadows can take (CloudShadows). */
  get sunShare(): number {
    return this.groundSunShare;
  }

  /** The key light and the sky's as they shade the scene now; the object is updated in place by applySky(). */
  get light(): SceneLight {
    return this.sceneLight;
  }

  /**
   * Keeps the sun's real-time shadows round (`x`, `z`), the truck: the
   * shadow camera snapped to the shadow map's texels across the sun's rays,
   * so the shadows keep still as it moves, and the ground that shows them
   * under it. Does nothing without shadows. Allocation-free.
   */
  focusShadows(x: number, z: number): void {
    if (this.shadowGround === null) {
      return;
    }
    this.shadowFocusX = x;
    this.shadowFocusZ = z;
    this.shadowGround.position.set(x, SHADOW_Y, z);
    this.placeSun();
  }

  /** How many clouds are in the sky (Math.round of `cover` × CLOUD_COUNT), each of PUFFS_PER_CLOUD puffs. */
  get cloudCount(): number {
    return this.clouds.visible ? this.cloudGeometry.instanceCount / PUFFS_PER_CLOUD : 0;
  }

  /**
   * Keeps the backdrop centred on the camera, twinkles the stars and drifts
   * the clouds `deltaSeconds` on. Allocation-free.
   */
  update(cameraPosition: Readonly<{ x: number; z: number }>, deltaSeconds = 0): void {
    this.backdrop.position.set(cameraPosition.x, 0, cameraPosition.z);
    const glow = this.skyUniforms.townGlow.value;
    for (let i = 0; i < GLOWING_TOWNS; i++) {
      const town = this.towns[i];
      if (town === undefined || this.townLight <= 0) {
        glow[i]!.set(0, 0, 0, 0);
        continue;
      }
      const dx = town.x - cameraPosition.x;
      const dz = town.z - cameraPosition.z;
      const distance = Math.hypot(dx, dz);
      // The way toward it, shortened the nearer it is: in a town its glow is all round.
      const far = smoothstep(0, TOWN_GLOW_NEAR_METERS, distance) / Math.max(distance, 1e-3);
      glow[i]!.set(
        dx * far,
        dz * far,
        this.townLight * Math.exp(-Math.max(0, distance - TOWN_GLOW_NEAR_METERS) / TOWN_GLOW_REACH_METERS),
        Math.max(distance, TOWN_GLOW_INSIDE_METERS) / TOWN_GLOW_HAZE_METERS,
      );
    }
    const time = this.starUniforms.time;
    time.value = (time.value + deltaSeconds) % TWINKLE_PERIOD_SECONDS;
    const drift = this.cloudUniforms.drift;
    drift.value = (drift.value + deltaSeconds * CLOUD_DRIFT) % (Math.PI * 2);
  }

  dispose(): void {
    this.scene.remove(this.backdrop, ...this.lights, this.sunLight.target);
    if (this.shadowGround !== null) {
      this.scene.remove(this.shadowGround);
      this.sunLight.shadow.dispose();
    }
    this.scene.background = null;
    this.scene.fog = null;
    for (const resource of this.resources) {
      resource.dispose();
    }
  }

  private createDome(): Mesh {
    const material = this.track(
      new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { ...this.skyUniforms, ...this.mist.uniforms },
        vertexShader: /* glsl */ `
          varying vec3 vDirection;
          void main() {
            vDirection = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 zenith;
          uniform vec3 horizon;
          uniform vec3 groundHaze;
          uniform vec3 sunColor;
          uniform vec3 sunDirection;
          uniform float sunLow;
          uniform float twilight;
          uniform vec2 twilightAway;
          uniform float earthShadow;
          ${TOWNS_GLOW}
          ${RAINBOW}
          ${MIST_GLSL}
          varying vec3 vDirection;
          void main() {
            vec3 direction = normalize(vDirection);
            float up = direction.y;
            vec3 sky = mix(horizon, zenith, pow(max(up, 0.0), 0.5));
            sky = mix(sky, groundHaze, clamp(-up * 6.0, 0.0, 1.0));
            float toSun = max(dot(direction, sunDirection), 0.0);
            // The disc only above the horizon; the halo and the glow stay a while after sunset.
            float disc = pow(toSun, 900.0) * 3.0 * smoothstep(-0.01, 0.01, sunDirection.y);
            sky += sunColor * (disc + pow(toSun, 24.0) * (0.18 + 0.4 * sunLow));
            // A low sun sets the sky along the horizon aglow on its side.
            vec2 bearing = normalize(direction.xz + vec2(1e-5));
            vec2 sunBearing = normalize(sunDirection.xz + vec2(1e-5));
            float sunSide = max(dot(bearing, sunBearing), 0.0);
            sky += sunColor * sunLow * sunSide * sunSide * pow(1.0 - clamp(up, 0.0, 1.0), 5.0) * 0.6;
            // Opposite a setting (or rising) sun: the Earth's shadow, a blue-grey band along the horizon rising as
            // the sun sinks, and the Belt of Venus, pink, above it.
            float away = max(dot(bearing, twilightAway), 0.0);
            float opposite = twilight * away * away;
            float height = max(up, 0.0);
            float shadowBand = 1.0 - smoothstep(earthShadow * 0.75, earthShadow * 1.25, height);
            float belt = smoothstep(earthShadow * 0.8, earthShadow * 1.6, height)
              * (1.0 - smoothstep(earthShadow + 0.06, earthShadow + 0.22, height));
            sky = mix(sky, sky * vec3(0.5, 0.56, 0.8), shadowBand * opposite * 0.85);
            sky += vec3(0.95, 0.42, 0.55) * dot(horizon, vec3(0.2126, 0.7152, 0.0722)) * belt * opposite * 0.65;
            // At night the towns' lamps glow warm on the haze over them.
            sky += townsGlow(bearing, height);
            if (rainbow > 0.0) {
              sky = rainbowOver(sky, direction, up, sunDirection, sunColor, rainbow);
            }
            // The morning mist: a white band along the horizon, thinning up the sky; the sun low in it a soft ball.
            if (mistDensity > 0.0) {
              sky = mistOver(sky, direction * ${MIST_SKY_METERS.toFixed(1)});
            }
            gl_FragColor = vec4(sky, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
      }),
    );
    const dome = new Mesh(this.track(new SphereGeometry(DOME_RADIUS, 32, 16)), material);
    // Drawn after everything opaque and depth-tested, so it only shades the sky that is still showing.
    dome.renderOrder = 1;
    dome.frustumCulled = false;
    return dome;
  }

  /**
   * The hills round the horizon, in two ridges (HILL_LAYERS): bluer mountains
   * far off and green hills before them, their ridgelines drawn from noise
   * that goes round the ring without a seam. Smooth-shaded by the sun and the
   * sky; the farther and the higher, the more they take the horizon's haze,
   * whose colour is the sky's shared uniform, so it follows the weather. One
   * draw call.
   */
  private createHills(): Mesh {
    const positions: number[] = [];
    const colors: number[] = [];
    const hazes: number[] = [];
    const indices: number[] = [];
    const color = new Color();
    const ridge = new Color();
    for (const layer of HILL_LAYERS) {
      const first = positions.length / 3;
      for (let i = 0; i <= HILL_SEGMENTS; i++) {
        const u = i / HILL_SEGMENTS;
        const angle = u * Math.PI * 2;
        // Broad swells with sharper crests on them. The noise tiles across u, so the ring closes on itself.
        const swell = smoothstep(0.25, 0.75, fractalNoise(u % 1, 0.5, layer.swells, 3, layer.seed));
        const crests = 1 - Math.abs(2 * fractalNoise(u % 1, 0.5, layer.swells * 4, 3, layer.seed + 3) - 1);
        const peak = layer.low + (layer.high - layer.low) * (swell * 0.78 + crests * 0.22);
        for (let row = 0; row <= HILL_ROWS; row++) {
          const t = row / HILL_ROWS; // 0 = foot, 1 = ridge.
          const radius = layer.radius + layer.depth * t;
          // Below the ground at the foot, rounding over to the ridge.
          const height = row === 0 ? -10 : peak * Math.sin((t * Math.PI) / 2) ** 0.8;
          positions.push(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
          // Woods and clearings: the colour varies a little along the ridge and up it.
          const patches = 0.82 + 0.36 * fractalNoise(u % 1, t * 0.5, 40, 2, layer.seed + 5);
          color.setHex(layer.foot).lerp(ridge.setHex(layer.ridge), t).multiplyScalar(patches);
          colors.push(color.r, color.g, color.b);
          hazes.push(layer.haze + layer.hazeUp * t);
        }
      }
      for (let i = 0; i < HILL_SEGMENTS; i++) {
        for (let row = 0; row < HILL_ROWS; row++) {
          const a = first + i * (HILL_ROWS + 1) + row;
          const b = first + (i + 1) * (HILL_ROWS + 1) + row;
          // Wound so the faces point inward, toward the camera at the centre.
          indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
    geometry.setAttribute('haze', new BufferAttribute(new Float32Array(hazes), 1));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = this.track(new MeshLambertMaterial({ vertexColors: true, fog: false }));
    const { horizon: hazeColor, townGlow } = this.skyUniforms;
    const mist = this.mist.uniforms;
    material.onBeforeCompile = (shader) => {
      shader.uniforms['hazeColor'] = hazeColor;
      shader.uniforms['townGlow'] = townGlow;
      Object.assign(shader.uniforms, mist);
      // The towns' lit haze lies before them (they stand for far mountains): its glow shows on them as on
      // the sky over them. Per vertex: it changes slowly round the ring.
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nattribute float haze;\nvarying float vHaze;\nvarying vec3 vTownGlow;\n${TOWNS_GLOW}`)
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vHaze = haze;
          vec3 toHill = normalize((modelMatrix * vec4(transformed, 1.0)).xyz - cameraPosition);
          vTownGlow = townsGlow(normalize(toHill.xz + vec2(1e-5)), max(toHill.y, 0.0));`,
        );
      // The morning mist hides their feet; their ridges rise out of it.
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform vec3 hazeColor;\nvarying float vHaze;\nvarying vec3 vTownGlow;\n${MIST_GLSL}`)
        .replace(
          '#include <opaque_fragment>',
          `#include <opaque_fragment>
          gl_FragColor.rgb = mix(gl_FragColor.rgb, hazeColor, vHaze) + vTownGlow;
          if (mistDensity > 0.0) {
            gl_FragColor.rgb = mistOver(gl_FragColor.rgb, -(vec4(vViewPosition, 0.0) * viewMatrix).xyz);
          }`,
        );
    };
    const hills = new Mesh(this.track(geometry), material);
    hills.name = 'hills';
    hills.frustumCulled = false;
    return hills;
  }

  /**
   * The stars: small soft dots on a sphere round the camera, faint ones
   * common and bright ones few, most white, some bluish or warm. Each
   * twinkles at its own pace, and they fade into the haze low down. One
   * draw call, added onto the sky; clouds and hills hide the stars behind
   * them. Hidden (no draw call) by day.
   */
  private createStars(): Mesh {
    const random = new SeededRandom(83);
    const positions = new Float32Array(STAR_COUNT * 12);
    const corners = new Float32Array(STAR_COUNT * 8);
    const colors = new Float32Array(STAR_COUNT * 12);
    const twinkles = new Float32Array(STAR_COUNT * 8);
    const indices = new Uint16Array(STAR_COUNT * 6);
    const direction = new Vector3();
    const across = new Vector3();
    const along = new Vector3();
    const up = new Vector3(0, 1, 0);
    const tint = new Color();
    const quad = [-1, -1, 1, -1, 1, 1, -1, 1];
    for (let star = 0; star < STAR_COUNT; star++) {
      // Even over the whole sphere (a uniform height covers equal areas): the sky turns, and stars rise and set.
      const height = random.range(-1, 1);
      const angle = random.range(0, Math.PI * 2);
      const ring = Math.sqrt(1 - height * height);
      direction.set(Math.cos(angle) * ring, height, Math.sin(angle) * ring);
      across.crossVectors(direction, up).normalize();
      along.crossVectors(across, direction);
      const magnitude = random.next() ** 3;
      const halfSize = (STAR_DISTANCE * (STAR_SIZE.faint + (STAR_SIZE.bright - STAR_SIZE.faint) * magnitude)) / 2;
      const hue = random.next();
      tint.setHex(hue < 0.15 ? 0xbcd2ff : hue < 0.28 ? 0xffe2b8 : 0xffffff).multiplyScalar(0.55 + 0.45 * magnitude);
      const phase = random.range(0, Math.PI * 2);
      const speed = random.range(1.2, 3.4);
      for (let corner = 0; corner < 4; corner++) {
        const cx = quad[corner * 2]!;
        const cy = quad[corner * 2 + 1]!;
        const v = star * 4 + corner;
        positions[v * 3] = direction.x * STAR_DISTANCE + (across.x * cx + along.x * cy) * halfSize;
        positions[v * 3 + 1] = direction.y * STAR_DISTANCE + (across.y * cx + along.y * cy) * halfSize;
        positions[v * 3 + 2] = direction.z * STAR_DISTANCE + (across.z * cx + along.z * cy) * halfSize;
        corners[v * 2] = cx;
        corners[v * 2 + 1] = cy;
        colors[v * 3] = tint.r;
        colors[v * 3 + 1] = tint.g;
        colors[v * 3 + 2] = tint.b;
        twinkles[v * 2] = phase;
        twinkles[v * 2 + 1] = speed;
      }
      indices.set([star * 4, star * 4 + 1, star * 4 + 2, star * 4, star * 4 + 2, star * 4 + 3], star * 6);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('corner', new BufferAttribute(corners, 2));
    geometry.setAttribute('starColor', new BufferAttribute(colors, 3));
    geometry.setAttribute('twinkle', new BufferAttribute(twinkles, 2));
    geometry.setIndex(new BufferAttribute(indices, 1));
    const material = new ShaderMaterial({
      uniforms: this.starUniforms,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
      vertexShader: /* glsl */ `
        attribute vec2 corner;
        attribute vec3 starColor;
        attribute vec2 twinkle;
        uniform float time;
        uniform float level;
        varying vec2 vCorner;
        varying vec3 vColor;
        void main() {
          vCorner = corner;
          float flicker = 0.72 + 0.28 * sin(twinkle.x + time * twinkle.y);
          // Hazed near the horizon, gone below it: by the height the sky's turn has taken the star to.
          float haze = clamp(normalize(mat3(modelMatrix) * position).y * 5.0, 0.0, 1.0);
          vColor = starColor * (flicker * haze * level);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vCorner;
        varying vec3 vColor;
        void main() {
          float dot2 = max(1.0 - dot(vCorner, vCorner), 0.0);
          gl_FragColor = vec4(vColor, dot2 * dot2);
        }
      `,
    });
    const stars = new Mesh(this.track(geometry), this.track(material));
    // Drawn first of everything see-through: behind it all.
    stars.renderOrder = -3;
    stars.frustumCulled = false;
    stars.visible = false;
    return stars;
  }

  /**
   * The moon's phase on its picture: the face as a ball facing the camera,
   * lit on the side toward the sun (`moonLit`, in the picture's axes), the
   * rest in earthshine.
   */
  private showMoonPhase(material: MeshBasicMaterial): void {
    const moonLit = this.moonLit;
    material.onBeforeCompile = (shader) => {
      shader.uniforms['moonLit'] = moonLit;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 moonLit;')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          vec2 face = vMapUv * 2.0 - 1.0;
          vec3 ball = vec3(face, sqrt(max(1.0 - dot(face, face), 0.0)));
          diffuseColor.rgb *= mix(0.06, 1.0, smoothstep(-0.06, 0.12, dot(ball, moonLit)));`,
        );
    };
    material.customProgramCacheKey = () => 'moon-phase';
  }

  /**
   * Puts the key light up its rays: from the middle of the map without
   * shadows; with them, from the shadows' focus snapped to the map's texels
   * (across the rays; along them it makes no difference).
   */
  private placeSun(): void {
    const sun = this.keyDirection;
    const target = this.sunLight.target.position;
    if (this.shadowGround === null) {
      target.set(0, 0, 0);
      this.sunLight.position.copy(sun).multiplyScalar(SUN_DISTANCE_METERS);
      return;
    }
    const across = this.shadowAcross.crossVectors(sun, UP);
    if (across.lengthSq() < 1e-8) {
      across.set(1, 0, 0);
    }
    across.normalize();
    const up = this.shadowUp.crossVectors(across, sun);
    const texel = (2 * SHADOW_EXTENT_METERS) / this.shadowMapSize;
    const x = this.shadowFocusX;
    const z = this.shadowFocusZ;
    const a = Math.round((x * across.x + z * across.z) / texel) * texel;
    const b = Math.round((x * up.x + z * up.z) / texel) * texel;
    const c = x * sun.x + z * sun.z;
    target.copy(across).multiplyScalar(a).addScaledVector(up, b).addScaledVector(sun, c);
    this.sunLight.position.copy(target).addScaledVector(sun, SHADOW_DISTANCE_METERS);
  }

  /**
   * The sun's shadow camera and the ground that shows its shadows: a square
   * as wide as the camera sees, lying over the road, with a material that
   * only darkens where the shadow falls and fades out toward its edges, so
   * no line shows where the map ends.
   */
  private createShadows(mapSize: number): [Mesh, ShadowMaterial] {
    const shadow = this.sunLight.shadow;
    this.sunLight.castShadow = true;
    shadow.mapSize.set(mapSize, mapSize);
    const camera = shadow.camera;
    camera.left = -SHADOW_EXTENT_METERS;
    camera.right = SHADOW_EXTENT_METERS;
    camera.top = SHADOW_EXTENT_METERS;
    camera.bottom = -SHADOW_EXTENT_METERS;
    camera.near = 1;
    camera.far = SHADOW_DISTANCE_METERS * 2;
    camera.updateProjectionMatrix();
    // Soft edges; nothing both casts and receives, so no bias is needed against acne.
    shadow.radius = 3;
    shadow.bias = 0;
    // Drawn on the first frame whatever the weather: every lit shader samples the map, which must exist even
    // while it is not updated (at night).
    shadow.needsUpdate = true;
    const material = this.track(
      new ShadowMaterial({
        color: 0x000000,
        opacity: SHADOW_OPACITY,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -10,
      }),
    );
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vShadowUv;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvShadowUv = uv;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vShadowUv;')
        .replace(
          'gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );',
          'vec2 fromMiddle = abs(vShadowUv - 0.5) * 2.0;\n' +
            'float edge = 1.0 - smoothstep(0.75, 1.0, max(fromMiddle.x, fromMiddle.y));\n' +
            'gl_FragColor = vec4( color, opacity * edge * ( 1.0 - getShadowMask() ) );',
        );
    };
    const ground = new Mesh(
      this.track(new PlaneGeometry(SHADOW_EXTENT_METERS * 2, SHADOW_EXTENT_METERS * 2).rotateX(-Math.PI / 2)),
      material,
    );
    ground.name = 'sun-shadows';
    ground.receiveShadow = true;
    // Over the ground's see-through decals and the sky's layers, before lights, glows and smoke.
    ground.renderOrder = -0.5;
    ground.frustumCulled = false;
    return [ground, material];
  }

  /** Shows Math.round(`cover` × CLOUD_COUNT × the cloud share) clouds: no draw call for none. */
  private showClouds(cover: number): void {
    const count = Math.round(CLOUD_COUNT * Math.min(1, Math.max(0, cover)) * this.cloudShare);
    this.cloudGeometry.instanceCount = count * PUFFS_PER_CLOUD;
    this.clouds.visible = count > 0;
  }

  /**
   * Cumulus clouds round the sky, drifting slowly round the camera: each a
   * heap of soft puffs (PUFF_LAYOUT), billboards facing the camera that share
   * one puff picture, turned and mirrored so no two look alike, and cut off
   * softly at the cloud's flat base. The shader lights them from the sky's
   * uniforms: sunlit tops over grey undersides, each puff rounded like a
   * ball, a silver lining toward the sun, and a fade into the haze low down;
   * at dusk the low sun colours their sides. One draw call.
   */
  private createClouds(geometry: InstancedBufferGeometry): Mesh {
    const random = new SeededRandom(19);
    const puffs = new Float32Array(CLOUD_COUNT * PUFFS_PER_CLOUD * 4);
    const shapes = new Float32Array(CLOUD_COUNT * PUFFS_PER_CLOUD * 3);
    const centres = new Float32Array(CLOUD_COUNT * PUFFS_PER_CLOUD * 4);
    for (let cloud = 0; cloud < CLOUD_COUNT; cloud++) {
      const angle = random.range(0, Math.PI * 2);
      // Some far and low, down toward the horizon's haze; some high overhead.
      const distance = random.range(360, 760);
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      const base = random.range(110, 230);
      const size = random.range(16, 34);
      const stretch = random.range(1.1, 1.7);
      const turn = random.range(0, Math.PI * 2);
      const cos = Math.cos(turn);
      const sin = Math.sin(turn);
      PUFF_LAYOUT.forEach(([along, up, across, radius], index) => {
        const a = (along + random.range(-0.15, 0.15)) * size * stretch;
        const b = (across + random.range(-0.15, 0.15)) * size;
        const puff = cloud * PUFFS_PER_CLOUD + index;
        puffs[puff * 4] = x + cos * a - sin * b;
        puffs[puff * 4 + 1] = base + (up + random.range(-0.1, 0.1)) * size;
        puffs[puff * 4 + 2] = z + sin * a + cos * b;
        puffs[puff * 4 + 3] = radius * size * random.range(0.85, 1.15) * PUFF_QUAD;
        shapes[puff * 3] = base;
        shapes[puff * 3 + 1] = size * CLOUD_HEIGHT;
        shapes[puff * 3 + 2] = random.next();
        // The whole cloud's middle and reach along its length: the light falls on the cloud, not on each puff.
        centres.set([x, base + size * 0.75, z, size * (1.2 + stretch)], puff * 4);
      });
    }
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('puff', new InstancedBufferAttribute(puffs, 4));
    geometry.setAttribute('cloud', new InstancedBufferAttribute(shapes, 3));
    geometry.setAttribute('centre', new InstancedBufferAttribute(centres, 4));
    const sky = this.skyUniforms;
    const material = this.track(
      new ShaderMaterial({
        uniforms: {
          map: { value: this.track(toTexture(cloudPuffImage(), { srgb: false })) },
          zenith: sky.zenith,
          horizon: sky.horizon,
          groundHaze: sky.groundHaze,
          sunColor: sky.sunColor,
          sunDirection: sky.sunDirection,
          sunLow: sky.sunLow,
          townGlow: sky.townGlow,
          ...this.cloudUniforms,
        },
        transparent: true,
        depthWrite: false,
        fog: false,
        vertexShader: /* glsl */ `
          attribute vec4 puff;
          attribute vec3 cloud;
          attribute vec4 centre;
          uniform float drift;
          ${TOWNS_GLOW}
          varying vec2 vCorner;
          varying vec2 vUv;
          varying vec3 vPosition;
          varying vec3 vCloud;
          varying vec4 vCentre;
          varying vec3 vTownGlow;
          void main() {
            float c = cos(drift);
            float s = sin(drift);
            vec3 middle = vec3(c * puff.x - s * puff.z, puff.y, s * puff.x + c * puff.z);
            vCentre = vec4(c * centre.x - s * centre.z, centre.y, s * centre.x + c * centre.z, centre.w);
            // Facing the camera: along the view's right and up, in the world.
            vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
            vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
            vPosition = middle + (right * position.x + up * position.y) * puff.w;
            vCorner = position.xy;
            // Each puff's picture turned and mirrored by its seed.
            float turn = (cloud.z - 0.5) * 2.5;
            vec2 corner = position.xy * vec2(cloud.z > 0.5 ? -1.0 : 1.0, 1.0);
            vUv = mat2(cos(turn), sin(turn), -sin(turn), cos(turn)) * corner * 0.5 + 0.5;
            vCloud = cloud;
            // The towns' glow where the puff is in the sky (per corner: it changes slowly).
            vec3 look = normalize(vPosition - vec3(0.0, cameraPosition.y, 0.0));
            vTownGlow = townsGlow(normalize(look.xz + vec2(1e-5)), max(look.y, 0.0));
            gl_Position = projectionMatrix * modelViewMatrix * vec4(vPosition, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D map;
          uniform vec3 zenith;
          uniform vec3 horizon;
          uniform vec3 groundHaze;
          uniform vec3 sunColor;
          uniform vec3 sunDirection;
          uniform float sunLow;
          uniform float brightness;
          varying vec2 vCorner;
          varying vec2 vUv;
          varying vec3 vPosition;
          varying vec3 vCloud;
          varying vec4 vCentre;
          varying vec3 vTownGlow;
          void main() {
            vec4 puff = texture2D(map, vUv);
            // A flat base, like cumulus: the puffs thin out just under it.
            float above = vPosition.y - vCloud.x;
            float density = puff.a * smoothstep(-4.0, 6.0, above);
            if (density < 0.004) discard;
            float height = clamp(above / vCloud.y, 0.0, 1.0);
            // The light falls on the whole cloud, a squat ellipsoid round its middle; each puff, rounded like a
            // ball facing the camera, bulges out of it.
            vec3 ball = vec3(vCorner * 1.3, 0.0);
            ball.z = sqrt(max(1.0 - dot(ball.xy, ball.xy), 0.0));
            vec3 bulge = (vec4(ball, 0.0) * viewMatrix).xyz;
            vec3 outward = (vPosition - vCentre.xyz) / vec3(vCentre.w, vCentre.w * 0.45, vCentre.w);
            vec3 normal = normalize(normalize(outward + vec3(0.0, 1e-3, 0.0)) * 0.8 + bulge * 0.3);
            float sunlit = clamp(dot(normal, sunDirection) * 0.55 + 0.5, 0.0, 1.0);
            // A high sun leaves the undersides grey; a low one lights them from the side.
            float shade = mix(mix(0.3, 1.0, height), 1.0, sunLow);
            vec3 skyLight = mix(horizon, zenith, clamp(normal.y * 0.5 + 0.5, 0.0, 1.0));
            vec3 sunlight = sunColor * (sunlit * shade * (0.75 + 0.3 * puff.r) * 1.25);
            vec3 view = normalize(vPosition - vec3(0.0, cameraPosition.y, 0.0));
            // Toward the sun, light shines through the thin edges: a silver lining.
            float toward = pow(max(dot(view, sunDirection), 0.0), 10.0);
            sunlight += sunColor * toward * (1.0 - puff.a) * 1.8;
            // Grey rain clouds still take the sky's light: darker than it, not black.
            vec3 ambient = skyLight * (0.4 + 0.35 * height) + groundHaze * (0.2 * (1.0 - height));
            vec3 color = sunlight * brightness + ambient * (0.5 + 0.5 * brightness);
            // Low in the sky the clouds sink into the haze.
            float haze = 1.0 - smoothstep(0.02, 0.3, view.y);
            color = mix(color, horizon, haze * 0.8);
            // At night a town's lamps light the undersides over it, more than the clear sky's haze.
            color += vTownGlow * (2.0 - height);
            gl_FragColor = vec4(color, density * (1.0 - haze * 0.35));
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
      }),
    );
    const clouds = new Mesh(geometry, material);
    clouds.name = 'clouds';
    // Over the stars and the moon, before everything else see-through (its origin is under the camera, so
    // sorting by distance would draw it last).
    clouds.renderOrder = -1;
    clouds.frustumCulled = false;
    return clouds;
  }

  /** The lights' colours times their intensities, as `light` gives them. */
  private keepSceneLight(): void {
    const light = this.sceneLight;
    light.key.copy(this.sunLight.color).multiplyScalar(this.sunLight.intensity);
    light.sky.copy(this.skyLight.color).multiplyScalar(this.skyLight.intensity);
    light.ground.copy(this.skyLight.groundColor).multiplyScalar(this.skyLight.intensity);
  }

  private track<T extends { dispose(): void }>(resource: T): T {
    this.resources.push(resource);
    return resource;
  }
}
