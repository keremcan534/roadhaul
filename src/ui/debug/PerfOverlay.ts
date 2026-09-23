/** Per-frame render counters. Declared structurally so the UI layer does not depend on three.js. */
export interface RenderStats {
  readonly calls: number;
  readonly triangles: number;
}

const REFRESH_INTERVAL_SECONDS = 0.5;

/**
 * Developer overlay (enabled with `?debug`) that shows FPS, draw calls,
 * triangles and the effective pixel ratio. It checks the 30 FPS mobile
 * target on real devices.
 */
export class PerfOverlay {
  private readonly element: HTMLDivElement;
  private frames = 0;
  private elapsedSeconds = 0;

  constructor(parent: HTMLElement) {
    this.element = parent.ownerDocument.createElement('div');
    this.element.className = 'perf-overlay';
    this.element.setAttribute('aria-hidden', 'true');
    parent.append(this.element);
  }

  /** Call once per frame after rendering. The text refreshes twice a second, so DOM work stays negligible. */
  frame(deltaSeconds: number, stats: RenderStats, pixelRatio: number): void {
    this.frames++;
    this.elapsedSeconds += deltaSeconds;
    if (this.elapsedSeconds < REFRESH_INTERVAL_SECONDS) {
      return;
    }
    const fps = this.frames / this.elapsedSeconds;
    this.element.textContent =
      `${fps.toFixed(0)} FPS · ${stats.calls} draws · ${stats.triangles} tris · ${pixelRatio.toFixed(2)}x`;
    this.frames = 0;
    this.elapsedSeconds = 0;
  }

  dispose(): void {
    this.element.remove();
  }
}
