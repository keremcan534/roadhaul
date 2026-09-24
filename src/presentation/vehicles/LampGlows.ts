import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  PointsMaterial,
  type DataTexture,
} from 'three';
import { glowImage } from '../textures/proceduralImages';
import { toTexture } from '../textures/toTexture';

/** The glows' opacity with the lamps fully on. */
const FULL_OPACITY = 0.9;

/**
 * The glow round lit lamps at night: soft, round sprites in each lamp's
 * colour, added onto what is behind them, sized in the world so farther
 * lamps look smaller. One draw call for a whole set of lamps. The owner
 * writes where the lamps are (setPosition), fixed in a vehicle's model or
 * every frame for traffic, and fades the set in and out with setLevel().
 * Hidden (no draw call) while the lamps are off.
 */
export class LampGlows {
  readonly points: Points;
  private readonly geometry = new BufferGeometry();
  private readonly positions: BufferAttribute;
  private readonly colors: BufferAttribute;
  private readonly material: PointsMaterial;
  private readonly texture: DataTexture;
  private readonly color = new Color();
  private level = 0;

  /** Room for `capacity` lamps, each glow `sizeMeters` across. */
  constructor(capacity: number, sizeMeters: number) {
    this.positions = new BufferAttribute(new Float32Array(Math.max(1, capacity) * 3), 3);
    this.colors = new BufferAttribute(new Float32Array(Math.max(1, capacity) * 3), 3);
    this.geometry.setAttribute('position', this.positions);
    this.geometry.setAttribute('color', this.colors);
    this.geometry.setDrawRange(0, 0);
    this.texture = toTexture(glowImage(), { srgb: false });
    this.material = new PointsMaterial({
      size: sizeMeters,
      sizeAttenuation: true,
      map: this.texture,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: AdditiveBlending,
      // Lamps shine through the haze, and keep their colour.
      fog: false,
      toneMapped: false,
    });
    this.points = new Points(this.geometry, this.material);
    // The owner moves the lamps about: bounds computed once would go stale.
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  /** How many lamps glow, from the first. */
  setCount(count: number): void {
    if (this.geometry.drawRange.count !== count) {
      this.geometry.setDrawRange(0, count);
    }
  }

  setPosition(index: number, x: number, y: number, z: number): void {
    this.positions.setXYZ(index, x, y, z);
    this.positions.needsUpdate = true;
  }

  setColor(index: number, hex: number): void {
    this.color.setHex(hex);
    this.colors.setXYZ(index, this.color.r, this.color.g, this.color.b);
    this.colors.needsUpdate = true;
  }

  /** How brightly the lamps shine, 0..1: 0 hides the glows. */
  setLevel(level: number): void {
    if (level === this.level) {
      return;
    }
    this.level = level;
    this.material.opacity = level * FULL_OPACITY;
    this.points.visible = level > 0.01;
  }

  get visible(): boolean {
    return this.points.visible;
  }

  dispose(): void {
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
