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
  /** The GPU's name as WebGL reports it, for the performance display. */
  readonly gpu: string;
  /** Share of the capped pixel ratio drawn at (AdaptiveResolution), and the size last asked for. */
  private resolutionScale = 1;
  private cssWidth = 0;
  private cssHeight = 0;
  private devicePixelRatio = 1;
  /** The drawing buffer's size and pixel ratio as last set, to skip resizing it to the same again. */
  private appliedWidth = 0;
  private appliedHeight = 0;
  private appliedPixelRatio = 0;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly settings: RenderSettings,
  ) {
    // Throws if WebGL is unavailable. The entry point reports that to the player.
    this.renderer = new WebGLRenderer({ canvas, antialias: settings.antialias });
    // Filmic tone mapping: bright sky and sunlit paint roll off softly instead of clipping.
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.gpu = rendererName(this.renderer.getContext());
    this.softwareRendering = SOFTWARE_RENDERER.test(this.gpu);
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
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    this.devicePixelRatio = devicePixelRatio;
    this.applySize();
  }

  /** Draws at `scale` (0..1) of the capped pixel ratio from now on: fewer pixels for slow devices. */
  setResolutionScale(scale: number): void {
    this.resolutionScale = scale;
    if (this.cssWidth > 0) {
      this.applySize();
    }
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Resizes the drawing buffer, once: setPixelRatio() and setSize() would do
   * it twice. A resize waits for the GPU to finish what it was drawing (a
   * hitch), even to the same size, so an unchanged size is left alone.
   */
  private applySize(): void {
    const cap = this.softwareRendering ? Math.min(1, this.settings.maxPixelRatio) : this.settings.maxPixelRatio;
    const pixelRatio = Math.min(this.devicePixelRatio, cap) * this.resolutionScale;
    if (
      this.cssWidth === this.appliedWidth &&
      this.cssHeight === this.appliedHeight &&
      pixelRatio === this.appliedPixelRatio
    ) {
      return;
    }
    this.appliedWidth = this.cssWidth;
    this.appliedHeight = this.cssHeight;
    this.appliedPixelRatio = pixelRatio;
    this.renderer.setDrawingBufferSize(this.cssWidth, this.cssHeight, pixelRatio);
    this.camera.aspect = this.cssWidth / this.cssHeight;
    this.camera.updateProjectionMatrix();
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
