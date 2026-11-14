import type { MapPainter } from './MapPainter';
import { createCanvasTransform, MapViewport } from './MapViewport';

/**
 * How far the minimap's middle may move before its picture is drawn again,
 * meters: the picture reaches this far past what the minimap shows.
 */
const MARGIN_METERS = 250;
/**
 * The picture's pixels per pixel of the minimap: turned onto it with the
 * truck's heading, a picture drawn finer stays as sharp as the map drawn
 * straight onto it.
 */
const OVERSAMPLE = 2;

/**
 * The map's ground (MapPainter.paintGround: the lands and their relief,
 * forests, fields, buildings, who leads each city, the roads) for the
 * minimap, drawn north up once into a picture larger than the minimap shows
 * and turned onto it at each repaint: one image drawn, where every path of
 * the whole map (the coasts stroked four times, every forest, field and
 * building) was drawn and sent to the GPU twelve times a second. Drawn again
 * when the minimap's middle comes within MARGIN_METERS of the picture's
 * edge, the ground changes (MapPainter.groundVersion) or the minimap's scale
 * or pixels do. Allocation-free once drawn.
 */
export class MapGroundCache {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D | null;
  /** The picture's own view: north up, over the square it covers, at the minimap's scale. */
  private readonly view = new MapViewport();
  private readonly transform = createCanvasTransform();
  /** The square of the world the picture covers, meters; none until drawn. */
  private minX = 0;
  private minZ = 0;
  private sizeMeters = 0;
  /** What it was drawn with. */
  private drawnVersion = Number.NaN;
  private drawnScale = 0;
  private drawnPixelRatio = 0;

  constructor(
    document: Document,
    private readonly painter: MapPainter,
  ) {
    this.canvas = document.createElement('canvas');
    this.context = this.canvas.getContext('2d');
  }

  /** How many times the picture has been drawn (for tests and the performance run). */
  draws = 0;

  /**
   * Draws the ground under `view` onto `context` (a canvas of `pixelRatio`
   * device pixels per CSS pixel), as paintGround would: from the picture,
   * drawn again first when it does not cover what `view` shows. False where
   * there is no picture to draw from (no 2D canvas): then paint the ground
   * straight onto `context`.
   */
  draw(context: CanvasRenderingContext2D, view: MapViewport, pixelRatio: number): boolean {
    if (this.context === null) {
      return false;
    }
    // All that the minimap's canvas shows, however it is turned: the circle round its corners.
    const reach = Math.sqrt(view.width * view.width + view.height * view.height) / 2 / view.scale;
    const version = this.painter.groundVersion;
    if (
      version !== this.drawnVersion ||
      view.scale !== this.drawnScale ||
      pixelRatio !== this.drawnPixelRatio ||
      view.centerX - reach < this.minX ||
      view.centerZ - reach < this.minZ ||
      view.centerX + reach > this.minX + this.sizeMeters ||
      view.centerZ + reach > this.minZ + this.sizeMeters
    ) {
      this.redraw(view, reach, pixelRatio, version);
    }
    const t = view.canvasTransform(this.transform, pixelRatio);
    context.setTransform(t.a, t.b, t.c, t.d, t.e, t.f);
    context.drawImage(this.canvas, this.minX, this.minZ, this.sizeMeters, this.sizeMeters);
    return true;
  }

  /** Draws the picture again round `view`'s middle, reaching MARGIN_METERS past `reach`. */
  private redraw(view: MapViewport, reach: number, pixelRatio: number, version: number): void {
    const context = this.context!;
    const half = reach + MARGIN_METERS;
    const own = this.view;
    own.scale = view.scale;
    own.turn(0);
    own.centerX = view.centerX;
    own.centerZ = view.centerZ;
    own.resize(2 * half * view.scale, 2 * half * view.scale);
    const pixels = Math.ceil(own.width * pixelRatio * OVERSAMPLE);
    if (this.canvas.width !== pixels || this.canvas.height !== pixels) {
      this.canvas.width = pixels;
      this.canvas.height = pixels;
    }
    // The square the pixels cover exactly (the canvas is a whole number of them).
    this.sizeMeters = pixels / (view.scale * pixelRatio * OVERSAMPLE);
    own.resize(pixels / (pixelRatio * OVERSAMPLE), pixels / (pixelRatio * OVERSAMPLE));
    this.minX = own.centerX - this.sizeMeters / 2;
    this.minZ = own.centerZ - this.sizeMeters / 2;
    this.painter.paintSea(context);
    this.painter.paintGround(context, own, pixelRatio * OVERSAMPLE, pixelRatio);
    this.drawnVersion = version;
    this.drawnScale = view.scale;
    this.drawnPixelRatio = pixelRatio;
    this.draws++;
  }
}
