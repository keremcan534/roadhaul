import { Color, Mesh, Vector3, type Material, type Object3D } from 'three';
import { isUnlitByLamps } from './LampLighting';

/**
 * The mist lies on the ground and thins upward: a meter of air this high
 * holds 1/e of the ground's. From the truck's cab it hides the far land and
 * the feet of what stands in it, while treetops, masts and the hills rise
 * out of it.
 */
export const MIST_THICKNESS_METERS = 6;
/**
 * At full mist, the share of the light a meter of air at the ground takes:
 * from the cab, a sixth of what lies on the ground 40 m off is lost in it,
 * over two fifths at 120 m, three quarters at 300 m.
 */
export const MIST_DENSITY = 0.006;
/** The sky's mist lies this far off: along the horizon it shows as a white band, thinning upward. */
export const MIST_SKY_METERS = 1200;

/**
 * The mist's GLSL: its uniforms (Mist.uniforms); mistAmount(), how much of
 * the light from `offset` meters away from the camera (world axes) the mist
 * takes; mistLight(), the mist's own light that way; and mistOver(), a
 * linear `color` seen through it. The density at a height falls off
 * exponentially, so along a straight line it has a closed form: the
 * density at the camera's height times the line's length, times the mean
 * of the falloff between the two heights. The mist's light is the sky's
 * (`mistColor`), and toward the sun it glows (`mistGlow`: sunlight
 * scattered forward by the droplets).
 */
export const MIST_GLSL = /* glsl */ `
  uniform float mistDensity;
  uniform vec3 mistColor;
  uniform vec3 mistGlow;
  uniform vec3 mistSun;
  float mistAmount( vec3 offset ) {
    // Heights in thicknesses, never far under the ground (the sea's surface lies a little under it).
    float eye = max( cameraPosition.y, -2.0 ) * ${(1 / MIST_THICKNESS_METERS).toFixed(6)};
    float end = max( cameraPosition.y + offset.y, -2.0 ) * ${(1 / MIST_THICKNESS_METERS).toFixed(6)};
    float rise = end - eye;
    float mean = abs( rise ) < 1e-3 ? exp( - eye ) * ( 1.0 - 0.5 * rise ) : ( exp( - eye ) - exp( - end ) ) / rise;
    return 1.0 - exp( - mistDensity * length( offset ) * mean );
  }
  vec3 mistLight( vec3 offset ) {
    float toward = max( dot( offset, mistSun ) / max( length( offset ), 1e-3 ), 0.0 );
    float broad = toward * toward;
    broad *= broad;
    float tight = broad * broad * broad;
    return mistColor + mistGlow * ( 0.35 * broad + 0.65 * tight );
  }
  vec3 mistOver( vec3 color, vec3 offset ) {
    return mix( color, mistLight( offset ), mistAmount( offset ) );
  }
`;

/**
 * The morning mist (roadmap: graphics): a layer on the ground over the
 * whole land, drawn by every surface that takes the fog as it takes it,
 * right after the fog: no pass, no draw call, a few instructions per pixel,
 * and none of them without mist (a uniform branch). The sky and its hills
 * take it too (EnvironmentView, with these uniforms). The uniforms are
 * shared, so set() costs nothing per material.
 */
export class Mist {
  readonly uniforms = {
    /** The share of the light a meter of air at the ground takes: 0, no mist. */
    mistDensity: { value: 0 },
    /** The mist's light away from the sun… */
    mistColor: { value: new Color() },
    /** …and how much more toward it. */
    mistGlow: { value: new Color() },
    /** Toward the sun (unit). */
    mistSun: { value: new Vector3(0, 1, 0) },
  };
  private readonly misted = new WeakSet<Material>();

  /**
   * The mist lies `amount` thick (0..1: none … a morning's full mist), its
   * light `color`, glowing `glow` more toward the sun, which lies toward
   * `towardSun` (unit). Cheap: it writes the shared uniforms.
   */
  set(amount: number, color: Readonly<Color>, glow: Readonly<Color>, towardSun: Readonly<Vector3>): void {
    const uniforms = this.uniforms;
    uniforms.mistDensity.value = MIST_DENSITY * Math.min(1, Math.max(0, amount));
    uniforms.mistColor.value.copy(color);
    uniforms.mistGlow.value.copy(glow);
    uniforms.mistSun.value.copy(towardSun);
  }

  /**
   * Everything under `root` that takes the fog takes the mist from now on,
   * right after the fog. Leaves out the sky's backdrop (unlitByLamps: the
   * sky takes the mist its own way). Once per material, chained after what
   * it does to its shaders already: at boot, when the views have set
   * theirs, and for views built later (the truck); not per frame.
   */
  shadeScene(root: Object3D): void {
    if (isUnlitByLamps(root)) {
      return;
    }
    if (root instanceof Mesh) {
      for (const material of [root.material as Material | Material[]].flat()) {
        this.shade(material);
      }
    }
    for (const child of root.children) {
      this.shadeScene(child);
    }
  }

  private shade(material: Material): void {
    if (this.misted.has(material) || isUnlitByLamps(material)) {
      return;
    }
    this.misted.add(material);
    const previous = material.onBeforeCompile.bind(material);
    const key = material.customProgramCacheKey();
    material.onBeforeCompile = (shader, renderer) => {
      previous(shader, renderer);
      mistShader(shader, this.uniforms);
    };
    material.customProgramCacheKey = () => `${key}|mist`;
  }
}

/**
 * Adds the mist to a shader that takes the fog (three.js's fog chunks):
 * the world's offset from the camera, from the view position the fog
 * reads, and the mist over the colour right after the fog. The fog comes
 * after the colour is made ready for its target (tone mapped and encoded
 * for the screen, or left linear for the colour pass), so the mist's light
 * is made ready the same way first. Shaders without the fog's chunks are
 * left as they are. Exported for tests.
 */
export function mistShader(
  shader: { uniforms: Record<string, { value: unknown }>; vertexShader: string; fragmentShader: string },
  uniforms: Mist['uniforms'],
): void {
  const chunks = ['#include <fog_pars_vertex>', '#include <fog_vertex>'];
  const fragmentChunks = ['#include <fog_pars_fragment>', '#include <fog_fragment>'];
  if (!chunks.every((chunk) => shader.vertexShader.includes(chunk)) || !fragmentChunks.every((chunk) => shader.fragmentShader.includes(chunk))) {
    return;
  }
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <fog_pars_vertex>', '#include <fog_pars_vertex>\n#ifdef USE_FOG\n  varying vec3 vMistOffset;\n#endif')
    .replace(
      '#include <fog_vertex>',
      // The camera's view turned back into the world's axes: where the vertex is from the camera.
      '#include <fog_vertex>\n#ifdef USE_FOG\n  vMistOffset = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;\n#endif',
    );
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <fog_pars_fragment>', `#include <fog_pars_fragment>\n#ifdef USE_FOG\n  varying vec3 vMistOffset;\n${MIST_GLSL}\n#endif`)
    .replace(
      '#include <fog_fragment>',
      `#include <fog_fragment>
#ifdef USE_FOG
  if ( mistDensity > 0.0 ) {
    vec3 mistShade = mistLight( vMistOffset );
    #ifdef TONE_MAPPING
      mistShade = toneMapping( mistShade );
    #endif
    gl_FragColor.rgb = mix( gl_FragColor.rgb, linearToOutputTexel( vec4( mistShade, 1.0 ) ).rgb, mistAmount( vMistOffset ) );
  }
#endif`,
    );
}
