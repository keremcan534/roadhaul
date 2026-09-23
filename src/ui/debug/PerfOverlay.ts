import type { VehiclePose } from '../../systems/driving/DrivingService';

/** Per-frame render counters. Declared structurally so the UI layer does not depend on three.js. */
export interface RenderStats {
  readonly calls: number;
  readonly triangles: number;
}

const REFRESH_INTERVAL_SECONDS = 0.5;

/**
 * Developer overlay (enabled with `?debug`) that shows FPS, draw calls,
 * triangles and the effective pixel ratio, which check the 30 FPS mobile
 * target on real devices, and the truck's position and heading, for placing
 * things on maps. The end-to-end tests read the heading to check steering.
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
      `x ${truck.x.toFixed(1)} z ${truck.z.toFixed(1)} · ${headingDegrees.toFixed(1)}°`;
    this.frames = 0;
    this.elapsedSeconds = 0;
  }

  dispose(): void {
    this.element.remove();
  }
}
