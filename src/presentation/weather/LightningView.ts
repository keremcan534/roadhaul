import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Mesh,
  ShaderMaterial,
  type Scene,
} from 'three';
import { SeededRandom } from '../../core/random/SeededRandom';
import type { LightningStrike } from './Thunderstorm';

/** The bolts drawn, each a channel of its own shape, made at the start: a strike takes one of them. */
const BOLT_SHAPES = 4;
/** A channel's path is split in two this many times, each half bent aside by half as much as the last. */
const BOLT_SPLITS = 7;
/** How far the channel wanders aside at its first split, as a share of its height. */
const BOLT_WANDER = 0.22;
/** Branches off each channel, at most, each this share of the channel's height long, and as bright. */
const MAX_BRANCHES = 4;
const BRANCH_LENGTH = [0.2, 0.45] as const;
const BRANCH_LIGHT = 0.55;
/**
 * The channel comes down from the cloud base this high (meters) to the
 * ground at the strike's distance; drawn at most this far off (inside the
 * sky's dome, past the hills in front of it), as big as it looks from
 * where it is. Its glow is this wide, as a share of how far it is drawn.
 */
const CLOUD_BASE_METERS = 1300;
const DRAWN_WITHIN_METERS = 760;
/** The channel's glow is this wide either side of it, as a share of its height (a branch's a little less). */
const GLOW_WIDTH = 0.014;
/** Strikes farther than this light the clouds without a bolt to be seen: it is behind the rain. */
const BOLT_WITHIN_METERS = 4500;
/** Bolts show once a flash is this bright. */
const MIN_FLASH = 0.03;
/** The channel's white-hot core and its bluish glow (linear colours). */
const CORE = [1, 1, 1] as const;
const GLOW = [0.55, 0.62, 1] as const;

/** One bolt's shape: its triangles' corners (x across, y up, from the ground at 0 to the cloud base at 1). */
interface BoltShape {
  readonly positions: Float32Array;
  readonly across: Float32Array;
  readonly light: Float32Array;
}

/**
 * The bolt of a lightning strike (Thunderstorm): a jagged channel of light
 * from the cloud base down to the ground, with a branch or a few, drawn in
 * the sky toward the strike, as big as its distance makes it, turned to
 * face the camera. It flashes with the strokes and goes out with them, its
 * top hidden in the cloud. The shapes are made at the start and the bolt's
 * geometry holds all of them: a strike only picks which to draw. One draw
 * call while it shows, none otherwise; nothing too far off for its bolt to
 * be seen through the rain.
 */
export class LightningView {
  readonly mesh: Mesh;
  private readonly geometry = new BufferGeometry();
  private readonly material: ShaderMaterial;
  private readonly uniforms = { flash: { value: 0 } };
  /** Where each shape's triangles start in the geometry, and how many corners it has. */
  private readonly shapeStart: number[] = [];
  private readonly shapeCount: number[] = [];
  private shown = false;

  constructor(
    private readonly scene: Scene,
    private readonly random = new SeededRandom(83),
  ) {
    const shapes = Array.from({ length: BOLT_SHAPES }, (_, index) => boltShape(new SeededRandom(1009 + index * 17)));
    const corners = shapes.reduce((sum, shape) => sum + shape.across.length, 0);
    const positions = new Float32Array(corners * 3);
    const across = new Float32Array(corners);
    const light = new Float32Array(corners);
    let at = 0;
    for (const shape of shapes) {
      this.shapeStart.push(at);
      this.shapeCount.push(shape.across.length);
      positions.set(shape.positions, at * 3);
      across.set(shape.across, at);
      light.set(shape.light, at);
      at += shape.across.length;
    }
    this.geometry.setAttribute('position', new BufferAttribute(positions, 3));
    this.geometry.setAttribute('across', new BufferAttribute(across, 1));
    this.geometry.setAttribute('light', new BufferAttribute(light, 1));
    this.material = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute float across;
        attribute float light;
        varying float vAcross;
        varying float vLight;
        varying float vHeight;
        void main() {
          vAcross = across;
          vLight = light;
          vHeight = position.y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float flash;
        varying float vAcross;
        varying float vLight;
        varying float vHeight;
        void main() {
          // A white-hot core in a bluish glow, its top lost in the cloud.
          float glow = exp( - vAcross * vAcross * 5.0 );
          float core = 1.0 - smoothstep( 0.0, 0.22, abs( vAcross ) );
          vec3 color = vec3( ${CORE.join(', ')} ) * core + vec3( ${GLOW.join(', ')} ) * glow * 0.6;
          float cloud = 1.0 - smoothstep( 0.82, 1.0, vHeight );
          gl_FragColor = vec4( color * ( flash * vLight * cloud * 2.0 ), 1.0 );
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.name = 'lightning';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    // After the sky and its clouds: the bolt shines in front of them.
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  /** Whether a bolt shows now. */
  get visible(): boolean {
    return this.mesh.visible;
  }

  /**
   * A strike (Thunderstorm.update's) seen from `eye`: picks a bolt and puts
   * it toward the strike, as big as it looks from there; none if it is too
   * far off to be seen through the rain.
   */
  strike(strike: Readonly<LightningStrike>, eye: Readonly<{ x: number; y: number; z: number }>): void {
    this.shown = strike.distanceMeters <= BOLT_WITHIN_METERS;
    if (!this.shown) {
      this.mesh.visible = false;
      return;
    }
    const shape = this.random.int(0, BOLT_SHAPES - 1);
    this.geometry.setDrawRange(this.shapeStart[shape]!, this.shapeCount[shape]!);
    // Drawn inside the dome at most: shrunk to look as big from here as the real one would from where it is.
    const drawn = Math.min(strike.distanceMeters, DRAWN_WITHIN_METERS);
    const scale = drawn / strike.distanceMeters;
    const sin = Math.sin(strike.bearing);
    const cos = Math.cos(strike.bearing);
    this.mesh.position.set(eye.x + sin * drawn, 0, eye.z + cos * drawn);
    this.mesh.scale.set(CLOUD_BASE_METERS * scale, CLOUD_BASE_METERS * scale, 1);
    this.faceCamera(eye);
  }

  /** The flash now (Thunderstorm.flash): the bolt shines with it, turned to face `eye`. Allocation-free. */
  update(flash: number, eye: Readonly<{ x: number; y: number; z: number }>): void {
    const visible = this.shown && flash > MIN_FLASH;
    this.mesh.visible = visible;
    if (!visible) {
      return;
    }
    this.uniforms.flash.value = flash;
    this.faceCamera(eye);
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }

  /** Turns the bolt round its upright to face `eye`. */
  private faceCamera(eye: Readonly<{ x: number; z: number }>): void {
    this.mesh.rotation.y = Math.atan2(eye.x - this.mesh.position.x, eye.z - this.mesh.position.z);
  }
}

/**
 * A bolt's shape from `random`: the main channel from the cloud base (y 1)
 * to the ground (y 0), bent at every split of its path, and a few shorter,
 * dimmer branches off it, each drawn as a strip of quads with its glow
 * across it (-1..1).
 */
function boltShape(random: SeededRandom): BoltShape {
  const channel = jaggedPath(random, [random.range(-0.08, 0.08), 1], [random.range(-0.15, 0.15), 0], BOLT_WANDER);
  const strips: { points: [number, number][]; light: number; width: number }[] = [{ points: channel, light: 1, width: 1 }];
  // Branches: off the channel's upper half or so, shorter and dimmer, the glow a little narrower.
  const branches = random.int(2, MAX_BRANCHES);
  for (let branch = 0; branch < branches; branch++) {
    const from = channel[random.int(Math.floor(channel.length * 0.15), Math.floor(channel.length * 0.7))]!;
    const length = random.range(BRANCH_LENGTH[0], BRANCH_LENGTH[1]);
    const side = random.sign();
    const to: [number, number] = [from[0] + side * length * random.range(0.4, 0.8), from[1] - length];
    strips.push({ points: jaggedPath(random, from, to, BOLT_WANDER * length), light: BRANCH_LIGHT, width: 0.7 });
  }
  const positions: number[] = [];
  const across: number[] = [];
  const light: number[] = [];
  for (const strip of strips) {
    const { points } = strip;
    const half = GLOW_WIDTH * strip.width;
    for (let i = 0; i + 1 < points.length; i++) {
      const [ax, ay] = points[i]!;
      const [bx, by] = points[i + 1]!;
      // Across the segment, in the bolt's plane.
      const length = Math.hypot(bx - ax, by - ay) || 1;
      const nx = (-(by - ay) / length) * half;
      const ny = ((bx - ax) / length) * half;
      const corner = (x: number, y: number, side: number): void => {
        positions.push(x, y, 0);
        across.push(side);
        light.push(strip.light);
      };
      // Two triangles facing +z (toward the camera, once the bolt is turned to face it).
      corner(ax - nx, ay - ny, -1);
      corner(bx - nx, by - ny, -1);
      corner(bx + nx, by + ny, 1);
      corner(ax - nx, ay - ny, -1);
      corner(bx + nx, by + ny, 1);
      corner(ax + nx, ay + ny, 1);
    }
  }
  return { positions: Float32Array.from(positions), across: Float32Array.from(across), light: Float32Array.from(light) };
}

/** A path from `from` to `to`, split BOLT_SPLITS times, each midpoint pushed aside by up to `wander` (then half, …). */
function jaggedPath(random: SeededRandom, from: readonly [number, number], to: readonly [number, number], wander: number): [number, number][] {
  let points: [number, number][] = [
    [from[0], from[1]],
    [to[0], to[1]],
  ];
  let reach = wander;
  for (let split = 0; split < BOLT_SPLITS; split++) {
    const next: [number, number][] = [points[0]!];
    for (let i = 0; i + 1 < points.length; i++) {
      const [ax, ay] = points[i]!;
      const [bx, by] = points[i + 1]!;
      next.push([(ax + bx) / 2 + random.range(-reach, reach), (ay + by) / 2 + random.range(-reach, reach) * 0.25], [bx, by]);
    }
    points = next;
    reach /= 2;
  }
  return points;
}
