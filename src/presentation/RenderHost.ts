import { ACESFilmicToneMapping, PerspectiveCamera, Scene, WebGLRenderer } from 'three';

export interface RenderSettings {
  /** Upper bound for the device pixel ratio (fill-rate budget on phones). */
  readonly maxPixelRatio: number;
  readonly antialias: boolean;
}

/** Renderer names of WebGL implementations that run on the CPU instead of a GPU. */
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render driver/i;

/**
 * Owns the WebGL renderer, the scene graph root and the active camera.
 * Views add objects to `scene`; nothing outside the presentation layer
 * touches three.js directly.
 */
export class RenderHost {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(55, 1, 0.5, 1000);
  /**
   * True when WebGL is emulated on the CPU (no GPU acceleration, headless
   * test browsers). Every pixel is then expensive, so the host renders at
   * one pixel per CSS pixel and turns off anisotropic filtering.
   */
  readonly softwareRendering: boolean;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly settings: RenderSettings,
  ) {
    // Throws if WebGL is unavailable. The entry point reports that to the player.
    this.renderer = new WebGLRenderer({ canvas, antialias: settings.antialias });
    // Filmic tone mapping: bright sky and sunlit paint roll off softly instead of clipping.
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.softwareRendering = SOFTWARE_RENDERER.test(rendererName(this.renderer.getContext()));
  }

  /** Texture anisotropy to use: the GPU's maximum, up to 4, or 1 when rendering in software. */
  get anisotropy(): number {
    return this.softwareRendering ? 1 : Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
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
    const cap = this.softwareRendering ? Math.min(1, this.settings.maxPixelRatio) : this.settings.maxPixelRatio;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, cap));
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

/** The GPU's name. Browsers that hide it behind a generic name report it through a debug extension. */
function rendererName(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  const name = String(gl.getParameter(gl.RENDERER));
  if (!/^webkit webgl$/i.test(name)) {
    return name;
  }
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return info === null ? name : String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
}
