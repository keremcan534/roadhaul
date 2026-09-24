import type { VehiclePose } from '../../systems/driving/DrivingService';

/** Per-frame render counters. Declared structurally so the UI layer does not depend on three.js. */
export interface RenderStats {
  readonly calls: number;
  readonly triangles: number;
}

const REFRESH_INTERVAL_SECONDS = 0.5;

/**
 * The performance display (with `?debug`, or switched on in Settings): FPS,
 * draw calls, triangles and the effective pixel ratio, which check the
 * 30 FPS mobile target on real devices; the truck's position and heading,
 * for placing things on maps (the end-to-end tests read the heading to check
 * steering); and `info`, the graphics preset and GPU, for test reports.
 */
export class PerfOverlay {
  private readonly element: HTMLDivElement;
  private frames = 0;
  private elapsedSeconds = 0;

  constructor(
    parent: HTMLElement,
    private readonly info: string,
  ) {
    this.element = parent.ownerDocument.createElement('div');
    this.element.className = 'perf-overlay';
    this.element.setAttribute('aria-hidden', 'true');
    this.element.hidden = true;
    parent.append(this.element);
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  /** Shown or hidden; frame() is only worth calling while shown. */
  set visible(visible: boolean) {
    this.element.hidden = !visible;
    this.frames = 0;
    this.elapsedSeconds = 0;
  }

  /** Call once per frame after rendering. The text refreshes twice a second, so DOM work stays negligible. */
  frame(deltaSeconds: number, stats: RenderStats, pixelRatio: number, truck: Readonly<VehiclePose>): void {
    this.frames++;
    this.elapsedSeconds += deltaSeconds;
    if (this.elapsedSeconds < REFRESH_INTERVAL_SECONDS) {
      return;
    }
    const fps = this.frames / this.elapsedSeconds;
    // Map convention: 0° faces +Z, 90° faces +X; turning left increases the heading.
    const headingDegrees = ((((truck.heading * 180) / Math.PI) % 360) + 360) % 360;
    this.element.textContent =
      `${fps.toFixed(0)} FPS · ${stats.calls} draws · ${stats.triangles} tris · ${pixelRatio.toFixed(2)}x\n` +
      `x ${truck.x.toFixed(1)} z ${truck.z.toFixed(1)} · ${headingDegrees.toFixed(1)}°\n` +
      this.info;
    this.frames = 0;
    this.elapsedSeconds = 0;
  }

  dispose(): void {
    this.element.remove();
  }
}
