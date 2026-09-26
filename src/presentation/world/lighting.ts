import { Color, Vector2, type MeshBasicMaterial } from 'three';

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
 * from the sun, longer the lower it is. For the reference sun; the decals
 * follow the sun where it stands (PrelitMaterials.shadowReach).
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

/** Below this the light is taken as this, so the albedo stays finite in the dark. */
const MIN_LIGHT = 0.01;
/**
 * A decal's shadow reaches at most this far per meter of height: the sun
 * this high (a sine) or lower casts shadows too long for a soft decal to
 * show; they fade with its light instead.
 */
const MIN_SHADOW_SUN_HEIGHT = 0.35;

/** 1 / `color`, per channel. */
function inverseOf(color: Color): Color {
  return new Color(1 / Math.max(color.r, MIN_LIGHT), 1 / Math.max(color.g, MIN_LIGHT), 1 / Math.max(color.b, MIN_LIGHT));
}

/**
 * The pre-lit materials of the views (ground, road, yards, lots) and the
 * baked shadow decals, so they follow the light when the weather changes
 * it: views add them as they build them (at a clear day's light), and
 * setLight() rescales them all. Allocation-free.
 */
export class PrelitMaterials {
  /**
   * What turns a pre-lit colour back into the surface's own (its albedo):
   * one over the light it is lit with now, a clear day's flat-ground light
   * times setLight()'s factor. Shaders that add more light (the headlights)
   * read it.
   */
  readonly albedo = { value: inverseOf(flatGroundLight()) };
  /**
   * How far the baked shadow decals reach along the ground per meter of the
   * height of what casts them (x, z): away from the key light (setSun). The
   * decals' shaders read it (shadowDecal in TrackView).
   */
  readonly shadowReach = { value: new Vector2(SHADOW_OFFSET_PER_METER.x, SHADOW_OFFSET_PER_METER.z) };
  private readonly lit: { readonly material: MeshBasicMaterial; readonly base: Color }[] = [];
  private readonly shadows: { readonly material: MeshBasicMaterial; readonly opacity: number }[] = [];
  private readonly clearDay = flatGroundLight();

  /** Follows the light from now on. Returns the material. */
  add(material: MeshBasicMaterial): MeshBasicMaterial {
    this.lit.push({ material, base: material.color.clone() });
    return material;
  }

  /** Whether `material` is pre-lit here (add()). */
  has(material: MeshBasicMaterial): boolean {
    return this.lit.some((entry) => entry.material === material);
  }

  /** A shadow decal: it fades with the sunlight. Returns the material. */
  addShadow(material: MeshBasicMaterial): MeshBasicMaterial {
    this.shadows.push({ material, opacity: material.opacity });
    return material;
  }

  /** The key light stands toward `direction` (x, y, z; y up): the shadow decals fall away from it. Allocation-free. */
  setSun(direction: Readonly<{ x: number; y: number; z: number }>): void {
    const height = Math.max(direction.y, MIN_SHADOW_SUN_HEIGHT);
    this.shadowReach.value.set(-direction.x / height, -direction.z / height);
  }

  /**
   * `light` is the light on flat ground as a factor of a clear day's (per
   * colour channel); `sun` how strong the sun is, 0..1, which is how dark
   * the shadows are.
   */
  setLight(light: Color, sun: number): void {
    const albedo = this.albedo.value;
    albedo.r = 1 / Math.max(this.clearDay.r * light.r, MIN_LIGHT);
    albedo.g = 1 / Math.max(this.clearDay.g * light.g, MIN_LIGHT);
    albedo.b = 1 / Math.max(this.clearDay.b * light.b, MIN_LIGHT);
    for (let i = 0; i < this.lit.length; i++) {
      const entry = this.lit[i]!;
      entry.material.color.copy(entry.base).multiply(light);
    }
    for (let i = 0; i < this.shadows.length; i++) {
      const entry = this.shadows[i]!;
      entry.material.opacity = entry.opacity * sun;
    }
  }
}

/**
 * The sun's share of the light on flat ground (0..1) with the sun at
 * `sunlight` and the sky at `skylight` of a clear day's: what a cloud's
 * shadow can take away (CloudShadows.setClouds).
 */
export function sunShareOfGroundLight(sunlight: number, skylight: number): number {
  const sun = FLAT_LIGHT_PARTS.sun.g * Math.max(0, sunlight);
  const sky = FLAT_LIGHT_PARTS.sky.g * Math.max(0, skylight);
  return sun / Math.max(sun + sky, 1e-6);
}

/**
 * Light on flat, upward-facing ground with the sun at `sunlight` and the sky
 * at `skylight` of a clear day's, tinted `tint`, as a factor of a clear
 * day's flat-ground light: what PrelitMaterials.setLight() takes. Writes
 * into `out`.
 */
export function relativeGroundLight(sunlight: number, skylight: number, tint: Color, out: Color): Color {
  const { sky, sun } = FLAT_LIGHT_PARTS;
  out.r = ((sky.r * skylight + sun.r * sunlight) * tint.r) / (sky.r + sun.r);
  out.g = ((sky.g * skylight + sun.g * sunlight) * tint.g) / (sky.g + sun.g);
  out.b = ((sky.b * skylight + sun.b * sunlight) * tint.b) / (sky.b + sun.b);
  return out;
}

/** The sky's and the sun's shares of the light on flat ground, as linear colours (constants). */
const FLAT_LIGHT_PARTS = (() => {
  const sky = new Color(SKY_LIGHT_COLOR).multiplyScalar(SKY_LIGHT_INTENSITY);
  const sun = new Color(SUN_COLOR).multiplyScalar(SUN_INTENSITY * SUN_DIRECTION.y);
  return Object.freeze({
    sky: Object.freeze({ r: sky.r, g: sky.g, b: sky.b }),
    sun: Object.freeze({ r: sun.r, g: sun.g, b: sun.b }),
  });
})();
