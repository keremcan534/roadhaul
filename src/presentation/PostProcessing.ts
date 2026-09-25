import {
  AdditiveBlending,
  HalfFloatType,
  LinearFilter,
  Mesh,
  NoBlending,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type PerspectiveCamera,
  type Texture,
  type Vector3,
  type WebGLRenderer,
} from 'three';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

export interface PostProcessingSettings {
  /** Bright lights (lamps, headlights, the low sun) bloom into a soft glow. */
  readonly bloom: boolean;
  /**
   * Multisampling of the scene (4 is smooth), up to what the GPU can do for
   * a half-float target; 0 smooths the edges of the finished picture instead
   * (FXAA, one more pass), unless `smoothing` is false.
   */
  readonly msaaSamples: number;
  /** Without multisampling, smooth the edges with FXAA. Default: true. */
  readonly smoothing?: boolean;
}

/**
 * How the colour pass grades the picture. The weather sets it
 * (EnvironmentView.grade): exposure, colour saturation and contrast (1 as
 * drawn), warmth (−1 cool … 1 warm), how strongly bright lights bloom (0..1)
 * and how dark the corners are (0..1).
 */
export interface ColorGrade {
  exposure: number;
  saturation: number;
  contrast: number;
  warmth: number;
  bloom: number;
  vignette: number;
}

/** An ungraded picture: as drawn, the day's exposure, a light vignette. */
export function createColorGrade(): ColorGrade {
  return { exposure: 1.05, saturation: 1, contrast: 1, warmth: 0, bloom: 0.25, vignette: 0.3 };
}

/** Bloom's levels: half the picture's size, then halving, never under a pixel. */
export const BLOOM_LEVELS = 5;
/** Light above this (linear, after exposure) blooms; the knee eases it in. */
const BLOOM_THRESHOLD = 1;
const BLOOM_KNEE = 0.5;
/** How bright the glow gets at the grade's full bloom. */
const BLOOM_STRENGTH = 0.22;

/** The sizes of bloom's chain of targets for a picture of `width` × `height` pixels: half, quarter, … */
export function bloomLevelSizes(width: number, height: number, levels = BLOOM_LEVELS): [number, number][] {
  const sizes: [number, number][] = [];
  let w = width;
  let h = height;
  for (let level = 0; level < levels; level++) {
    w = Math.max(1, Math.round(w / 2));
    h = Math.max(1, Math.round(h / 2));
    sizes.push([w, h]);
  }
  return sizes;
}

/**
 * The multisampling to ask for: `requested`, down to the most the GPU
 * offers for a half-float target (`supported`, as WebGL lists them, most
 * first); 0 without any.
 */
export function multisampling(requested: number, supported: ArrayLike<number>): number {
  let best = 0;
  for (let i = 0; i < supported.length; i++) {
    const samples = supported[i]!;
    if (samples <= requested && samples > best) {
      best = samples;
    }
  }
  return best;
}

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/**
 * The renderer's last steps (roadmap: graphics), for the medium and high
 * presets. The scene draws into a half-float target, so lights keep their
 * brightness past white (multisampled on high); bright light is picked out,
 * blurred down a chain of halving targets and back up (a dual filter: a few
 * cheap passes at small sizes), and one colour pass adds that bloom, maps
 * the tones (ACES filmic, as the renderer's own), grades the colour by the
 * weather (saturation, contrast, warmth), darkens the corners a little and
 * dithers the result, so the sky's gradients do not band. Without
 * multisampling, a last pass smooths the edges of the finished picture
 * (FXAA). Every pass draws one full-screen quad; nothing is allocated per
 * frame.
 */
export class PostProcessing {
  private readonly sceneTarget: WebGLRenderTarget;
  /** The finished picture, before FXAA smooths it onto the screen; null with multisampling. */
  private readonly pictureTarget: WebGLRenderTarget | null;
  private readonly bloomTargets: WebGLRenderTarget[] = [];
  private readonly quadScene = new Scene();
  private readonly quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: Mesh;
  private readonly prefilter: ShaderMaterial;
  private readonly downsample: ShaderMaterial;
  private readonly upsample: ShaderMaterial;
  private readonly composite: ShaderMaterial;
  private readonly fxaa: ShaderMaterial | null;
  private readonly bloom: boolean;
  private width = 1;
  private height = 1;

  /** Whether the device can draw into half-float targets (WebGL 2 with a float colour buffer). */
  static supported(renderer: WebGLRenderer): boolean {
    return renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
  }

  constructor(
    private readonly renderer: WebGLRenderer,
    settings: PostProcessingSettings,
  ) {
    this.bloom = settings.bloom;
    const samples = settings.msaaSamples > 0 ? multisampling(settings.msaaSamples, halfFloatSamples(renderer)) : 0;
    this.sceneTarget = new WebGLRenderTarget(1, 1, {
      type: HalfFloatType,
      samples,
      depthBuffer: true,
      stencilBuffer: false,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      generateMipmaps: false,
    });
    if (this.bloom) {
      for (let level = 0; level < BLOOM_LEVELS; level++) {
        this.bloomTargets.push(
          new WebGLRenderTarget(1, 1, {
            type: HalfFloatType,
            depthBuffer: false,
            stencilBuffer: false,
            minFilter: LinearFilter,
            magFilter: LinearFilter,
            generateMipmaps: false,
          }),
        );
      }
    }
    this.pictureTarget =
      samples > 0 || settings.smoothing === false
        ? null
        : new WebGLRenderTarget(1, 1, {
            type: UnsignedByteType,
            depthBuffer: false,
            stencilBuffer: false,
            minFilter: LinearFilter,
            magFilter: LinearFilter,
            generateMipmaps: false,
          });
    this.prefilter = pass(
      { tSource: { value: null }, texel: { value: new Vector2() }, threshold: { value: BLOOM_THRESHOLD }, knee: { value: BLOOM_KNEE } },
      /* glsl */ `
        uniform sampler2D tSource;
        uniform vec2 texel;
        uniform float threshold;
        uniform float knee;
        varying vec2 vUv;
        vec3 bright(vec3 color) {
          // Soft-kneed threshold on the brightest channel; single hot pixels are capped so they do not flicker.
          color = min(color, vec3(32.0));
          float brightness = max(color.r, max(color.g, color.b));
          float soft = clamp(brightness - threshold + knee, 0.0, 2.0 * knee);
          soft = soft * soft / (4.0 * knee + 1e-4);
          return color * max(soft, brightness - threshold) / max(brightness, 1e-4);
        }
        void main() {
          vec3 sum = bright(texture2D(tSource, vUv + texel * vec2(-1.0, -1.0)).rgb);
          sum += bright(texture2D(tSource, vUv + texel * vec2(1.0, -1.0)).rgb);
          sum += bright(texture2D(tSource, vUv + texel * vec2(-1.0, 1.0)).rgb);
          sum += bright(texture2D(tSource, vUv + texel * vec2(1.0, 1.0)).rgb);
          gl_FragColor = vec4(sum * 0.25, 1.0);
        }
      `,
    );
    this.downsample = pass(
      { tSource: { value: null }, texel: { value: new Vector2() } },
      /* glsl */ `
        uniform sampler2D tSource;
        uniform vec2 texel;
        varying vec2 vUv;
        void main() {
          vec3 sum = texture2D(tSource, vUv).rgb * 4.0;
          sum += texture2D(tSource, vUv - texel).rgb;
          sum += texture2D(tSource, vUv + texel).rgb;
          sum += texture2D(tSource, vUv + vec2(texel.x, -texel.y)).rgb;
          sum += texture2D(tSource, vUv - vec2(texel.x, -texel.y)).rgb;
          gl_FragColor = vec4(sum * 0.125, 1.0);
        }
      `,
    );
    this.upsample = pass(
      { tSource: { value: null }, texel: { value: new Vector2() } },
      /* glsl */ `
        uniform sampler2D tSource;
        uniform vec2 texel;
        varying vec2 vUv;
        void main() {
          vec3 sum = texture2D(tSource, vUv + vec2(-2.0 * texel.x, 0.0)).rgb;
          sum += texture2D(tSource, vUv + vec2(-texel.x, texel.y)).rgb * 2.0;
          sum += texture2D(tSource, vUv + vec2(0.0, 2.0 * texel.y)).rgb;
          sum += texture2D(tSource, vUv + vec2(texel.x, texel.y)).rgb * 2.0;
          sum += texture2D(tSource, vUv + vec2(2.0 * texel.x, 0.0)).rgb;
          sum += texture2D(tSource, vUv + vec2(texel.x, -texel.y)).rgb * 2.0;
          sum += texture2D(tSource, vUv + vec2(0.0, -2.0 * texel.y)).rgb;
          sum += texture2D(tSource, vUv + vec2(-texel.x, -texel.y)).rgb * 2.0;
          gl_FragColor = vec4(sum / 12.0, 1.0);
        }
      `,
    );
    // Added onto the bigger level, which holds its own downsampled light.
    this.upsample.blending = AdditiveBlending;
    this.composite = pass(
      {
        tScene: { value: this.sceneTarget.texture },
        tBloom: { value: this.bloom ? this.bloomTargets[0]!.texture : null },
        // The most blurred level: how much bright light there is round a spot of the picture.
        tGlare: { value: this.bloom ? this.bloomTargets[BLOOM_LEVELS - 1]!.texture : null },
        sunScreen: { value: new Vector2(-10, -10) },
        sunFlare: { value: 0 },
        aspect: { value: 1 },
        bloomStrength: { value: 0 },
        exposure: { value: 1 },
        saturation: { value: 1 },
        contrast: { value: 1 },
        warmth: { value: 0 },
        vignette: { value: 0 },
      },
      COMPOSITE_FRAGMENT,
      this.bloom ? { BLOOM: '' } : {},
    );
    this.fxaa =
      this.pictureTarget === null
        ? null
        : pass(
            { tDiffuse: { value: this.pictureTarget.texture }, resolution: { value: new Vector2() } },
            FXAA_FRAGMENT,
          );
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.composite);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    this.setGrade(createColorGrade());
  }

  /** Multisampling of the scene: 0 when FXAA smooths the edges instead, or nothing does. */
  get samples(): number {
    return this.sceneTarget.samples;
  }

  /** Whether FXAA smooths the finished picture's edges. */
  get fxaaSmoothing(): boolean {
    return this.fxaa !== null;
  }

  /** Sizes the targets to the drawing buffer, `width` × `height` pixels. Not per frame. */
  setSize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (w === this.width && h === this.height) {
      return;
    }
    this.width = w;
    this.height = h;
    this.sceneTarget.setSize(w, h);
    this.pictureTarget?.setSize(w, h);
    this.composite.uniforms['aspect']!.value = w / h;
    if (this.fxaa !== null) {
      (this.fxaa.uniforms['resolution']!.value as Vector2).set(1 / w, 1 / h);
    }
    bloomLevelSizes(w, h).forEach(([levelWidth, levelHeight], level) => this.bloomTargets[level]?.setSize(levelWidth, levelHeight));
  }

  /** The grade from now on. Cheap: it writes a few uniforms. */
  setGrade(grade: Readonly<ColorGrade>): void {
    const uniforms = this.composite.uniforms;
    uniforms['exposure']!.value = grade.exposure;
    uniforms['saturation']!.value = grade.saturation;
    uniforms['contrast']!.value = grade.contrast;
    uniforms['warmth']!.value = grade.warmth;
    uniforms['vignette']!.value = grade.vignette;
    uniforms['bloomStrength']!.value = grade.bloom * BLOOM_STRENGTH;
  }

  /**
   * Where the sun is on the picture (0..1 across and up, outside when it
   * is off it) and how strongly it may glare (0..1: the day's sunlight, a
   * clear sky). Where it shows, a soft glare spreads round it and faint
   * ghosts of the lens lie across the picture from it; behind a wall, a
   * tree or the cab's roof it shows no more, and neither do they (the
   * bloom there tells). Only with bloom. Cheap: it writes three uniforms.
   */
  setSun(screenX: number, screenY: number, strength: number): void {
    const uniforms = this.composite.uniforms;
    (uniforms['sunScreen']!.value as Vector2).set(screenX, screenY);
    uniforms['sunFlare']!.value = this.bloom ? Math.max(0, Math.min(1, strength)) : 0;
  }

  /**
   * Compiles the shaders of everything in `scene` as the pass draws it (into
   * its linear target, without tone mapping), so render() finds them ready.
   * Not per frame.
   */
  compile(scene: Scene, camera: Camera): void {
    const previous = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.sceneTarget);
    this.renderer.compile(scene, camera);
    this.renderer.setRenderTarget(previous);
  }

  /** Draws `scene` from `camera` through the passes onto the screen. Allocation-free. */
  render(scene: Scene, camera: Camera): void {
    const renderer = this.renderer;
    renderer.setRenderTarget(this.sceneTarget);
    renderer.render(scene, camera);
    const autoClear = renderer.autoClear;
    // Every pass covers its whole target: nothing to clear, and the upsampling adds onto what is there.
    renderer.autoClear = false;
    if (this.bloom) {
      const targets = this.bloomTargets;
      this.draw(this.prefilter, this.sceneTarget.texture, this.sceneTarget, targets[0]!);
      for (let level = 1; level < targets.length; level++) {
        this.draw(this.downsample, targets[level - 1]!.texture, targets[level - 1]!, targets[level]!);
      }
      for (let level = targets.length - 1; level > 0; level--) {
        this.draw(this.upsample, targets[level]!.texture, targets[level]!, targets[level - 1]!);
      }
    }
    this.quad.material = this.composite;
    renderer.setRenderTarget(this.pictureTarget);
    renderer.render(this.quadScene, this.quadCamera);
    if (this.fxaa !== null) {
      this.quad.material = this.fxaa;
      renderer.setRenderTarget(null);
      renderer.render(this.quadScene, this.quadCamera);
    }
    renderer.autoClear = autoClear;
  }

  dispose(): void {
    this.sceneTarget.dispose();
    this.pictureTarget?.dispose();
    for (const target of this.bloomTargets) {
      target.dispose();
    }
    this.quad.geometry.dispose();
    for (const material of [this.prefilter, this.downsample, this.upsample, this.composite, this.fxaa]) {
      material?.dispose();
    }
  }

  /** One pass: `material` reads `source` (the texture of `sourceTarget`, for its size) and draws into `target`. */
  private draw(material: ShaderMaterial, source: Texture, sourceTarget: WebGLRenderTarget, target: WebGLRenderTarget): void {
    material.uniforms['tSource']!.value = source;
    (material.uniforms['texel']!.value as Vector2).set(1 / sourceTarget.width, 1 / sourceTarget.height);
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCamera);
  }
}

/** The sample counts the GPU can multisample a half-float colour buffer with, most first (none on WebGL 1). */
function halfFloatSamples(renderer: WebGLRenderer): ArrayLike<number> {
  const gl = renderer.getContext();
  if (!('RGBA16F' in gl)) {
    return [];
  }
  const samples: unknown = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA16F, gl.SAMPLES);
  return samples instanceof Int32Array ? samples : [];
}

/**
 * Where a sun toward `direction` (unit: it is that far off) lies on the
 * picture `camera` takes (its matrices up to date): written into `out` as
 * 0..1 across and up, beyond them off the picture. False, and `out` left
 * as it may be, when the sun is behind the camera or square to it.
 */
export function sunOnPicture(camera: PerspectiveCamera, direction: Readonly<{ x: number; y: number; z: number }>, out: Vector3): boolean {
  const toward = out.set(direction.x, direction.y, direction.z).transformDirection(camera.matrixWorldInverse);
  if (toward.z > -0.05) {
    return false;
  }
  out.set(direction.x, direction.y, direction.z).multiplyScalar(100).add(camera.position).project(camera);
  out.set((out.x + 1) / 2, (out.y + 1) / 2, 0);
  return true;
}

/**
 * three.js's FXAA (Catlike Coding's, after NVIDIA's), blending lone pixels
 * into their neighbours at half its strength: stars and far lamps, a pixel
 * or two across, keep their sparkle.
 */
export const FXAA_FRAGMENT = FXAAShader.fragmentShader.replace(
  'float _SubpixelBlending = 1.0;',
  'float _SubpixelBlending = 0.5;',
);

/**
 * A full-screen pass's material: no depth, no blending unless set, and its
 * colours as they come: no tone mapping (the colour pass does its own) and
 * no conversion to the screen's colour space (the colour pass encodes it).
 */
function pass(
  uniforms: Record<string, { value: unknown }>,
  fragmentShader: string,
  defines: Record<string, string> = {},
): ShaderMaterial {
  return new ShaderMaterial({
    uniforms,
    defines,
    vertexShader: VERTEX,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
    toneMapped: false,
  });
}

/**
 * The colour pass. ACES filmic is three.js's own (tonemapping_pars_fragment),
 * so the picture matches the renderer's where there is no colour pass. It
 * writes sRGB, for the screen or for FXAA, which works on the colours as the
 * eye sees them.
 */
export const COMPOSITE_FRAGMENT = /* glsl */ `
  uniform sampler2D tScene;
  uniform sampler2D tBloom;
  uniform sampler2D tGlare;
  uniform vec2 sunScreen;
  uniform float sunFlare;
  uniform float aspect;
  uniform float bloomStrength;
  uniform float exposure;
  uniform float saturation;
  uniform float contrast;
  uniform float warmth;
  uniform float vignette;
  varying vec2 vUv;

  vec3 RRTAndODTFit(vec3 v) {
    vec3 a = v * (v + 0.0245786) - 0.000090537;
    vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / b;
  }
  vec3 acesFilmic(vec3 color) {
    const mat3 inputMatrix = mat3(
      vec3(0.59719, 0.07600, 0.02840),
      vec3(0.35458, 0.90834, 0.13383),
      vec3(0.04823, 0.01566, 0.83777)
    );
    const mat3 outputMatrix = mat3(
      vec3(1.60475, -0.10208, -0.00327),
      vec3(-0.53108, 1.10813, -0.07276),
      vec3(-0.07367, -0.00605, 1.07602)
    );
    color = inputMatrix * (color / 0.6);
    color = RRTAndODTFit(color);
    return clamp(outputMatrix * color, 0.0, 1.0);
  }

  #ifdef BLOOM
  /** A soft disc of the lens's ghosts: \`radius\` across (the picture's height 1), brightest in the middle. */
  float ghost(vec2 uv, vec2 at, float radius) {
    float d = length((uv - at) * vec2(aspect, 1.0));
    return 1.0 - smoothstep(radius * 0.35, radius, d);
  }

  /**
   * The sun's glare and the lens's ghosts at \`uv\`: a wide soft glow round the sun and faint spokes, and ghosts
   * along the line from it through the middle of the picture, each its own tint. As much as the sun shows:
   * the bright light round it (tGlare), none when something hides it; fading as it leaves the picture.
   */
  vec3 sunGlare(vec2 uv) {
    vec2 outside = max(max(-sunScreen, sunScreen - 1.0), 0.0);
    float onPicture = 1.0 - smoothstep(0.0, 0.12, max(outside.x, outside.y));
    float shows = smoothstep(0.08, 0.7, dot(texture2D(tGlare, clamp(sunScreen, 0.0, 1.0)).rgb, vec3(0.3333)));
    float strength = sunFlare * onPicture * shows;
    if (strength <= 0.0) {
      return vec3(0.0);
    }
    vec2 fromSun = (uv - sunScreen) * vec2(aspect, 1.0);
    float d = length(fromSun);
    vec3 warm = vec3(1.0, 0.86, 0.66);
    float spokes = pow(abs(cos(atan(fromSun.y, fromSun.x) * 3.0)), 60.0) * exp(-d * 9.0);
    vec3 light = warm * (exp(-d * 5.0) * 0.28 + spokes * 0.35);
    vec2 across = vec2(0.5) - sunScreen;
    light += vec3(1.0, 0.72, 0.38) * ghost(uv, sunScreen + across * 0.55, 0.035) * 0.075;
    light += vec3(0.5, 0.9, 0.62) * ghost(uv, sunScreen + across * 1.25, 0.07) * 0.045;
    light += vec3(0.62, 0.66, 1.0) * ghost(uv, sunScreen + across * 1.6, 0.11) * 0.04;
    light += vec3(1.0, 0.56, 0.76) * ghost(uv, sunScreen + across * 2.1, 0.05) * 0.06;
    return light * strength;
  }
  #endif

  void main() {
    vec3 color = texture2D(tScene, vUv).rgb;
    #ifdef BLOOM
    color += texture2D(tBloom, vUv).rgb * bloomStrength;
    color += sunGlare(vUv);
    #endif
    color = acesFilmic(color * exposure);
    // White balance: warm lifts the reds and lowers the blues, cool the other way.
    color *= vec3(1.0 + 0.07 * warmth, 1.0 + 0.012 * warmth, 1.0 - 0.09 * warmth);
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = max(mix(vec3(luma), color, saturation), 0.0);
    vec2 fromCentre = vUv - 0.5;
    color *= clamp(1.0 - dot(fromCentre, fromCentre) * vignette * 1.4, 0.0, 1.0);
    // Contrast as an S-curve over what the eye sees (the sRGB curve): black stays black and white white, so a
    // night keeps what little it shows.
    vec3 display = sRGBTransferOETF(vec4(color, 1.0)).rgb;
    display = mix(display, display * display * (3.0 - 2.0 * display), contrast - 1.0);
    // Half a step of noise, different on every pixel: smooth gradients (the sky at night) do not band.
    float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    display += (noise - 0.5) / 255.0;
    gl_FragColor = vec4(clamp(display, 0.0, 1.0), 1.0);
  }
`;
