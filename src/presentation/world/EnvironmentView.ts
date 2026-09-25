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
  ShaderMaterial,
  ShadowMaterial,
  SphereGeometry,
  Vector3,
  type Scene,
} from 'three';
import { smoothstep } from '../../core/math/scalar';
import { SeededRandom } from '../../core/random/SeededRandom';
import type { WeatherLook } from '../../data/definitions/WeatherDefinition';
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
  type PrelitMaterials,
} from './lighting';

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
 * Where the sun stands: always in the same quarter of the sky, as high as
 * SUN_DIRECTION on a clear day (a look's sunHeight 1) and this high above
 * the horizon at sunHeight 0, radians.
 */
const SUN_AZIMUTH = Math.atan2(SUN_DIRECTION.x, SUN_DIRECTION.z);
const DAY_SUN_ELEVATION = Math.asin(SUN_DIRECTION.y);
const HORIZON_SUN_ELEVATION = (3 * Math.PI) / 180;
/**
 * The night sky, beyond the clouds and inside the dome: this many stars, as
 * far as this, each this wide in radians (the brightest the widest); and the
 * moon, this far and this wide (about 3°, bigger than life, like the sun).
 */
const STAR_COUNT = 700;
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
}

/** The sky as other shaders see it (the sea mirrors it): its colours and the sun, kept up to date by applyWeather(). */
export interface SkyUniforms {
  readonly zenith: { readonly value: Color };
  readonly horizon: { readonly value: Color };
  readonly sunColor: { readonly value: Color };
  readonly sunDirection: { readonly value: Vector3 };
}

/**
 * Sky, horizon and light: a gradient dome with a sun glow, soft drifting
 * clouds, two ridges of hazy hills, fog, and the sun and sky lights; at
 * night the stars and the moon. The dome, clouds, hills, stars and moon follow the camera
 * (call update() every frame), so they always sit at the horizon. About
 * three draw calls, two more at night. applyWeather() turns it all to the
 * weather and the time of day (spec §38–39): sky, haze, light, the sun's
 * height, clouds, stars and moon, the pre-lit ground with it, and the
 * picture's grade (`grade`, for the renderer's colour pass).
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
  };
  private readonly clouds: Mesh;
  private readonly cloudGeometry: InstancedBufferGeometry;
  private readonly cloudUniforms = { brightness: { value: 1 }, drift: { value: 0 } };
  private readonly stars: Mesh;
  private readonly starUniforms = { time: { value: 0 }, level: { value: 0 } };
  private readonly moon: Mesh;
  private readonly moonMaterial: MeshBasicMaterial;
  private readonly toMoon = new Vector3();
  private readonly resources: { dispose(): void }[] = [];
  private readonly colorGrade = createColorGrade();
  private readonly fogScale: number;
  /** Real-time shadows: the ground that shows them and its material, or null without them. */
  private readonly shadowGround: Mesh | null = null;
  private readonly shadowMaterial: ShadowMaterial | null = null;
  private readonly shadowMapSize: number;
  private readonly shadowAcross = new Vector3();
  private readonly shadowUp = new Vector3();
  private shadowFocusX = 0;
  private shadowFocusZ = 0;
  /** Scratch colours for blending looks, and what was last applied (so an unchanged look costs nothing). */
  private readonly tint = new Color();
  private readonly scratch = new Color();
  private readonly groundLight = new Color();
  private appliedFrom: WeatherLook | null = null;
  private appliedTo: WeatherLook | null = null;
  private appliedBlend = Number.NaN;

  constructor(
    private readonly scene: Scene,
    options: EnvironmentViewOptions = {},
  ) {
    this.fogScale = options.hdr === true ? LINEAR_FOG_SCALE : 1;
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
    scene.add(...this.lights);
    this.shadowMapSize = options.shadowMapSize ?? 0;
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
    this.moon = new Mesh(this.track(new PlaneGeometry(MOON_SIZE_METERS, MOON_SIZE_METERS)), this.moonMaterial);
    // Over the stars, under the clouds and everything else see-through; hidden (no draw call) by day.
    this.moon.renderOrder = -2;
    this.moon.frustumCulled = false;
    this.moon.visible = false;
    this.backdrop.add(this.createDome(), this.createHills(), this.clouds, this.stars, this.moon);
    scene.add(this.backdrop);
  }

  /**
   * Shows the weather `blend` (0..1) of the way from look `from` to look
   * `to`, and relights the pre-lit ground in `prelit`. Cheap to call every
   * frame: it does nothing while the look stays the same. Allocation-free.
   */
  applyWeather(from: WeatherLook, to: WeatherLook, blend: number, prelit?: PrelitMaterials): void {
    if (from === this.appliedFrom && to === this.appliedTo && blend === this.appliedBlend) {
      return;
    }
    this.appliedFrom = from;
    this.appliedTo = to;
    this.appliedBlend = blend;
    const sunlight = mix(from.sunlight, to.sunlight, blend);
    const skylight = mix(from.skylight, to.skylight, blend);
    this.tint.setHex(from.lightColor).lerp(this.scratch.setHex(to.lightColor), blend);

    const uniforms = this.skyUniforms;
    uniforms.zenith.value.setHex(from.zenithColor).lerp(this.scratch.setHex(to.zenithColor), blend);
    uniforms.horizon.value.setHex(from.horizonColor).lerp(this.scratch.setHex(to.horizonColor), blend);
    uniforms.groundHaze.value.copy(uniforms.horizon.value).multiplyScalar(GROUND_HAZE_SHADE);
    // The sun's glow takes the light's colour: orange at dusk, pale blue for the moon.
    uniforms.sunColor.value.setHex(SUN_COLOR).multiply(this.tint).multiplyScalar(sunlight);
    const sunHeight = mix(from.sunHeight, to.sunHeight, blend);
    const elevation = HORIZON_SUN_ELEVATION + (DAY_SUN_ELEVATION - HORIZON_SUN_ELEVATION) * sunHeight;
    const sun = uniforms.sunDirection.value.set(
      Math.sin(SUN_AZIMUTH) * Math.cos(elevation),
      Math.sin(elevation),
      Math.cos(SUN_AZIMUTH) * Math.cos(elevation),
    );
    uniforms.sunLow.value = (1 - sunHeight) * (1 - sunHeight);
    this.placeSun();
    // At night the light is the moon's: it shows where the light comes from, facing the camera.
    const moon = mix(from.moon, to.moon, blend);
    this.moon.visible = moon > 0.01;
    this.moonMaterial.opacity = moon;
    this.moon.position.copy(sun).multiplyScalar(MOON_DISTANCE);
    this.moon.quaternion.setFromUnitVectors(Z_AXIS, this.toMoon.copy(sun).negate());
    const stars = mix(from.stars, to.stars, blend);
    this.stars.visible = stars > 0.01;
    this.starUniforms.level.value = stars;
    // Flat ground catches less of a low sun, and its baked shadows fade with it.
    const groundSun = (sunlight * Math.sin(elevation)) / Math.sin(DAY_SUN_ELEVATION);
    this.background.copy(uniforms.horizon.value);
    this.fog.color.copy(uniforms.horizon.value);
    this.fog.density = mix(from.fogDensity, to.fogDensity, blend) * this.fogScale;

    this.skyLight.intensity = SKY_LIGHT_INTENSITY * skylight;
    this.skyLight.color.setHex(SKY_LIGHT_COLOR).multiply(this.tint);
    this.sunLight.intensity = SUN_INTENSITY * sunlight;
    this.sunLight.color.setHex(SUN_COLOR).multiply(this.tint);

    this.cloudUniforms.brightness.value = mix(from.cloudBrightness, to.cloudBrightness, blend);
    this.showClouds(mix(from.cloudCover, to.cloudCover, blend));

    prelit?.setLight(relativeGroundLight(groundSun, skylight, this.tint, this.groundLight), groundSun);
    if (this.shadowGround !== null && this.shadowMaterial !== null) {
      // Long, fainter shadows from a low sun; none under a weak one (night, rain), and then the map is not drawn.
      const shown = sunlight >= MIN_SHADOW_SUNLIGHT;
      this.shadowMaterial.opacity = SHADOW_OPACITY * sunlight * (0.55 + 0.45 * Math.min(1, groundSun / Math.max(sunlight, 1e-3)));
      this.shadowGround.visible = shown;
      if (shown && !this.sunLight.shadow.autoUpdate) {
        this.sunLight.shadow.needsUpdate = true;
      }
      this.sunLight.shadow.autoUpdate = shown;
    }

    const grade = this.colorGrade;
    grade.saturation = mix(from.saturation, to.saturation, blend);
    grade.contrast = mix(from.contrast, to.contrast, blend);
    grade.warmth = mix(from.warmth, to.warmth, blend);
    grade.bloom = mix(from.bloom, to.bloom, blend);
    // At night the lamps light the middle of the picture: darker corners draw the eye there.
    grade.vignette = VIGNETTE + NIGHT_VIGNETTE * mix(from.lamps, to.lamps, blend);
  }

  /** How the renderer's colour pass grades the picture for the weather shown (applyWeather). Updated in place. */
  get grade(): Readonly<ColorGrade> {
    return this.colorGrade;
  }

  /** The sky's colours and the sun as shader uniforms: share them, and they follow the weather. */
  get sky(): SkyUniforms {
    return this.skyUniforms;
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
        uniforms: { ...this.skyUniforms },
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
          varying vec3 vDirection;
          void main() {
            vec3 direction = normalize(vDirection);
            float up = direction.y;
            vec3 sky = mix(horizon, zenith, pow(max(up, 0.0), 0.5));
            sky = mix(sky, groundHaze, clamp(-up * 6.0, 0.0, 1.0));
            float toSun = max(dot(direction, sunDirection), 0.0);
            sky += sunColor * (pow(toSun, 900.0) * 3.0 + pow(toSun, 24.0) * (0.18 + 0.4 * sunLow));
            // A low sun sets the sky along the horizon aglow on its side.
            vec2 bearing = normalize(direction.xz + vec2(1e-5));
            vec2 sunBearing = normalize(sunDirection.xz + vec2(1e-5));
            float sunSide = max(dot(bearing, sunBearing), 0.0);
            sky += sunColor * sunLow * sunSide * sunSide * pow(1.0 - clamp(up, 0.0, 1.0), 5.0) * 0.6;
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
    const hazeColor = this.skyUniforms.horizon;
    material.onBeforeCompile = (shader) => {
      shader.uniforms['hazeColor'] = hazeColor;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float haze;\nvarying float vHaze;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHaze = haze;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 hazeColor;\nvarying float vHaze;')
        .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, hazeColor, vHaze);');
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
      // Even over the sky above the horizon: a uniform height on a sphere covers equal areas.
      const height = random.range(0.03, 1);
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
          float haze = clamp(normalize(position).y * 5.0, 0.0, 1.0);
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
   * Puts the sun's light up its rays: from the middle of the map without
   * shadows; with them, from the shadows' focus snapped to the map's texels
   * (across the rays; along them it makes no difference).
   */
  private placeSun(): void {
    const sun = this.skyUniforms.sunDirection.value;
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

  /** Shows Math.round(`cover` × CLOUD_COUNT) clouds: no draw call for none. */
  private showClouds(cover: number): void {
    const count = Math.round(CLOUD_COUNT * Math.min(1, Math.max(0, cover)));
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
          varying vec2 vCorner;
          varying vec2 vUv;
          varying vec3 vPosition;
          varying vec3 vCloud;
          varying vec4 vCentre;
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

  private track<T extends { dispose(): void }>(resource: T): T {
    this.resources.push(resource);
    return resource;
  }
}

function mix(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}
