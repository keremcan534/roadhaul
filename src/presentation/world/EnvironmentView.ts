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
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SeededRandom } from '../../core/random/SeededRandom';
import type { WeatherLook } from '../../data/definitions/WeatherDefinition';
import { moonImage } from '../textures/proceduralImages';
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
const DOME_RADIUS = 800;
const HILL_RADIUS = 640;
/** Clouds in a fully overcast sky; the weather shows a share of them. */
const CLOUD_COUNT = 48;
const CLOUD_COLOR = 0xf6f8fb;
const CLOUD_EMISSIVE = 0x6d7a88;
/** How far the clouds' shaded sides take the horizon's glow with the sun down on it (at the look's sunHeight 0). */
const CLOUD_GLOW = 0.7;
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
const Z_AXIS = new Vector3(0, 0, 1);

/** The sky as other shaders see it (the sea mirrors it): its colours and the sun, kept up to date by applyWeather(). */
export interface SkyUniforms {
  readonly zenith: { readonly value: Color };
  readonly horizon: { readonly value: Color };
  readonly sunColor: { readonly value: Color };
  readonly sunDirection: { readonly value: Vector3 };
}

/**
 * Sky, horizon and light: a gradient dome with a sun glow, low-poly clouds,
 * a ring of hazy hills, fog, and the sun and sky lights; at night the stars
 * and the moon. The dome, clouds, hills, stars and moon follow the camera
 * (call update() every frame), so they always sit at the horizon. About
 * three draw calls, two more at night. applyWeather() turns it all to the
 * weather and the time of day (spec §38–39): sky, haze, light, the sun's
 * height, clouds, stars and moon, and the pre-lit ground with it.
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
  private readonly clouds: InstancedMesh;
  private readonly cloudMaterial: MeshLambertMaterial;
  private readonly stars: Mesh;
  private readonly starUniforms = { time: { value: 0 }, level: { value: 0 } };
  private readonly moon: Mesh;
  private readonly moonMaterial: MeshBasicMaterial;
  private readonly toMoon = new Vector3();
  private readonly resources: { dispose(): void }[] = [];
  /** Scratch colours for blending looks, and what was last applied (so an unchanged look costs nothing). */
  private readonly tint = new Color();
  private readonly scratch = new Color();
  private readonly groundLight = new Color();
  private appliedFrom: WeatherLook | null = null;
  private appliedTo: WeatherLook | null = null;
  private appliedBlend = Number.NaN;

  constructor(private readonly scene: Scene) {
    this.background = new Color(HORIZON);
    scene.background = this.background;
    this.fog = new FogExp2(HORIZON, FOG_DENSITY);
    scene.fog = this.fog;

    this.sunLight = new DirectionalLight(SUN_COLOR, SUN_INTENSITY);
    this.sunLight.position.set(SUN_DIRECTION.x * 300, SUN_DIRECTION.y * 300, SUN_DIRECTION.z * 300);
    this.skyLight = new HemisphereLight(SKY_LIGHT_COLOR, GROUND_LIGHT_COLOR, SKY_LIGHT_INTENSITY);
    this.lights = [this.skyLight, this.sunLight];
    scene.add(...this.lights);

    this.skyUniforms = {
      zenith: { value: new Color(ZENITH) },
      horizon: { value: new Color(HORIZON) },
      groundHaze: { value: new Color(GROUND_HAZE) },
      sunColor: { value: new Color(SUN_COLOR) },
      sunDirection: { value: new Vector3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z) },
      sunLow: { value: 0 },
    };
    this.cloudMaterial = this.track(
      new MeshLambertMaterial({ color: CLOUD_COLOR, emissive: CLOUD_EMISSIVE, flatShading: true, fog: false }),
    );
    this.clouds = this.createClouds();
    this.clouds.count = Math.round(CLOUD_COUNT * 0.55);
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
    // Over the stars, under everything else see-through; hidden (no draw call) by day.
    this.moon.renderOrder = -1;
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
    this.sunLight.position.copy(sun).multiplyScalar(300);
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
    this.fog.density = mix(from.fogDensity, to.fogDensity, blend);

    this.skyLight.intensity = SKY_LIGHT_INTENSITY * skylight;
    this.skyLight.color.setHex(SKY_LIGHT_COLOR).multiply(this.tint);
    this.sunLight.intensity = SUN_INTENSITY * sunlight;
    this.sunLight.color.setHex(SUN_COLOR).multiply(this.tint);

    const brightness = mix(from.cloudBrightness, to.cloudBrightness, blend);
    this.cloudMaterial.color.setHex(CLOUD_COLOR).multiplyScalar(brightness);
    // A low sun lights the clouds from below: their shaded sides glow with the horizon.
    this.cloudMaterial.emissive
      .setHex(CLOUD_EMISSIVE)
      .lerp(uniforms.horizon.value, uniforms.sunLow.value * CLOUD_GLOW)
      .multiplyScalar(brightness);
    this.clouds.count = Math.round(CLOUD_COUNT * mix(from.cloudCover, to.cloudCover, blend));

    prelit?.setLight(relativeGroundLight(groundSun, skylight, this.tint, this.groundLight), groundSun);
  }

  /** The sky's colours and the sun as shader uniforms: share them, and they follow the weather. */
  get sky(): SkyUniforms {
    return this.skyUniforms;
  }

  /** Keeps the backdrop centred on the camera, and twinkles the stars `deltaSeconds` on. Allocation-free. */
  update(cameraPosition: Readonly<{ x: number; z: number }>, deltaSeconds = 0): void {
    this.backdrop.position.set(cameraPosition.x, 0, cameraPosition.z);
    const time = this.starUniforms.time;
    time.value = (time.value + deltaSeconds) % TWINKLE_PERIOD_SECONDS;
  }

  dispose(): void {
    this.scene.remove(this.backdrop, ...this.lights);
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

  /** A ring of low-poly hills, coloured toward the haze with height so they read as far away. */
  private createHills(): Mesh {
    const random = new SeededRandom(7);
    const segments = 120;
    const rows = 3;
    const heights: number[] = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      heights.push(40 + 34 * Math.sin(a * 3 + 1.3) + 22 * Math.sin(a * 7 + 0.4) + random.range(0, 26));
    }
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const near = new Color(0x5e7d57);
    const far = new Color(HORIZON);
    const scratch = new Color();
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const peak = heights[i % segments]!;
      for (let row = 0; row <= rows; row++) {
        const t = row / rows; // 0 = foot, 1 = ridge.
        const radius = HILL_RADIUS + 60 * t;
        const height = t === 0 ? -8 : peak * Math.sin((t * Math.PI) / 2) * (row === rows ? 0.92 : 1);
        positions.push(Math.cos(a) * radius, height, Math.sin(a) * radius);
        scratch.copy(near).lerp(far, 0.35 + 0.3 * t);
        colors.push(scratch.r, scratch.g, scratch.b);
      }
    }
    for (let i = 0; i < segments; i++) {
      for (let row = 0; row < rows; row++) {
        const a = i * (rows + 1) + row;
        const b = (i + 1) * (rows + 1) + row;
        // Wound so the faces point inward, toward the camera at the centre.
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const hills = new Mesh(
      this.track(geometry),
      this.track(new MeshLambertMaterial({ vertexColors: true, flatShading: true, fog: false })),
    );
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
    stars.renderOrder = -2;
    stars.frustumCulled = false;
    stars.visible = false;
    return stars;
  }

  /** Flat-bottomed clusters of puffs, scattered around the sky. */
  private createClouds(): InstancedMesh {
    const random = new SeededRandom(19);
    const puffs = [
      [0, 0, 0, 1],
      [1.3, -0.2, 0.3, 0.8],
      [-1.2, -0.25, -0.2, 0.75],
      [0.5, 0.35, -0.6, 0.7],
      [-0.4, 0.2, 0.7, 0.65],
    ].map(([x, y, z, r]) => new IcosahedronGeometry(r!, 1).translate(x!, y!, z!));
    const cloud = mergeGeometries(puffs);
    for (const puff of puffs) {
      puff.dispose();
    }
    // Squash the underside flat, like cumulus.
    const position = cloud.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      position.setY(i, Math.max(position.getY(i), -0.35));
    }
    cloud.computeVertexNormals();
    const clouds = this.track(new InstancedMesh(this.track(cloud), this.cloudMaterial, CLOUD_COUNT));
    const matrix = new Matrix4();
    const where = new Vector3();
    const rotation = new Quaternion();
    const size = new Vector3();
    const up = new Vector3(0, 1, 0);
    for (let i = 0; i < CLOUD_COUNT; i++) {
      const angle = random.range(0, Math.PI * 2);
      const distance = random.range(380, 700);
      where.set(Math.cos(angle) * distance, random.range(150, 260), Math.sin(angle) * distance);
      rotation.setFromAxisAngle(up, random.range(0, Math.PI * 2));
      const scale = random.range(18, 38);
      size.set(scale * random.range(1.1, 1.8), scale * random.range(0.55, 0.8), scale);
      clouds.setMatrixAt(i, matrix.compose(where, rotation, size));
    }
    clouds.instanceMatrix.needsUpdate = true;
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
