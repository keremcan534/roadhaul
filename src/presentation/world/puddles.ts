import type { DataTexture } from 'three';
import { puddleImage } from '../textures/proceduralImages';
import { toTexture } from '../textures/toTexture';

/**
 * Puddles on the road, shared by the road's shader (TrackView) and what the
 * water mirrors of the lamps (WetReflections), so both find them in the
 * same places: the puddle map (puddleImage) tiles every PUDDLE_TILE_METERS
 * each way, and the road's dips fill as it gets wetter, none on a road
 * less than PUDDLES_FROM wet, the water line dropping PUDDLE_DEPTH through
 * the map on a soaked one (about a sixth of the road under water). They dry
 * back as the road dries.
 */
export const PUDDLE_TILE_METERS = 18;
export const PUDDLES_FROM = 0.4;
export const PUDDLE_DEPTH = 0.3;
/** A puddle's edge: the water deepens over this much of the map past its line. */
const PUDDLE_EDGE = 0.05;

const f = (value: number): string => (Number.isInteger(value) ? `${value}.0` : `${value}`);

/**
 * GLSL: `float puddleAt( vec2 ground )`, how much of a puddle lies at
 * `ground` (the world's x, z), 0..1, with the road `puddleWetness` wet;
 * it reads `puddleMap` (createPuddleMap()). Declares both uniforms.
 */
export const PUDDLE_GLSL = /* glsl */ `
uniform sampler2D puddleMap;
uniform float puddleWetness;
float puddleAt( vec2 ground ) {
  if ( puddleWetness <= ${f(PUDDLES_FROM)} ) return 0.0;
  float waterLine = 1.0 - ${f(PUDDLE_DEPTH)} * smoothstep( ${f(PUDDLES_FROM)}, 1.0, puddleWetness );
  return smoothstep( waterLine, waterLine + ${f(PUDDLE_EDGE)}, texture2D( puddleMap, ground * ${f(1 / PUDDLE_TILE_METERS)} ).r );
}
`;

/** The puddle map as a texture, for PUDDLE_GLSL's `puddleMap`. The caller disposes it. */
export function createPuddleMap(): DataTexture {
  return toTexture(puddleImage(), { repeat: true, srgb: false });
}

/**
 * How much of a puddle the map's `value` (0..1) holds on a road `wetness`
 * wet, as PUDDLE_GLSL works it out: for tests and callers without a shader.
 */
export function puddleDepth(value: number, wetness: number): number {
  if (wetness <= PUDDLES_FROM) {
    return 0;
  }
  const t = Math.min(1, Math.max(0, (wetness - PUDDLES_FROM) / (1 - PUDDLES_FROM)));
  const waterLine = 1 - PUDDLE_DEPTH * t * t * (3 - 2 * t);
  const depth = Math.min(1, Math.max(0, (value - waterLine) / PUDDLE_EDGE));
  return depth * depth * (3 - 2 * depth);
}
