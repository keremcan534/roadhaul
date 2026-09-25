import { ACESFilmicToneMapping, PCFShadowMap, PerspectiveCamera, Scene, Vector2, Vector3, WebGLRenderer } from 'three';
import { PostProcessing, sunOnPicture, type ColorGrade } from './PostProcessing';

export interface RenderSettings {
  /** Upper bound for the device pixel ratio (fill-rate budget on phones). */
  readonly maxPixelRatio: number;
  readonly antialias: boolean;
  /** Draw through the colour pass (PostProcessing) where the device can: graded, with bloom and smooth edges. */
  readonly postProcessing: boolean;
  readonly bloom: boolean;
  readonly msaaSamples: number;
  /** The sun's real-time shadows (EnvironmentView): a shadow map this many texels square, or 0 for none. */
  readonly shadowMapSize: number;
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
   * one pixel per CSS pixel, turns off anisotropic filtering and leaves out
   * the edge smoothing; the entry point thins the plants and the shadows.
   */
  readonly softwareRendering: boolean;
  /** The GPU's name as WebGL reports it, for the performance display. */
  readonly gpu: string;
  /** The colour pass, or null where the scene goes straight to the screen (the low preset, older devices). */
  private readonly post: PostProcessing | null;
  private readonly bufferSize = new Vector2();
  /** Scratch: where the sun is, as the camera sees it (setSun). */
  private readonly sunPoint = new Vector3();
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
    // A frame is several passes: render() starts the counts of draw calls and triangles once per frame.
    this.renderer.info.autoReset = false;
    // Soft-edged (percentage-closer) shadow maps, where the preset has them. Set once: switching them later
    // would rebuild every lit shader.
    this.renderer.shadowMap.enabled = settings.shadowMapSize > 0;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.post =
      settings.postProcessing && PostProcessing.supported(this.renderer)
        ? new PostProcessing(this.renderer, {
            bloom: settings.bloom,
            // In software every sample, and every pass, costs as much as a pixel: no smoothing at all.
            msaaSamples: this.softwareRendering ? 0 : settings.msaaSamples,
            smoothing: !this.softwareRendering,
          })
        : null;
  }

  /** Whether the picture goes through the colour pass: graded, with bloom and smooth edges. */
  get postProcessing(): boolean {
    return this.post !== null;
  }

  /** How the picture is drawn, for the performance display: through the colour pass, smoothed by MSAA or FXAA, or straight. */
  get pipeline(): string {
    if (this.post === null) {
      return 'direct';
    }
    if (this.post.samples > 0) {
      return `MSAA ${this.post.samples}×`;
    }
    return this.post.fxaaSmoothing ? 'FXAA' : 'graded';
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

  /** How the colour pass grades the picture from now on (the weather's: EnvironmentView.grade). Cheap. */
  setGrade(grade: Readonly<ColorGrade>): void {
    this.post?.setGrade(grade);
  }

  /**
   * The sun lies toward `direction` (unit: it is that far off) and may glare
   * on the picture at `strength` (0..1): the colour pass draws its glare and
   * the lens's ghosts where it shows (PostProcessing.setSun); not when drawn
   * in software. Call with the camera placed for the frame. Allocation-free.
   */
  setSun(direction: Readonly<{ x: number; y: number; z: number }>, strength: number): void {
    // In software every pixel of the glare counts: none there.
    if (this.post === null || this.softwareRendering) {
      return;
    }
    this.camera.updateMatrixWorld();
    if (strength > 0 && sunOnPicture(this.camera, direction, this.sunPoint)) {
      this.post.setSun(this.sunPoint.x, this.sunPoint.y, strength);
    } else {
      this.post.setSun(-10, -10, 0);
    }
  }

  /**
   * Compiles the shaders of everything in the scene now, hidden things too
   * (the night's lamps, the rain), as render() will draw them: once, at
   * boot, so the first frames on the road do not stall compiling them (in
   * software a program takes a good part of a second). The GPU compiles them
   * while the menu shows.
   */
  precompile(): void {
    if (this.post === null) {
      this.renderer.compile(this.scene, this.camera);
    } else {
      this.post.compile(this.scene, this.camera);
    }
  }

  render(): void {
    this.renderer.info.reset();
    if (this.post === null) {
      this.renderer.render(this.scene, this.camera);
    } else {
      this.post.render(this.scene, this.camera);
    }
  }

  /**
   * Shows the picture left to right the other way, like a reversing
   * camera's (the rear camera), so the truck's right is on the screen's
   * right. Only the canvas flips: the controls and menus over it do not.
   */
  set mirrored(mirrored: boolean) {
    this.renderer.domElement.style.transform = mirrored ? 'scaleX(-1)' : '';
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
    const buffer = this.renderer.getDrawingBufferSize(this.bufferSize);
    this.post?.setSize(buffer.x, buffer.y);
    this.camera.aspect = this.cssWidth / this.cssHeight;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.post?.dispose();
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
