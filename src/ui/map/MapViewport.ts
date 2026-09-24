import type { MapBox } from './mapSketch';

/** The 2D affine transform a canvas takes (setTransform(a, b, c, d, e, f)): screen = (a·x + c·z + e, b·x + d·z + f). */
export interface CanvasTransform {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export function createCanvasTransform(): CanvasTransform {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

/**
 * Where a 2D map looks: the world point at the middle of the screen, the
 * zoom (pixels per meter) and a turn. Unturned, the map is drawn as seen
 * from above, x to the right and z down the screen, so north (−z) is up.
 * The minimap turns it so the truck always heads up (`headUp`).
 * Allocation-free, and DOM-free (unit-tested).
 */
export class MapViewport {
  /** Screen size, CSS pixels. */
  width = 1;
  height = 1;
  centerX = 0;
  centerZ = 0;
  /** Pixels per meter. */
  scale = 1;
  /** Radians: the world turned clockwise on the screen about its middle. */
  rotation = 0;
  private cos = 1;
  private sin = 0;

  constructor(
    /** The zoom's limits, pixels per meter. */
    public minScale = 0.01,
    public maxScale = 20,
  ) {}

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  /** Shows all of `box`, as large as the screen allows with `paddingPixels` clear round it, unturned. */
  fit(box: MapBox, paddingPixels = 0): void {
    this.centerX = (box.minX + box.maxX) / 2;
    this.centerZ = (box.minZ + box.maxZ) / 2;
    const width = Math.max(1, this.width - 2 * paddingPixels);
    const height = Math.max(1, this.height - 2 * paddingPixels);
    this.scale = this.clampScale(Math.min(width / (box.maxX - box.minX || 1), height / (box.maxZ - box.minZ || 1)));
    this.turn(0);
  }

  /** Turns the map so the heading (radians; 0 faces +z, a quarter turn faces +x) points up the screen. */
  headUp(heading: number): void {
    this.turn(heading - Math.PI);
  }

  turn(rotation: number): void {
    this.rotation = rotation;
    this.cos = Math.cos(rotation);
    this.sin = Math.sin(rotation);
  }

  screenX(x: number, z: number): number {
    return this.width / 2 + this.scale * (this.cos * (x - this.centerX) - this.sin * (z - this.centerZ));
  }

  screenY(x: number, z: number): number {
    return this.height / 2 + this.scale * (this.sin * (x - this.centerX) + this.cos * (z - this.centerZ));
  }

  worldX(screenX: number, screenY: number): number {
    const dx = (screenX - this.width / 2) / this.scale;
    const dy = (screenY - this.height / 2) / this.scale;
    return this.centerX + this.cos * dx + this.sin * dy;
  }

  worldZ(screenX: number, screenY: number): number {
    const dx = (screenX - this.width / 2) / this.scale;
    const dy = (screenY - this.height / 2) / this.scale;
    return this.centerZ - this.sin * dx + this.cos * dy;
  }

  /** Drags the map by a finger's move on the screen, CSS pixels. */
  panBy(deltaX: number, deltaY: number): void {
    const dx = deltaX / this.scale;
    const dy = deltaY / this.scale;
    this.centerX -= this.cos * dx + this.sin * dy;
    this.centerZ -= -this.sin * dx + this.cos * dy;
  }

  /** Zooms by `factor`, keeping the world point under the screen point (x, y) where it is. */
  zoomAt(factor: number, x: number, y: number): void {
    const worldX = this.worldX(x, y);
    const worldZ = this.worldZ(x, y);
    this.scale = this.clampScale(this.scale * factor);
    this.panBy(x - this.screenX(worldX, worldZ), y - this.screenY(worldX, worldZ));
  }

  /** Keeps the middle of the screen over `box`, so the map cannot be dragged away. */
  keepWithin(box: MapBox): void {
    this.centerX = Math.min(box.maxX, Math.max(box.minX, this.centerX));
    this.centerZ = Math.min(box.maxZ, Math.max(box.minZ, this.centerZ));
  }

  /** True when any of `box` may be on screen, allowing `marginPixels` round it (lines drawn wide, labels). */
  sees(box: MapBox, marginPixels: number): boolean {
    // The screen's circumscribed circle, in meters: right however the map is turned.
    const radius = (Math.hypot(this.width, this.height) / 2 + marginPixels) / this.scale;
    const dx = this.centerX - Math.min(box.maxX, Math.max(box.minX, this.centerX));
    const dz = this.centerZ - Math.min(box.maxZ, Math.max(box.minZ, this.centerZ));
    return dx * dx + dz * dz <= radius * radius;
  }

  /** The transform that draws world meters on a canvas of `pixelRatio` device pixels per CSS pixel. */
  canvasTransform(out: CanvasTransform, pixelRatio: number): CanvasTransform {
    const scale = this.scale * pixelRatio;
    out.a = scale * this.cos;
    out.b = scale * this.sin;
    out.c = -scale * this.sin;
    out.d = scale * this.cos;
    out.e = (this.width / 2) * pixelRatio - (out.a * this.centerX + out.c * this.centerZ);
    out.f = (this.height / 2) * pixelRatio - (out.b * this.centerX + out.d * this.centerZ);
    return out;
  }

  private clampScale(scale: number): number {
    return Math.min(this.maxScale, Math.max(this.minScale, scale));
  }
}
