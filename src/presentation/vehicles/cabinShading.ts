import { Color, Vector3, type MeshBasicMaterial } from 'three';
import { smoothstep } from '../../core/math/scalar';
import type { SceneLight } from '../world/EnvironmentView';

/**
 * The cab's inside lit as it is under a roof: the sky and the ground only
 * through the glass, the sun (or the moon) only when it shines in through
 * the windscreen or a side window, never through the roof or the back wall;
 * and at night the instruments' glow. Per vertex, like three.js's Lambert
 * shading, but it lights what the scene's lights would light wrongly (a
 * dashboard in the sun under the roof) and costs a handful of instructions.
 */

/**
 * Inside, a face turned up takes this share of the sky light's colour (the
 * sky through the glass, off the pale roof lining), half-way to grey (the
 * cab's own colours tint what they bounce): the cab as the eye, adapted to
 * it, sees it, not the dark box a camera exposed for the road would.
 */
const INSIDE_SKY = 0.62;
const INSIDE_GREY = 0.5;
/** A face turned down takes the ground's light through the glass, and this share of the sky's off the floor and seats. */
const INSIDE_GROUND = 0.9;
const INSIDE_BOUNCE = 0.3;
/**
 * In the dark the eye has nothing brighter to adapt from: with the lamps
 * fully on (night) the cab takes only this share of the day's lift.
 */
const NIGHT_ADAPTATION = 0.35;
/** The side windows are smaller than the windscreen: the sun through them lights this much. */
const SIDE_WINDOW_SHARE = 0.8;
/** At night the instruments and switches light the cab a little: this much warm light at the lamps' full level. */
const NIGHT_FILL: readonly [number, number, number] = [0.012, 0.0095, 0.0075];
/** How brightly what glows (the atlas's alpha) shines by day and at night: displays and markings are backlit. */
const DAY_GLOW = 0.25;
const NIGHT_GLOW = 0.85;

/** The cabin light as shader uniforms, shared by the cab's materials. */
export interface CabinLightUniforms {
  /** What lights a face turned up (the sky through the glass) and down (the ground and the floor). */
  readonly cabinSky: { readonly value: Color };
  readonly cabinGround: { readonly value: Color };
  /** The key light as far as it shines in (over π), and where it comes from (world, unit). */
  readonly cabinKey: { readonly value: Color };
  readonly cabinKeyDirection: { readonly value: Vector3 };
  /** Light from every side: the instruments' at night. */
  readonly cabinFill: { readonly value: Color };
  /** How brightly what glows shines (times its own colour). */
  readonly cabinGlow: { readonly value: Color };
}

export function createCabinLight(): CabinLightUniforms {
  return {
    cabinSky: { value: new Color(0.3, 0.3, 0.3) },
    cabinGround: { value: new Color(0.2, 0.2, 0.2) },
    cabinKey: { value: new Color(0, 0, 0) },
    cabinKeyDirection: { value: new Vector3(0, 1, 0) },
    cabinFill: { value: new Color(0, 0, 0) },
    cabinGlow: { value: new Color(DAY_GLOW, DAY_GLOW, DAY_GLOW) },
  };
}

/**
 * How much of the key light from `keyDirection` (world, unit) shines into
 * the cab of a truck heading `heading` (0 faces +z): through the windscreen
 * from ahead, through the side windows from either side, as long as it is
 * not so high that the roof shades it; none from behind.
 */
export function keyLightInside(keyDirection: Readonly<{ x: number; y: number; z: number }>, heading: number): number {
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  const ahead = keyDirection.x * sin + keyDirection.z * cos;
  const aside = Math.abs(keyDirection.x * cos - keyDirection.z * sin);
  const up = keyDirection.y;
  const windscreen = smoothstep(0.02, 0.25, ahead) * (1 - smoothstep(0.82, 0.97, up));
  const sideWindows = SIDE_WINDOW_SHARE * smoothstep(0.3, 0.6, aside) * (1 - smoothstep(0.55, 0.8, up));
  return Math.max(windscreen, sideWindows);
}

/**
 * Sets the cab's light from the scene's (`light`, as the sky and the key
 * light stand now) for a truck heading `heading`, with its lamps on at
 * `lamps` (0..1: the dashboard lights up with them). Allocation-free.
 */
export function lightCabin(uniforms: CabinLightUniforms, light: SceneLight, heading: number, lamps: number): void {
  const sky = light.sky;
  const grey = (sky.r + sky.g + sky.b) / 3;
  const adapted = 1 + (NIGHT_ADAPTATION - 1) * lamps;
  const up = uniforms.cabinSky.value;
  up.setRGB(sky.r + (grey - sky.r) * INSIDE_GREY, sky.g + (grey - sky.g) * INSIDE_GREY, sky.b + (grey - sky.b) * INSIDE_GREY);
  up.multiplyScalar(INSIDE_SKY * adapted);
  const down = uniforms.cabinGround.value;
  down.copy(light.ground).multiplyScalar(INSIDE_GROUND);
  down.r += grey * INSIDE_BOUNCE;
  down.g += grey * INSIDE_BOUNCE;
  down.b += grey * INSIDE_BOUNCE;
  down.multiplyScalar(adapted);
  uniforms.cabinKey.value.copy(light.key).multiplyScalar(keyLightInside(light.keyDirection, heading) / Math.PI);
  uniforms.cabinKeyDirection.value.copy(light.keyDirection);
  uniforms.cabinFill.value.setRGB(NIGHT_FILL[0] * lamps, NIGHT_FILL[1] * lamps, NIGHT_FILL[2] * lamps);
  uniforms.cabinGlow.value.setScalar(DAY_GLOW + (NIGHT_GLOW - DAY_GLOW) * lamps);
}

const VERTEX_PARS = /* glsl */ `
uniform vec3 cabinSky;
uniform vec3 cabinGround;
uniform vec3 cabinKey;
uniform vec3 cabinKeyDirection;
uniform vec3 cabinFill;
varying vec3 vCabinLight;
`;

const VERTEX = /* glsl */ `
vec3 cabinNormal = normal;
#ifdef USE_INSTANCING
  cabinNormal = mat3( instanceMatrix ) * cabinNormal;
#endif
cabinNormal = normalize( mat3( modelMatrix ) * cabinNormal );
vCabinLight = mix( cabinGround, cabinSky, cabinNormal.y * 0.5 + 0.5 )
  + cabinKey * max( dot( cabinNormal, cabinKeyDirection ), 0.0 )
  + cabinFill;
`;

const FRAGMENT_PARS = /* glsl */ `
uniform vec3 cabinGlow;
varying vec3 vCabinLight;
`;

/** The atlas's colour, and its alpha as what glows (the material stays opaque). */
const MAP_FRAGMENT = /* glsl */ `
float cabinGlowMask = 0.0;
#ifdef USE_MAP
  vec4 cabinTexel = texture2D( map, vMapUv );
  diffuseColor.rgb *= cabinTexel.rgb;
  cabinGlowMask = cabinTexel.a;
#endif
`;

const FRAGMENT = /* glsl */ `
outgoingLight = outgoingLight * vCabinLight + diffuseColor.rgb * cabinGlowMask * cabinGlow;
`;

/**
 * Shades `material` (unlit, with the cab's atlas and vertex colours) by the
 * cabin light in `uniforms` instead of drawing its colours flat. Before it
 * first renders.
 */
export function shadeCabin(material: MeshBasicMaterial, uniforms: CabinLightUniforms): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <map_fragment>', MAP_FRAGMENT)
      .replace('#include <opaque_fragment>', `${FRAGMENT}\n#include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => 'cabin-shading';
}
