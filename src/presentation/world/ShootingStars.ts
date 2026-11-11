import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  ShaderMaterial,
  Vector3,
  type Camera,
  type PerspectiveCamera,
  type Scene,
} from 'three';
import { SeededRandom } from '../../core/random/SeededRandom';

/** Where they fall: on a sphere this far round the camera (inside the sky's dome, beyond everything else). */
const DISTANCE = 760;
/** One falls every so often while the stars shine (seconds, drawn between the two); with `often`, every few seconds. */
const EVERY_SECONDS = [18, 55] as const;
const OFTEN_SECONDS = [3, 6] as const;
/** Each one streaks this long (seconds) along this much of the sky (radians), its tail this share of the way. */
const STREAK_SECONDS = 0.75;
const STREAK_RADIANS = 0.3;
const TAIL_SHARE = 0.35;
/** Its head this wide, meters at DISTANCE: two or three pixels on a phone, its core a soft line down the middle. */
const HEAD_WIDTH = 6;
/**
 * It falls to one side of where the camera looks, between these angles off
 * it (radians: clear of the middle, where the menus and the messages are),
 * in the upper part of its view: between a little over where it looks and a
 * little under the top of its view, never lower than LOWEST (radians up).
 */
const ASIDE_RADIANS = [0.28, 0.65] as const;
const LOWEST = 0.12;
/** The stars shine this brightly at least for one to fall. */
const STARS_FROM = 0.35;

/**
 * Shooting stars on a clear night: now and then a bright streak falls
 * across the sky where the camera looks, its tail fading behind it. One
 * quad, its four corners moved as it falls; hidden, no draw call, between
 * them and by day. update() allocates nothing.
 */
export class ShootingStars {
  readonly mesh: Mesh;
  private readonly geometry: BufferGeometry;
  private readonly material: ShaderMaterial;
  private readonly positions: Float32Array;
  private readonly random = new SeededRandom(0x5eed_57a5);
  private readonly start = new Vector3();
  private readonly end = new Vector3();
  private readonly head = new Vector3();
  private readonly tail = new Vector3();
  private readonly side = new Vector3();
  private wait: number;
  /** How far the one falling has come (0..1); below 0 for none. */
  private progress = -1;
  private often = false;

  constructor(private readonly scene: Scene) {
    this.geometry = new BufferGeometry();
    this.positions = new Float32Array(4 * 3);
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    // Head (1) to tail (0) along it; the head's corners first.
    this.geometry.setAttribute('along', new BufferAttribute(new Float32Array([1, 1, 0, 0]), 1));
    this.geometry.setAttribute('across', new BufferAttribute(new Float32Array([-1, 1, -1, 1]), 1));
    this.geometry.setIndex([0, 2, 1, 1, 2, 3]);
    this.material = new ShaderMaterial({
      uniforms: { brightness: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float along;
        attribute float across;
        varying float vAlong;
        varying float vAcross;
        void main() {
          vAlong = along;
          vAcross = across;
          gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float brightness;
        varying float vAlong;
        varying float vAcross;
        void main() {
          // Only a few pixels wide: a soft core across all of it, the head brightest, added once (alpha 1).
          float core = 1.0 - vAcross * vAcross;
          float glow = pow( vAlong, 1.6 ) * core * brightness * 1.8;
          gl_FragColor = vec4( vec3( 0.85, 0.92, 1.0 ) * glow, 1.0 );
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
      // It turns as it falls: both faces, in one pass.
      side: DoubleSide,
      forceSinglePass: true,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.name = 'shootingStars';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -2;
    this.mesh.visible = false;
    this.wait = this.nextWait();
    scene.add(this.mesh);
  }

  /** One is falling now, bright enough to see. */
  get streaking(): boolean {
    return this.mesh.visible && this.progress > 0.15 && this.progress < 0.85;
  }

  /** One every few seconds (`?sky=meteors`, for a look), or now and then again. */
  set fallOften(often: boolean) {
    this.often = often;
    this.wait = Math.min(this.wait, this.nextWait());
  }

  /**
   * Moves `deltaSeconds` on: while the stars shine (`starLevel`, 0..1), one
   * falls now and then where `camera` looks, and the falling one goes on.
   * Allocation-free.
   */
  update(deltaSeconds: number, camera: Camera, starLevel: number): void {
    if (this.progress < 0) {
      if (starLevel < STARS_FROM) {
        this.mesh.visible = false;
        return;
      }
      this.wait -= deltaSeconds;
      if (this.wait > 0) {
        return;
      }
      this.launch(camera);
    }
    this.progress += deltaSeconds / STREAK_SECONDS;
    if (this.progress >= 1) {
      this.progress = -1;
      this.mesh.visible = false;
      this.wait = this.nextWait();
      return;
    }
    // In, bright, and out again; fainter in a paler sky.
    const p = this.progress;
    const fade = Math.min(1, p * 6) * Math.min(1, (1 - p) * 3);
    this.material.uniforms['brightness']!.value = fade * Math.min(1, starLevel * 1.4);
    this.head.lerpVectors(this.start, this.end, p).normalize();
    this.tail.lerpVectors(this.start, this.end, Math.max(0, p - TAIL_SHARE)).normalize();
    this.side.subVectors(this.head, this.tail).cross(this.head).normalize();
    const width = HEAD_WIDTH;
    this.corner(0, this.head, width);
    this.corner(1, this.head, -width);
    this.corner(2, this.tail, width * 0.15);
    this.corner(3, this.tail, -width * 0.15);
    this.geometry.getAttribute('position').needsUpdate = true;
    this.mesh.position.copy(camera.position);
    this.mesh.visible = true;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }

  /** A new one, from a point up the sky where the camera looks, falling down and across. */
  private launch(camera: Camera): void {
    const look = camera.matrixWorld.elements;
    const side = this.random.next() < 0.5 ? -1 : 1;
    const heading = Math.atan2(-look[8]!, -look[10]!) + side * (ASIDE_RADIANS[0] + (ASIDE_RADIANS[1] - ASIDE_RADIANS[0]) * this.random.next());
    // Where the camera looks up or down, and the top of its view.
    const pitch = Math.asin(Math.max(-1, Math.min(1, -look[9]!)));
    const top = pitch + (((camera as PerspectiveCamera).fov ?? 60) * Math.PI) / 360;
    const lowest = Math.max(LOWEST, pitch + 0.05);
    const highest = Math.max(lowest + 0.05, top - 0.06);
    const rise = lowest + (highest - lowest) * this.random.next();
    // Down the sky a little and on, mostly outward.
    const sideways = (this.random.next() < 0.75 ? side : -side) * (0.7 + 0.3 * this.random.next());
    const fall = Math.max(LOWEST * 0.5, rise - STREAK_RADIANS * (0.25 + 0.3 * this.random.next()));
    this.aim(this.start, heading, rise);
    this.aim(this.end, heading + sideways * STREAK_RADIANS, fall);
    this.progress = 0;
  }

  /** `out`: the way `heading` round (0 along +z) and `rise` up (radians). */
  private aim(out: Vector3, heading: number, rise: number): void {
    const flat = Math.cos(rise);
    out.set(Math.sin(heading) * flat, Math.sin(rise), Math.cos(heading) * flat);
  }

  private corner(index: number, at: Vector3, offset: number): void {
    this.positions[index * 3] = at.x * DISTANCE + this.side.x * offset;
    this.positions[index * 3 + 1] = at.y * DISTANCE + this.side.y * offset;
    this.positions[index * 3 + 2] = at.z * DISTANCE + this.side.z * offset;
  }

  private nextWait(): number {
    const [least, most] = this.often ? OFTEN_SECONDS : EVERY_SECONDS;
    return least + (most - least) * this.random.next();
  }
}
