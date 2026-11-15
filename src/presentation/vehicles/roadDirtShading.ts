import type { MeshLambertMaterial, MeshPhongMaterial } from 'three';

/**
 * The road's grime on a truck (TruckView.setDirt, RoadDirtService), shaded
 * over its materials' colour: on the body the spray the wheels throw up,
 * heaviest low down and climbing higher the dirtier it is (up the box's
 * sides when it is caked), its top in uneven runs along the truck, in
 * specks, with a film over all of it as it gets filthy; on the rims an
 * even coat. The parts' own heights (their geometry's y,
 * from the ground) say where. Costs nothing on a clean truck (a branch on
 * the uniform).
 */
const DIRT_COLOR = 'vec3( 0.19, 0.155, 0.12 )';
const BODY_DIRT = /* glsl */ `
  if ( roadDirt > 0.0 ) {
    vec3 p = vDirtPosition;
    // Runs of grime down the sides: the band's top wavers along the truck, higher the dirtier it is.
    float runs = 0.5 + 0.35 * sin( p.z * 5.3 + sin( p.z * 1.7 ) * 2.0 ) + 0.15 * sin( p.z * 17.0 + p.x );
    float speck = fract( sin( dot( floor( p * 18.0 ), vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 );
    float top = mix( 1.4, 3.1, roadDirt ) + 0.5 * ( runs - 0.5 );
    float low = 1.0 - smoothstep( 0.2, top, p.y );
    float film = 0.4 * roadDirt * roadDirt;
    float grime = clamp( roadDirt * ( low * 0.95 + film ) * ( 0.82 + 0.36 * speck ), 0.0, 0.9 );
    diffuseColor.rgb = mix( diffuseColor.rgb, ${DIRT_COLOR}, grime );
  }
`;
const RIM_DIRT = /* glsl */ `
  if ( roadDirt > 0.0 ) {
    diffuseColor.rgb = mix( diffuseColor.rgb, ${DIRT_COLOR}, 0.75 * roadDirt );
  }
`;

/** Where the grime goes: the body's parts by their height, or a wheel's rim all over. */
export type DirtShading = 'body' | 'rim';

/**
 * Shades `material` with the road's grime, `dirt` (0..1) of it: after
 * whatever its shader already does (the sky's reflection), its program
 * kept apart from the clean materials'. Call once per material.
 */
export function shadeRoadDirt(material: MeshPhongMaterial | MeshLambertMaterial, dirt: { value: number }, shading: DirtShading): void {
  const before = material.onBeforeCompile;
  const key = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    shader.uniforms['roadDirt'] = dirt;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDirtPosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDirtPosition = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float roadDirt;\nvarying vec3 vDirtPosition;')
      .replace('#include <color_fragment>', `#include <color_fragment>\n${shading === 'body' ? BODY_DIRT : RIM_DIRT}`);
  };
  material.customProgramCacheKey = () => `${key.call(material)}|road-dirt-${shading}`;
}
