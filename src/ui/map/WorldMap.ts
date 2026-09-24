import type { DrivingService } from '../../systems/driving/DrivingService';
import { button, element } from '../dom';
import type { Strings } from '../i18n';
import type { MapPainter, PaintOptions } from './MapPainter';
import type { MapSketch } from './mapSketch';
import { MapViewport } from './MapViewport';

/** Device pixels per CSS pixel, at most: the map fills the screen, so it stays light on the GPU. */
const MAX_PIXEL_RATIO = 2;
/** The closest zoom, pixels per meter. */
const MAX_SCALE = 4;
/** The zoom "show the truck" goes to at least, pixels per meter. */
const TRUCK_SCALE = 0.6;
/** One tap on + or −. */
const ZOOM_STEP = 1.6;
/** Room kept round the whole region, CSS px: for names at the edge, the title bar and the buttons. */
const FIT_PADDING = 56;
const OPTIONS: PaintOptions = { labels: true, truckPixels: 22, pinRimPixels: 0, northRimPixels: 0 };

export interface WorldMapActions {
  readonly onClose: () => void;
}

/**
 * The full-screen 2D map (player feedback: "the map could be 2D"): the whole
 * region north up, with city names, depots, rest areas, the truck and the
 * route to its contract's next bay. Drag to move it, pinch or scroll to
 * zoom, or use the buttons. It repaints only after something changed; the
 * entry point pauses the drive while it is open.
 */
export class WorldMap {
  private readonly overlay: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D | null;
  private readonly viewport = new MapViewport();
  /** Fingers (or the mouse) on the map, by pointer id: where each was last. */
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private readonly resizeObserver: ResizeObserver | null = null;
  private pixelRatio = 1;
  private dirty = true;

  constructor(
    parent: HTMLElement,
    strings: Strings,
    private readonly painter: MapPainter,
    private readonly sketch: MapSketch,
    private readonly driving: DrivingService,
    actions: WorldMapActions,
  ) {
    const document = parent.ownerDocument;
    this.overlay = element(document, 'div', 'screen world-map');
    this.overlay.dataset.screen = 'map';
    this.overlay.hidden = true;
    this.canvas = element(document, 'canvas', 'world-map__canvas');
    this.context = this.canvas.getContext('2d');

    const bar = element(document, 'div', 'world-map__bar');
    bar.append(
      element(document, 'h2', 'world-map__title', strings.t('map.title')),
      button(document, 'button--secondary', strings.t('map.close'), 'close-map', actions.onClose),
    );
    const tool = (label: string, action: string, aria: string, onPress: () => void): HTMLButtonElement => {
      const control = button(document, 'world-map__tool', label, action, onPress);
      control.setAttribute('aria-label', aria);
      return control;
    };
    const tools = element(document, 'div', 'world-map__tools');
    tools.append(
      tool('+', 'map-zoom-in', strings.t('map.zoomIn'), () => this.zoomBy(ZOOM_STEP)),
      tool('−', 'map-zoom-out', strings.t('map.zoomOut'), () => this.zoomBy(1 / ZOOM_STEP)),
      tool('◎', 'map-truck', strings.t('map.showTruck'), () => this.showTruck()),
    );
    this.overlay.append(this.canvas, bar, tools);
    parent.append(this.overlay);
    this.bindGestures();

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

  get isOpen(): boolean {
    return !this.overlay.hidden;
  }

  /** Opens on the whole region. */
  open(): void {
    this.overlay.hidden = false;
    this.showAll();
  }

  close(): void {
    this.overlay.hidden = true;
    this.pointers.clear();
  }

  /** Per frame: repaints after the map moved, zoomed or was resized. */
  frame(): void {
    if (!this.dirty || this.overlay.hidden || this.context === null || this.canvas.width === 0) {
      return;
    }
    this.dirty = false;
    this.painter.paint(this.context, this.viewport, this.pixelRatio, OPTIONS);
    this.overlay.dataset.scale = this.viewport.scale.toFixed(3);
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.overlay.remove();
  }

  private showAll(): void {
    const view = this.viewport;
    view.minScale = 0;
    view.maxScale = MAX_SCALE;
    view.fit(this.sketch.bounds, FIT_PADDING);
    // Zoomed out, the whole region still fills most of the screen.
    view.minScale = view.scale * 0.8;
    this.dirty = true;
  }

  private showTruck(): void {
    const view = this.viewport;
    const vehicle = this.driving.vehicle;
    view.centerX = vehicle.x;
    view.centerZ = vehicle.z;
    view.zoomAt(Math.max(1, TRUCK_SCALE / view.scale), view.width / 2, view.height / 2);
    this.changed();
  }

  private zoomBy(factor: number): void {
    this.viewport.zoomAt(factor, this.viewport.width / 2, this.viewport.height / 2);
    this.changed();
  }

  /** After a move or zoom: the middle stays over the map, and it repaints. */
  private changed(): void {
    this.viewport.keepWithin(this.sketch.bounds);
    this.dirty = true;
  }

  private fit(width: number, height: number, devicePixelRatio: number): void {
    this.pixelRatio = Math.min(MAX_PIXEL_RATIO, Math.max(1, devicePixelRatio));
    this.canvas.width = Math.round(width * this.pixelRatio);
    this.canvas.height = Math.round(height * this.pixelRatio);
    const wasFitted = this.viewport.width > 1;
    this.viewport.resize(width, height);
    if (!wasFitted && this.isOpen) {
      this.showAll();
    }
    this.dirty = true;
  }

  /** One finger drags; two pinch to zoom about their middle; the mouse wheel zooms about the pointer. */
  private bindGestures(): void {
    const canvas = this.canvas;
    canvas.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic pointers cannot be captured; dragging still works while over the map.
      }
    });
    canvas.addEventListener('pointermove', (event) => {
      const moved = this.pointers.get(event.pointerId);
      if (moved === undefined) {
        return;
      }
      const x = event.clientX;
      const y = event.clientY;
      if (this.pointers.size === 1) {
        this.viewport.panBy(x - moved.x, y - moved.y);
      } else {
        // The other finger of the pinch: zoom by how far apart they moved, about their middle, and follow the middle.
        let other: { x: number; y: number } | undefined;
        for (const [id, position] of this.pointers) {
          if (id !== event.pointerId) {
            other = position;
            break;
          }
        }
        if (other !== undefined) {
          const before = Math.hypot(moved.x - other.x, moved.y - other.y);
          const after = Math.hypot(x - other.x, y - other.y);
          const middleX = (x + other.x) / 2;
          const middleY = (y + other.y) / 2;
          if (before > 1) {
            this.viewport.zoomAt(after / before, middleX, middleY);
          }
          this.viewport.panBy((x - moved.x) / 2, (y - moved.y) / 2);
        }
      }
      moved.x = x;
      moved.y = y;
      this.changed();
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      canvas.addEventListener(type, (event) => {
        this.pointers.delete(event.pointerId);
      });
    }
    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.viewport.zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
        this.changed();
      },
      { passive: false },
    );
  }
}
