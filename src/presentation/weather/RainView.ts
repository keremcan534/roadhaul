import { BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, ShaderMaterial, Vector2, type Scene } from 'three';
import { SeededRandom } from '../../core/random/SeededRandom';

/** Streaks in the heaviest rain; lighter rain draws a share of them. */
const MAX_DROPS = 3000;
/** The drops fill a box this wide around the camera, from the ground up to this height. */
const BOX_WIDTH_METERS = 44;
const BOX_HEIGHT_METERS = 20;
/** How fast the drops fall, and how the wind carries them, m/s. */
const FALL_SPEED = 11;
const WIND_X = 1.8;
const WIND_Z = 0.9;
/** A streak is the drop's path over a moment: this long, and this wide (never under a pixel on screen). */
const STREAK_LENGTH_METERS = 1.1;
const STREAK_WIDTH_METERS = 0.018;
const COLOR = 0xc3d0dc;
const OPACITY = 0.42;
const SEED = 61;

/**
 * Rain (spec §38): streaks falling around the camera, slanted by the wind.
 * One draw call, animated on the GPU: the CPU only sets a few uniforms a
 * frame, and the geometry is built once. The drops keep their places in the
 * world while the camera moves through them, and wrap round a box that
 * follows it, fading out at its edge and close to the eye. Heavier rain
 * draws more of them.
 */
export class RainView {
  private readonly geometry = new BufferGeometry();
  private readonly material: ShaderMaterial;
  private readonly mesh: Mesh;
  private readonly uniforms: {
    readonly fall: { value: number };
    readonly drift: { value: Vector2 };
    readonly center: { value: Vector2 };
    readonly resolution: { value: Vector2 };
    readonly color: { value: Color };
    readonly opacity: { value: number };
  };
  private fall = 0;
  private driftX = 0;
  private driftZ = 0;

  constructor(private readonly scene: Scene) {
    // Four corners per streak. `position` holds the drop's random place in the box (0..1 on each axis),
    // the same at all four corners; `corner` says which end (0: the drop, 1: its tail) and side (-1, 1).
    const random = new SeededRandom(SEED);
    const seeds = new Float32Array(MAX_DROPS * 4 * 3);
    const corners = new Float32Array(MAX_DROPS * 4 * 2);
    const indices = new Uint16Array(MAX_DROPS * 6);
    for (let drop = 0; drop < MAX_DROPS; drop++) {
      const x = random.next();
      const y = random.next();
      const z = random.next();
      for (let corner = 0; corner < 4; corner++) {
        const vertex = drop * 4 + corner;
        seeds.set([x, y, z], vertex * 3);
        corners.set([corner >> 1, (corner & 1) * 2 - 1], vertex * 2);
      }
      const first = drop * 4;
      indices.set([first, first + 1, first + 2, first + 2, first + 1, first + 3], drop * 6);
    }
    this.geometry.setAttribute('position', new BufferAttribute(seeds, 3));
    this.geometry.setAttribute('corner', new BufferAttribute(corners, 2));
    this.geometry.setIndex(new BufferAttribute(indices, 1));
    this.geometry.setDrawRange(0, 0);

    this.uniforms = {
      fall: { value: 0 },
      drift: { value: new Vector2() },
      center: { value: new Vector2() },
      resolution: { value: new Vector2(1, 1) },
      color: { value: new Color(COLOR) },
      opacity: { value: OPACITY },
    };
    // The tail points back along the drop's path: up, and into the wind.
    const speed = Math.hypot(WIND_X, FALL_SPEED, WIND_Z);
    const tail = [
      (-WIND_X / speed) * STREAK_LENGTH_METERS,
      (FALL_SPEED / speed) * STREAK_LENGTH_METERS,
      (-WIND_Z / speed) * STREAK_LENGTH_METERS,
    ].map((value) => value.toFixed(4));
    this.material = new ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      vertexShader: /* glsl */ `
        #define BOX_WIDTH ${BOX_WIDTH_METERS.toFixed(1)}
        #define BOX_HEIGHT ${BOX_HEIGHT_METERS.toFixed(1)}
        #define STREAK_WIDTH ${STREAK_WIDTH_METERS.toFixed(4)}
        const vec3 TAIL = vec3(${tail.join(', ')});
        uniform float fall;
        uniform vec2 drift;
        uniform vec2 center;
        uniform vec2 resolution;
        attribute vec2 corner;
        varying float vAlpha;
        varying float vSide;
        void main() {
          // The drop's place: carried by the wind, wrapped into the box round the camera, falling and wrapping to the top.
          vec2 around = mod(position.xz * BOX_WIDTH + drift - center + BOX_WIDTH * 0.5, BOX_WIDTH) - BOX_WIDTH * 0.5;
          vec3 drop = vec3(center.x + around.x, fract(position.y - fall) * BOX_HEIGHT, center.y + around.y);
          vec4 head = projectionMatrix * viewMatrix * vec4(drop, 1.0);
          vec4 tail = projectionMatrix * viewMatrix * vec4(drop + TAIL, 1.0);
          float nearest = min(head.w, tail.w);
          if (nearest < 0.6) {
            // Behind the camera or at the eye: nothing to draw.
            gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
            vAlpha = 0.0;
            vSide = 0.0;
            return;
          }
          vec4 clip = corner.x < 0.5 ? head : tail;
          // Widen the streak across its direction on screen.
          vec2 along = tail.xy / tail.w * resolution - head.xy / head.w * resolution;
          vec2 across = vec2(-along.y, along.x) / max(length(along), 0.0001);
          float widthPixels = STREAK_WIDTH * projectionMatrix[1][1] * resolution.y * 0.5 / clip.w;
          clip.xy += across * corner.y * max(widthPixels, 1.0) / resolution * clip.w;
          gl_Position = clip;
          // Bright at the drop, fading along the tail; faint when thinner than a pixel, near the eye and at the box's edge.
          vAlpha = (1.0 - corner.x * 0.85)
            * min(widthPixels, 1.0)
            * smoothstep(0.6, 2.5, nearest)
            * (1.0 - smoothstep(BOX_WIDTH * 0.3, BOX_WIDTH * 0.48, length(around)));
          vSide = corner.y;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 color;
        uniform float opacity;
        varying float vAlpha;
        varying float vSide;
        void main() {
          gl_FragColor = vec4(color, opacity * vAlpha * (1.0 - vSide * vSide));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.name = 'rain';
    // The drops are placed in the vertex shader, around the camera: there are no bounds to cull by.
    this.mesh.frustumCulled = false;
    // Drawn after the other transparent things (the GPS line, glass), which it falls in front of.
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** The drawing buffer's size in pixels, so the streaks keep at least a pixel's width. Call on resize. */
  setViewport(widthPixels: number, heightPixels: number): void {
    this.uniforms.resolution.value.set(Math.max(1, widthPixels), Math.max(1, heightPixels));
  }

  /**
   * Rain of strength `rain` (0: none, 1: the heaviest) around the camera at
   * (cameraX, cameraZ), `deltaSeconds` on from the last frame (0 freezes it).
   * Allocation-free.
   */
  update(deltaSeconds: number, cameraX: number, cameraZ: number, rain: number): void {
    const drops = Math.round(MAX_DROPS * Math.min(1, Math.max(0, rain)));
    this.mesh.visible = drops > 0;
    if (drops === 0) {
      return;
    }
    this.geometry.setDrawRange(0, drops * 6);
    // Kept small, so the shader works with precise numbers however long the game runs.
    this.fall = (this.fall + (deltaSeconds * FALL_SPEED) / BOX_HEIGHT_METERS) % 1;
    this.driftX = (this.driftX + deltaSeconds * WIND_X) % BOX_WIDTH_METERS;
    this.driftZ = (this.driftZ + deltaSeconds * WIND_Z) % BOX_WIDTH_METERS;
    this.uniforms.fall.value = this.fall;
    this.uniforms.drift.value.set(this.driftX, this.driftZ);
    this.uniforms.center.value.set(cameraX, cameraZ);
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
