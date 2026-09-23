import { PerspectiveCamera, Scene, WebGLRenderer } from 'three';

export interface RenderSettings {
  /** Upper bound for the device pixel ratio (fill-rate budget on phones). */
  readonly maxPixelRatio: number;
  readonly antialias: boolean;
}

/**
 * Owns the WebGL renderer, the scene graph root and the active camera.
 * Views add objects to `scene`; nothing outside the presentation layer
 * touches three.js directly.
 */
export class RenderHost {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(55, 1, 0.5, 1000);

  constructor(
    canvas: HTMLCanvasElement,
    private readonly settings: RenderSettings,
  ) {
    // Throws if WebGL is unavailable. The entry point reports that to the player.
    this.renderer = new WebGLRenderer({ canvas, antialias: settings.antialias });
  }

  /** Draw calls and triangles of the last frame (three.js reuses this object). */
  get renderStats(): WebGLRenderer['info']['render'] {
    return this.renderer.info.render;
  }

  get pixelRatio(): number {
    return this.renderer.getPixelRatio();
  }

  /** Matches the drawing buffer to the canvas's CSS size, capping the pixel ratio. */
  setSize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void {
    if (cssWidth <= 0 || cssHeight <= 0) {
      return; // Not laid out yet (hidden tab, zero-size container).
    }
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.settings.maxPixelRatio));
    this.renderer.setSize(cssWidth, cssHeight, false);
    this.camera.aspect = cssWidth / cssHeight;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
