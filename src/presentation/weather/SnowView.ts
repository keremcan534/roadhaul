import { BufferAttribute, BufferGeometry, Color, Mesh, ShaderMaterial, Vector2, type Scene } from 'three';
import { SeededRandom } from '../../core/random/SeededRandom';
import { LAMP_SCATTER_GLSL, type LampLighting } from '../world/LampLighting';

/** Flakes in the heaviest snow; lighter snow draws a share of them. */
const MAX_FLAKES = 2600;
/** The flakes fill a box this wide around the camera, from the ground up to this height. */
const BOX_WIDTH_METERS = 40;
const BOX_HEIGHT_METERS = 16;
/** How fast the flakes fall and how the wind carries them, m/s; how far each one sways from side to side, meters. */
const FALL_SPEED = 1.3;
const WIND_X = 0.9;
const WIND_Z = 0.4;
const SWAY_METERS = 0.35;
/** A flake is this big across, meters, as seen (never under a pixel and a half on screen). */
const FLAKE_METERS = 0.045;
const MIN_FLAKE_PIXELS = 1.5;
const COLOR = 0xf4f7fb;
const OPACITY = 0.9;
/** At night a flake sends this share of the lamps' light on it to the eye (LampLighting), and no brighter than this. */
const LAMP_SCATTERING = 0.02;
const MOST_LAMPLIGHT = 2;
const SEED = 83;
/** No flake is drawn nearer the eye than this (meters along its view) by default; they fade in over the next two. */
const CLEARANCE_METERS = 0.6;
const FADE_METERS = 2;
/**
 * The flakes' clock runs round this many seconds, so it keeps its precision:
 * a whole number of both sways (1.1 and 0.9 radians a second), so none jumps.
 */
const SWAY_PERIOD_SECONDS = 200 * Math.PI;

/**
 * Snow (winter's weather): soft flakes drifting down around the camera,
 * swaying as they fall and carried by the wind. One draw call, animated
 * on the GPU like RainView: the CPU sets a few uniforms a frame, and the
 * geometry is built once. The flakes keep their places in the world while
 * the camera moves through them, and wrap round a box that follows it,
 * fading out at its edge and close to the eye. Heavier snow draws more of
 * them. At night, given the lamps, the flakes in their light glitter: the
 * headlights' beams fill with them.
 */
export class SnowView {
  private readonly geometry = new BufferGeometry();
  private readonly material: ShaderMaterial;
  private readonly mesh: Mesh;
  private readonly uniforms: {
    readonly fall: { value: number };
    readonly drift: { value: Vector2 };
    readonly center: { value: Vector2 };
    readonly swayTime: { value: number };
    readonly resolution: { value: Vector2 };
    readonly color: { value: Color };
    readonly opacity: { value: number };
    readonly clearance: { value: number };
  };
  private fall = 0;
  private driftX = 0;
  private driftZ = 0;
  private swayTime = 0;
  /** The heaviest snow draws `density` (0..1) of MAX_FLAKES: fewer on weaker devices. */
  private readonly maxFlakes: number;

  constructor(
    private readonly scene: Scene,
    density = 1,
    lamps: LampLighting['uniforms'] | null = null,
  ) {
    this.maxFlakes = Math.round(MAX_FLAKES * Math.min(1, Math.max(0, density)));
    // Four corners per flake. `position` holds the flake's random place in the box (0..1 on each axis), the same
    // at all four corners; `corner` says which corner (-1 or 1 each way).
    const random = new SeededRandom(SEED);
    const flakes = Math.max(1, this.maxFlakes);
    const seeds = new Float32Array(flakes * 4 * 3);
    const corners = new Float32Array(flakes * 4 * 2);
    const indices = new Uint16Array(flakes * 6);
    for (let flake = 0; flake < flakes; flake++) {
      const x = random.next();
      const y = random.next();
      const z = random.next();
      for (let corner = 0; corner < 4; corner++) {
        const vertex = flake * 4 + corner;
        seeds.set([x, y, z], vertex * 3);
        corners.set([(corner & 1) * 2 - 1, (corner >> 1) * 2 - 1], vertex * 2);
      }
      const first = flake * 4;
      indices.set([first, first + 1, first + 2, first + 2, first + 1, first + 3], flake * 6);
    }
    this.geometry.setAttribute('position', new BufferAttribute(seeds, 3));
    this.geometry.setAttribute('corner', new BufferAttribute(corners, 2));
    this.geometry.setIndex(new BufferAttribute(indices, 1));
    this.geometry.setDrawRange(0, 0);
    this.uniforms = {
      fall: { value: 0 },
      drift: { value: new Vector2() },
      center: { value: new Vector2() },
      swayTime: { value: 0 },
      resolution: { value: new Vector2(1, 1) },
      color: { value: new Color(COLOR) },
      opacity: { value: OPACITY },
      clearance: { value: CLEARANCE_METERS },
    };
    this.material = new ShaderMaterial({
      uniforms: { ...this.uniforms, ...lamps },
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        ${lamps === null ? '' : `#define SNOW_LAMPS\n#include <common>\n${LAMP_SCATTER_GLSL}`}
        #define BOX_WIDTH ${BOX_WIDTH_METERS.toFixed(1)}
        #define BOX_HEIGHT ${BOX_HEIGHT_METERS.toFixed(1)}
        uniform float fall;
        uniform vec2 drift;
        uniform vec2 center;
        uniform float swayTime;
        uniform vec2 resolution;
        uniform float clearance;
        attribute vec2 corner;
        varying float vAlpha;
        varying vec2 vCorner;
        varying vec3 vLamp;
        void main() {
          // The flake's place: carried by the wind, wrapped into the box round the camera, falling and wrapping to
          // the top, and swaying from side to side at its own pace as it falls.
          vec2 around = mod(position.xz * BOX_WIDTH + drift - center + BOX_WIDTH * 0.5, BOX_WIDTH) - BOX_WIDTH * 0.5;
          float phase = position.x * 71.0 + position.z * 37.0;
          vec2 sway = vec2(sin(swayTime * 1.1 + phase), cos(swayTime * 0.9 + phase * 1.3)) * ${SWAY_METERS.toFixed(2)};
          vec3 flake = vec3(center.x + around.x + sway.x, fract(position.y - fall) * BOX_HEIGHT, center.y + around.y + sway.y);
          vec4 view = viewMatrix * vec4(flake, 1.0);
          float depth = -view.z;
          if (depth < clearance) {
            // Behind the camera or at the eye: nothing to draw.
            gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
            vAlpha = 0.0;
            vCorner = vec2(0.0);
            vLamp = vec3(0.0);
            return;
          }
          #ifdef SNOW_LAMPS
            vec3 lamp = lampScatter(view.xyz) * ${LAMP_SCATTERING.toFixed(4)};
            vLamp = lamp / (1.0 + max(lamp.r, max(lamp.g, lamp.b)) / ${MOST_LAMPLIGHT.toFixed(1)});
          #else
            vLamp = vec3(0.0);
          #endif
          // A little bigger or smaller, flake by flake; never under a pixel and a half on screen (fainter instead).
          float size = ${FLAKE_METERS.toFixed(3)} * (0.6 + 0.8 * fract(phase));
          float pixels = size * projectionMatrix[1][1] * resolution.y * 0.5 / depth;
          float grow = max(1.0, ${MIN_FLAKE_PIXELS.toFixed(1)} / max(pixels, 1e-4));
          view.xy += corner * size * grow * 0.5;
          gl_Position = projectionMatrix * view;
          vCorner = corner;
          vAlpha = min(1.0, pixels / ${MIN_FLAKE_PIXELS.toFixed(1)})
            * smoothstep(clearance, clearance + ${FADE_METERS.toFixed(1)}, depth)
            * (1.0 - smoothstep(BOX_WIDTH * 0.3, BOX_WIDTH * 0.48, length(around)));
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 color;
        uniform float opacity;
        varying float vAlpha;
        varying vec2 vCorner;
        varying vec3 vLamp;
        void main() {
          // A soft round flake.
          float disc = 1.0 - smoothstep(0.35, 1.0, length(vCorner));
          gl_FragColor = vec4(color + vLamp / opacity, opacity * vAlpha * disc);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.name = 'snow';
    // The flakes are placed in the vertex shader, around the camera: there are no bounds to cull by.
    this.mesh.frustumCulled = false;
    // Drawn after the other transparent things, which it falls in front of.
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** The drawing buffer's size in pixels, so the flakes keep their size on screen. Call on resize. */
  setViewport(widthPixels: number, heightPixels: number): void {
    this.uniforms.resolution.value.set(Math.max(1, widthPixels), Math.max(1, heightPixels));
  }

  /** Draws no flake nearer the eye than `meters` (at least the default 0.6): from the driver's seat, only past the glass. */
  setClearance(meters: number): void {
    this.uniforms.clearance.value = Math.max(CLEARANCE_METERS, meters);
  }

  /**
   * Snow of strength `snow` (0: none, 1: the heaviest) around the camera at
   * (cameraX, cameraZ), `deltaSeconds` on from the last frame (0 freezes
   * it). Allocation-free.
   */
  update(deltaSeconds: number, cameraX: number, cameraZ: number, snow: number): void {
    const flakes = Math.round(this.maxFlakes * Math.min(1, Math.max(0, snow)));
    this.mesh.visible = flakes > 0;
    if (flakes === 0) {
      return;
    }
    this.geometry.setDrawRange(0, flakes * 6);
    // Kept small, so the shader works with precise numbers however long the game runs.
    this.fall = (this.fall + (deltaSeconds * FALL_SPEED) / BOX_HEIGHT_METERS) % 1;
    this.driftX = (this.driftX + deltaSeconds * WIND_X) % BOX_WIDTH_METERS;
    this.driftZ = (this.driftZ + deltaSeconds * WIND_Z) % BOX_WIDTH_METERS;
    this.swayTime = (this.swayTime + deltaSeconds) % SWAY_PERIOD_SECONDS;
    this.uniforms.fall.value = this.fall;
    this.uniforms.drift.value.set(this.driftX, this.driftZ);
    this.uniforms.center.value.set(cameraX, cameraZ);
    this.uniforms.swayTime.value = this.swayTime;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
