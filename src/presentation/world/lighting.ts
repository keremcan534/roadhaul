import { Color } from 'three';

/**
 * The scene's light, shared by the lights themselves, the sky's sun glow, the
 * baked shadow decals and the pre-lit flat ground, so they all agree.
 * Morning sun from the south-east, fairly high: soft, readable shading.
 */
const x = -0.42;
const y = 0.74;
const z = 0.52;
const length = Math.hypot(x, y, z);

/** Direction from the ground toward the sun (normalised). */
export const SUN_DIRECTION = Object.freeze({ x: x / length, y: y / length, z: z / length });
export const SUN_COLOR = 0xfff1d6;
export const SUN_INTENSITY = 2.6;
export const SKY_LIGHT_COLOR = 0xd6e8ff;
export const GROUND_LIGHT_COLOR = 0x5b5236;
export const SKY_LIGHT_INTENSITY = 1.15;

/**
 * Horizontal offset of a shadow per meter of object height: shadows fall away
 * from the sun, longer the lower it is.
 */
export const SHADOW_OFFSET_PER_METER = Object.freeze({
  x: -SUN_DIRECTION.x / SUN_DIRECTION.y,
  z: -SUN_DIRECTION.z / SUN_DIRECTION.y,
});

/**
 * How brightly the lights above render a flat, upward-facing surface, as a
 * linear colour factor. It is exactly what three.js's Lambert shading
 * computes for a normal pointing up (sky light at full weight, sun at its
 * elevation, both divided by π). Unlit materials tinted with it look the
 * same as lit ones, without per-pixel lighting on the largest surfaces on
 * screen: ground, road and shoulders.
 */
export function flatGroundLight(): Color {
  const sky = new Color(SKY_LIGHT_COLOR).multiplyScalar(SKY_LIGHT_INTENSITY);
  const sun = new Color(SUN_COLOR).multiplyScalar(SUN_INTENSITY * SUN_DIRECTION.y);
  return sky.add(sun).multiplyScalar(1 / Math.PI);
}
