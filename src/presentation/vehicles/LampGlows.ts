import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  PointsMaterial,
  type DataTexture,
} from 'three';
import { glowImage } from '../textures/proceduralImages';
import { toTexture } from '../textures/toTexture';

/** The glows' opacity with the lamps fully on. */
const FULL_OPACITY = 0.9;

/**
 * A lamp that faces one way (setFacing) glows fully seen from within about
 * 60° of the way it faces, fades out toward the side and shows no glow from
 * a little behind its face (the cosines of the angle off the way it faces).
 */
const FACING_FULL = 0.5;
const FACING_NONE = -0.2;

/** After three's vertex colours: a lamp that faces one way dims as the eye moves round behind it, and is not drawn at all from there. */
const FACING_VERTEX_PARS = /* glsl */ `
attribute vec3 facing;
`;
const FACING_COLOR = /* glsl */ `
#include <color_vertex>
float lampShown = 1.0;
if ( dot( facing, facing ) > 0.0 ) {
  vec3 lampWorld = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
  vec3 facingWorld = normalize( mat3( modelMatrix ) * facing );
  lampShown = smoothstep( ${FACING_NONE.toFixed(2)}, ${FACING_FULL.toFixed(2)}, dot( facingWorld, normalize( cameraPosition - lampWorld ) ) );
  vColor.rgb *= lampShown;
}
`;
/** Out of the clip volume: the lamp's glow costs no fill. */
const FACING_CLIP = /* glsl */ `
#include <clipping_planes_vertex>
if ( lampShown <= 0.0 ) gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );
`;

/**
 * The glow round lit lamps at night: soft, round sprites in each lamp's
 * colour, added onto what is behind them, sized in the world so farther
 * lamps look smaller. One draw call for a whole set of lamps. The owner
 * writes where the lamps are (setPosition), fixed in a vehicle's model or
 * every frame for traffic, and fades the set in and out with setLevel().
 * A lamp that faces one way (a vehicle's, setFacing) glows only toward
 * the eyes in front of it: seen from behind, a headlight's glow would show
 * round the vehicle's body. Hidden (no draw call) while the lamps are off.
 */
export class LampGlows {
  readonly points: Points;
  private readonly geometry = new BufferGeometry();
  private readonly positions: BufferAttribute;
  private readonly colors: BufferAttribute;
  private readonly facings: BufferAttribute;
  private readonly material: PointsMaterial;
  private readonly texture: DataTexture;
  private readonly color = new Color();
  private level = 0;

  /** Room for `capacity` lamps, each glow `sizeMeters` across. */
  constructor(capacity: number, sizeMeters: number) {
    this.positions = new BufferAttribute(new Float32Array(Math.max(1, capacity) * 3), 3);
    this.colors = new BufferAttribute(new Float32Array(Math.max(1, capacity) * 3), 3);
    // None: every lamp glows every way until its owner says which way it faces.
    this.facings = new BufferAttribute(new Float32Array(Math.max(1, capacity) * 3), 3);
    this.geometry.setAttribute('position', this.positions);
    this.geometry.setAttribute('color', this.colors);
    this.geometry.setAttribute('facing', this.facings);
    this.geometry.setDrawRange(0, 0);
    this.texture = toTexture(glowImage(), { srgb: false });
    this.material = new PointsMaterial({
      size: sizeMeters,
      sizeAttenuation: true,
      map: this.texture,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: AdditiveBlending,
      // Lamps shine through the haze, and keep their colour.
      fog: false,
      toneMapped: false,
    });
    this.material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${FACING_VERTEX_PARS}`)
        .replace('#include <color_vertex>', FACING_COLOR)
        .replace('#include <clipping_planes_vertex>', FACING_CLIP);
    };
    this.material.customProgramCacheKey = () => 'lamp-glows';
    this.points = new Points(this.geometry, this.material);
    // The owner moves the lamps about: bounds computed once would go stale.
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  /** How many lamps glow, from the first. */
  setCount(count: number): void {
    if (this.geometry.drawRange.count !== count) {
      this.geometry.setDrawRange(0, count);
    }
  }

  setPosition(index: number, x: number, y: number, z: number): void {
    this.positions.setXYZ(index, x, y, z);
    this.positions.needsUpdate = true;
  }

  /**
   * The way lamp `index` faces (unit, in the frame its positions are in: the
   * world for traffic, the vehicle's for a vehicle's own lamps), or (0, 0, 0)
   * for a lamp that shines every way.
   */
  setFacing(index: number, x: number, y: number, z: number): void {
    this.facings.setXYZ(index, x, y, z);
    this.facings.needsUpdate = true;
  }

  setColor(index: number, hex: number): void {
    this.color.setHex(hex);
    this.colors.setXYZ(index, this.color.r, this.color.g, this.color.b);
    this.colors.needsUpdate = true;
  }

  /** How brightly the lamps shine, 0..1: 0 hides the glows. */
  setLevel(level: number): void {
    if (level === this.level) {
      return;
    }
    this.level = level;
    this.material.opacity = level * FULL_OPACITY;
    this.points.visible = level > 0.01;
  }

  get visible(): boolean {
    return this.points.visible;
  }

  dispose(): void {
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
