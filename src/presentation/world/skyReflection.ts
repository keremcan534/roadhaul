import type { MeshLambertMaterial, MeshPhongMaterial } from 'three';
import type { SkyUniforms } from './EnvironmentView';

export interface SkyReflectionOptions {
  /**
   * How much of the sky the surface mirrors seen head-on (Fresnel's F0):
   * about 0.04 for paint and glass, which mirror more the flatter they are
   * seen, and toward 1 for chrome.
   */
  readonly facing: number;
  /** Scales the reflection head-on and grazing alike, 0..1. Default: 1. */
  readonly strength?: number;
  /** A metal: it mirrors the sky in its own colour. Default: false. */
  readonly metal?: boolean;
  /**
   * Each vertex's `shine` attribute (0..1) scales its reflection, so parts
   * of one merged mesh can shine differently (glass, paint, rubber).
   * Default: false.
   */
  readonly perVertex?: boolean;
}

/**
 * Makes a lit `material` mirror the sky: the colours of the sky it faces,
 * from the zenith down to the horizon's haze and the darker ground below,
 * and the sun's glint, blended in more the flatter the surface is seen
 * (Fresnel). The sky is `sky`, EnvironmentView's shared uniforms, so the
 * reflections follow the weather and the time of day with no reflection map
 * to draw. Instanced meshes reflect too. A few operations a pixel; works on
 * every graphics preset. Returns the material.
 */
export function reflectSky<T extends MeshLambertMaterial | MeshPhongMaterial>(
  material: T,
  sky: SkyUniforms,
  options: SkyReflectionOptions,
): T {
  const facing = { value: options.facing };
  const strength = { value: options.strength ?? 1 };
  const defines = `${options.metal === true ? '#define SKY_METAL\n' : ''}${options.perVertex === true ? '#define SKY_SHINE\n' : ''}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms['skyZenith'] = sky.zenith;
    shader.uniforms['skyHorizon'] = sky.horizon;
    shader.uniforms['skySunColor'] = sky.sunColor;
    shader.uniforms['skySunDirection'] = sky.sunDirection;
    shader.uniforms['skyFacing'] = facing;
    shader.uniforms['skyStrength'] = strength;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${defines}${SKY_VERTEX_DECLARATIONS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${SKY_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${defines}${SKY_FRAGMENT_DECLARATIONS}`)
      .replace('#include <opaque_fragment>', `${SKY_FRAGMENT}\n#include <opaque_fragment>`);
  };
  // The defines change the program: materials that differ in them must not share one.
  material.customProgramCacheKey = () => `sky-reflection:${defines}`;
  return material;
}

const SKY_VERTEX_DECLARATIONS = /* glsl */ `
varying vec3 vSkyWorld;
#ifdef SKY_SHINE
  attribute float shine;
  varying float vShine;
#endif
`;

/** Where the fragment is in the world, instanced or not. */
const SKY_VERTEX = /* glsl */ `
vec4 skyWorld = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  skyWorld = batchingMatrix * skyWorld;
#endif
#ifdef USE_INSTANCING
  skyWorld = instanceMatrix * skyWorld;
#endif
vSkyWorld = ( modelMatrix * skyWorld ).xyz;
#ifdef SKY_SHINE
  vShine = shine;
#endif
`;

const SKY_FRAGMENT_DECLARATIONS = /* glsl */ `
uniform vec3 skyZenith;
uniform vec3 skyHorizon;
uniform vec3 skySunColor;
uniform vec3 skySunDirection;
uniform float skyFacing;
uniform float skyStrength;
varying vec3 vSkyWorld;
#ifdef SKY_SHINE
  varying float vShine;
#endif
`;

/** Before the light is written out: mix in the sky the surface mirrors. `normal` is the view-space normal. */
const SKY_FRAGMENT = /* glsl */ `
{
  vec3 skyNormal = inverseTransformDirection( normal, viewMatrix );
  vec3 skyView = normalize( vSkyWorld - cameraPosition );
  vec3 skyRay = reflect( skyView, skyNormal );
  vec3 skyColor = mix( skyHorizon, skyZenith, sqrt( clamp( skyRay.y, 0.0, 1.0 ) ) );
  // Below the horizon it mirrors the ground: darker than the haze.
  skyColor = mix( skyColor, skyHorizon * 0.28, smoothstep( 0.0, -0.25, skyRay.y ) );
  skyColor += skySunColor * pow( max( dot( skyRay, skySunDirection ), 0.0 ), 700.0 ) * 8.0;
  float skyGrazing = 1.0 - clamp( dot( -skyView, skyNormal ), 0.0, 1.0 );
  float skyAmount = ( skyFacing + ( 1.0 - skyFacing ) * pow( skyGrazing, 5.0 ) ) * skyStrength;
  #ifdef SKY_SHINE
    skyAmount *= vShine;
  #endif
  #ifdef SKY_METAL
    skyColor *= diffuseColor.rgb;
  #endif
  outgoingLight = mix( outgoingLight, skyColor, clamp( skyAmount, 0.0, 1.0 ) );
}
`;
