import type { DrivingService } from '../../systems/driving/DrivingService';
import { setText } from '../dom';
import type { Strings } from '../i18n';
import type { MapPainter, PaintOptions } from '../map/MapPainter';
import { MapViewport } from '../map/MapViewport';

/** Repaints per second: smooth enough at driving speeds, and cheap. */
const REPAINTS_PER_SECOND = 12;
/** Meters from the middle to the rim. */
const RADIUS_METERS = 300;
/** The middle is this far ahead of the truck (a fraction of the radius), so more of the road ahead shows. */
const LOOK_AHEAD = 0.3;
/** Device pixels per CSS pixel, at most: a small canvas, sharp enough and quick to fill. */
const MAX_PIXEL_RATIO = 2;

/**
 * The round map on the driving screen: the roads round the truck with the
 * way it heads up, the route, the next bay (at the rim when it is further),
 * rest areas and north, with the time of day at its foot. It repaints
 * twelve times a second while shown. Tapping it opens the full map.
 */
export class Minimap {
  private readonly button: HTMLButtonElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly clock: HTMLSpanElement;
  private readonly context: CanvasRenderingContext2D | null;
  private paints = 0;
  private readonly viewport = new MapViewport();
  private readonly options: PaintOptions = { labels: false, truckPixels: 16, pinRimPixels: 0, northRimPixels: 0 };
  private readonly resizeObserver: ResizeObserver | null = null;
  private sinceRepaint = Number.POSITIVE_INFINITY;
  private pixelRatio = 1;

  constructor(
    parent: HTMLElement,
    strings: Strings,
    private readonly painter: MapPainter,
    private readonly driving: DrivingService,
    onOpen: () => void,
  ) {
    const document = parent.ownerDocument;
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'minimap';
    this.button.dataset.action = 'open-map';
    this.button.setAttribute('aria-label', strings.t('map.open'));
    this.button.hidden = true;
    this.button.addEventListener('click', onOpen);
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap__canvas';
    this.clock = document.createElement('span');
    this.clock.className = 'minimap__clock';
    this.button.append(this.canvas, this.clock);
    this.context = this.canvas.getContext('2d');
    parent.append(this.button);
    const view = document.defaultView;
    if (view !== null && typeof view.ResizeObserver === 'function') {
      this.resizeObserver = new view.ResizeObserver((entries) => {
        const box = entries[0]?.contentRect;
        if (box !== undefined) {
          this.fit(box.width, box.height, view.devicePixelRatio);
        }
      });
      this.resizeObserver.observe(this.canvas);
    }
  }

  set visible(visible: boolean) {
    this.button.hidden = !visible;
    this.sinceRepaint = Number.POSITIVE_INFINITY; // Paint at once when it shows.
  }

  /** Shows the time of day at the map's foot ("07:05"). Touches the page only when it changes. */
  showClock(text: string): void {
    setText(this.clock, text);
  }

  /** The map as last painted, and how many times it has been: the cabin's navigation screen shows it too. */
  get picture(): HTMLCanvasElement {
    return this.canvas;
  }

  get paintCount(): number {
    return this.paints;
  }

  /** Per frame while driving: repaints a dozen times a second. */
  update(deltaSeconds: number): void {
    if (this.button.hidden || this.context === null || this.canvas.width === 0) {
      return;
    }
    this.sinceRepaint += deltaSeconds;
    if (this.sinceRepaint < 1 / REPAINTS_PER_SECOND) {
      return;
    }
    this.sinceRepaint = 0;
    const view = this.viewport;
    const { x, z, heading } = this.driving.vehicle;
    view.headUp(heading);
    view.centerX = x + Math.sin(heading) * RADIUS_METERS * LOOK_AHEAD;
    view.centerZ = z + Math.cos(heading) * RADIUS_METERS * LOOK_AHEAD;
    this.painter.paint(this.context, view, this.pixelRatio, this.options);
    this.paints++;
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.button.remove();
  }

  /** The canvas's size on screen (CSS px) changed: size its pixels to match, and the scale to the radius. */
  private fit(width: number, height: number, devicePixelRatio: number): void {
    this.pixelRatio = Math.min(MAX_PIXEL_RATIO, Math.max(1, devicePixelRatio));
    this.canvas.width = Math.round(width * this.pixelRatio);
    this.canvas.height = Math.round(height * this.pixelRatio);
    this.viewport.resize(width, height);
    const radius = Math.min(width, height) / 2;
    this.viewport.scale = radius / RADIUS_METERS;
    this.options.pinRimPixels = radius - 10;
    this.options.northRimPixels = radius - 10;
    this.sinceRepaint = Number.POSITIVE_INFINITY;
  }
}
