import {
  BoxGeometry,
  CylinderGeometry,
  FrontSide,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Color,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp01, smoothstep } from '../../core/math/scalar';

/** A wiper's blade turns from where it is parked, flat along the foot of the glass, up to this angle and back. */
export const SWEEP_RADIANS = (105 * Math.PI) / 180;
/** One sweep up and back, seconds. */
export const SWEEP_SECONDS = 1.25;
/** In light rain the wipers wait up to this long between sweeps; in heavy rain they do not stop. */
const LONGEST_PAUSE_SECONDS = 5;
/** Below this much rain the wipers stay parked. */
const RAIN_TO_WIPE = 0.05;
/** A drop forms on a spot of the glass within this many seconds of heavy rain after it was wiped (longer in lighter rain). */
const DROP_FILL_SECONDS = 3;
/** The wipes are told apart (and their drops placed anew) by their number modulo this. */
const WIPE_NUMBERS = 64;
const WIPER_COLOR = 0x16181b;

/** Where the windscreen is, in the truck's frame (x left, y up, z forward): what the wipers sweep. */
export interface WindscreenPlace {
  /** Its width across the cab and its bottom and top edges, meters. */
  readonly width: number;
  readonly bottom: number;
  readonly top: number;
  /** The glass's plane, meters forward of the rear axle. */
  readonly z: number;
}

/**
 * The blade's angle up from parked (radians) `phase` seconds into a sweep:
 * up and back in SWEEP_SECONDS, easing at both ends; parked after it.
 */
export function bladeAngle(phase: number): number {
  if (phase <= 0 || phase >= SWEEP_SECONDS) {
    return 0;
  }
  return (SWEEP_RADIANS * (1 - Math.cos((2 * Math.PI * phase) / SWEEP_SECONDS))) / 2;
}

/**
 * Seconds since the blade last passed `fraction` (0..1) of its sweep, when
 * it is `phase` seconds into its current sweep and the previous one began
 * `previousGap` seconds before this one: it passes each spot on its way up
 * and again on its way back. The glass's shader works the same out for
 * every pixel.
 */
export function secondsSinceWiped(fraction: number, phase: number, previousGap: number): number {
  const up = (SWEEP_SECONDS * Math.acos(1 - 2 * clamp01(fraction))) / (2 * Math.PI);
  const down = SWEEP_SECONDS - up;
  if (phase >= down) {
    return phase - down;
  }
  if (phase >= up) {
    return phase - up;
  }
  return phase + previousGap - down;
}

/** How long the wipers wait between sweeps in `rain` (0..1). */
export function wiperPause(rain: number): number {
  return LONGEST_PAUSE_SECONDS * (1 - smoothstep(0.1, 0.75, rain));
}

/**
 * The windscreen's two wipers (tandem, as on a left-hand-drive cab: parked
 * along the foot of the glass pointing to the right, sweeping up toward the
 * driver's pillar), and the windscreen as the driver sees it from inside:
 * the tinted band along its top, and in the rain the drops that gather on it
 * and that the blades wipe away where they pass (the corners they never
 * reach stay wet). In light rain the wipers pause between sweeps, in heavy
 * rain they run on; with no rain they park.
 *
 * `blades` belong on the truck's body; `glass` is only for the cabin view.
 * One draw call each. update() allocates nothing.
 */
export class Wipers {
  readonly blades: InstancedMesh;
  readonly glass: Mesh;
  private readonly pivots: readonly Vector2[];
  private readonly pivotZ: number;
  private readonly glassUniforms: {
    readonly pivotA: { value: Vector2 };
    readonly pivotB: { value: Vector2 };
    readonly radii: { value: Vector2 };
    readonly sweep: { value: number };
    readonly sweepSeconds: { value: number };
    readonly phase: { value: number };
    readonly previousGap: { value: number };
    readonly wipe: { value: number };
    readonly rain: { value: number };
    readonly fillSeconds: { value: number };
    readonly shadeFrom: { value: number };
    readonly shadeTo: { value: number };
    readonly horizon: { value: Color };
  };
  /** Seconds since the current (or last) sweep began, and between the one before and it. */
  private phase = 1e4;
  private previousGap = 1e4;
  private wipes = 0;
  private rain = 0;
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly axis = new Vector3(0, 0, 1);
  private readonly scale = new Vector3(1, 1, 1);

  constructor(place: WindscreenPlace, horizon: { readonly value: Color }) {
    const height = place.top - place.bottom;
    const inner = height * 0.28;
    const outer = height * 0.97;
    const pivotY = place.bottom - 0.03;
    // The driver's wiper sweeps in front of the driver (left, +x); the other the rest, overlapping in the middle.
    this.pivots = [new Vector2(place.width * 0.3, pivotY), new Vector2(-place.width * 0.08, pivotY)];
    this.pivotZ = place.z + 0.03;

    // A blade along −x from its pivot: the spindle, the arm out to the blade's middle, and the blade against the glass.
    const parts: BufferGeometry[] = [
      new CylinderGeometry(0.025, 0.025, 0.05, 10).rotateX(Math.PI / 2),
      new BoxGeometry((inner + outer) / 2, 0.018, 0.014).translate(-(inner + outer) / 4, 0, 0.004),
      new BoxGeometry(outer - inner, 0.022, 0.02).translate(-(inner + outer) / 2, 0, -0.012),
    ];
    const geometry = mergeGeometries(parts);
    for (const part of parts) {
      part.dispose();
    }
    this.blades = new InstancedMesh(geometry, new MeshLambertMaterial({ color: WIPER_COLOR }), this.pivots.length);
    this.blades.name = 'wipers';
    this.placeBlades(0);

    this.glassUniforms = {
      pivotA: { value: this.pivots[0]!.clone() },
      pivotB: { value: this.pivots[1]!.clone() },
      radii: { value: new Vector2(inner, outer) },
      sweep: { value: SWEEP_RADIANS },
      sweepSeconds: { value: SWEEP_SECONDS },
      phase: { value: this.phase },
      previousGap: { value: this.previousGap },
      wipe: { value: 0 },
      rain: { value: 0 },
      fillSeconds: { value: DROP_FILL_SECONDS },
      shadeFrom: { value: place.top - 0.16 },
      shadeTo: { value: place.top - 0.02 },
      horizon,
    };
    // Just inside the glass, facing the driver, in the truck's own frame (its shader reads the positions as such).
    const glassGeometry = new PlaneGeometry(place.width, height).rotateY(Math.PI).translate(0, (place.bottom + place.top) / 2, place.z - 0.012);
    this.glass = new Mesh(
      glassGeometry,
      new ShaderMaterial({
        uniforms: this.glassUniforms,
        transparent: true,
        depthWrite: false,
        side: FrontSide,
        vertexShader: GLASS_VERTEX,
        fragmentShader: GLASS_FRAGMENT,
      }),
    );
    this.glass.name = 'windscreen-inside';
    // Over the rest of the see-through (the rain's streaks outside are drawn later, but none fall inside the cab).
    this.glass.renderOrder = 1;
  }

  /** Whether the blades are on a sweep (not parked, nor pausing between sweeps). */
  get sweeping(): boolean {
    return this.phase < SWEEP_SECONDS;
  }

  /** The blades' angle up from parked, radians. */
  get angle(): number {
    return bladeAngle(this.phase);
  }

  /**
   * Runs the wipers in `rain` (0..1, the weather's) for `deltaSeconds`: a
   * sweep, then a pause as long as the rain is light, and the glass's drops
   * with them. A sweep under way always finishes. Allocation-free.
   */
  update(deltaSeconds: number, rain: number): void {
    this.rain = clamp01(rain);
    this.phase += Math.max(0, deltaSeconds);
    if (this.rain >= RAIN_TO_WIPE && this.phase >= SWEEP_SECONDS + wiperPause(this.rain)) {
      this.previousGap = this.phase;
      this.phase = 0;
      this.wipes = (this.wipes + 1) % WIPE_NUMBERS;
    }
    this.placeBlades(bladeAngle(this.phase));
    const u = this.glassUniforms;
    u.phase.value = Math.min(this.phase, 1e4);
    u.previousGap.value = Math.min(this.previousGap, 1e4);
    u.wipe.value = this.wipes;
    u.rain.value = this.rain;
  }

  dispose(): void {
    this.blades.geometry.dispose();
    (this.blades.material as MeshLambertMaterial).dispose();
    this.blades.dispose();
    this.glass.geometry.dispose();
    (this.glass.material as ShaderMaterial).dispose();
  }

  private placeBlades(angle: number): void {
    // Turning up from −x toward +y is a negative turn about +z.
    this.rotation.setFromAxisAngle(this.axis, -angle);
    for (let i = 0; i < this.pivots.length; i++) {
      const pivot = this.pivots[i]!;
      this.position.set(pivot.x, pivot.y, this.pivotZ);
      this.blades.setMatrixAt(i, this.matrix.compose(this.position, this.rotation, this.scale));
    }
    this.blades.instanceMatrix.needsUpdate = true;
  }
}

const GLASS_VERTEX = /* glsl */ `
varying vec2 vGlass;
void main() {
  vGlass = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const GLASS_FRAGMENT = /* glsl */ `
#include <common>
uniform vec2 pivotA;
uniform vec2 pivotB;
uniform vec2 radii;
uniform float sweep;
uniform float sweepSeconds;
uniform float phase;
uniform float previousGap;
uniform float wipe;
uniform float rain;
uniform float fillSeconds;
uniform float shadeFrom;
uniform float shadeTo;
uniform vec3 horizon;
varying vec2 vGlass;

vec4 hash42(vec2 p) {
  vec4 p4 = fract(vec4(p.xyxy) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  p4 += dot(p4, p4.wzxy + 33.33);
  return fract((p4.xxyz + p4.yzzw) * p4.zywx);
}

// Seconds since the wiper round pivot last passed here, and which wipe that was (as secondsSinceWiped in Wipers.ts);
// a long time and no wipe where it never reaches.
vec2 wiped(vec2 pivot, float blade) {
  vec2 d = vGlass - pivot;
  float r = length(d);
  float angle = atan(d.y, -d.x);
  if (r < radii.x || r > radii.y || angle < 0.0 || angle > sweep) {
    return vec2(1e4, -7.0);
  }
  float up = sweepSeconds * acos(1.0 - 2.0 * angle / sweep) / 6.2831853;
  float down = sweepSeconds - up;
  if (phase >= down) return vec2(phase - down, wipe * 4.0 + blade * 2.0 + 1.0);
  if (phase >= up) return vec2(phase - up, wipe * 4.0 + blade * 2.0);
  return vec2(phase + previousGap - down, (wipe - 1.0) * 4.0 + blade * 2.0 + 1.0);
}

// A drop in the cell (cells of size meters) under this point, formed after the wipe if it has rained long enough:
// a little lens, the sky through its lower half and the ground through its upper, a dark rim and a glint.
vec4 drop(float size, vec2 wipeAge, float seed) {
  vec2 cell = floor(vGlass / size);
  vec4 h = hash42(cell + vec2(wipeAge.y * 17.0 + seed, wipeAge.y * 31.0 - seed));
  float radius = size * mix(0.16, 0.4, h.z * h.z);
  vec2 centre = (cell + 0.5) * size + (h.xy - 0.5) * (size - 2.0 * radius);
  vec2 q = (vGlass - centre) / radius;
  float d = length(q);
  float formed = step(h.w * fillSeconds, wipeAge.x * rain);
  float inside = (1.0 - smoothstep(0.8, 1.0, d)) * formed;
  float sky = smoothstep(0.7, -0.6, q.y);
  vec3 color = mix(horizon * 0.22, horizon * 1.1, sky) * (1.0 - 0.6 * smoothstep(0.5, 0.95, d));
  float glint = 1.0 - smoothstep(0.0, 0.3, length(q - vec2(-0.3, 0.38)));
  color += glint * (0.25 + 0.6 * max(horizon.g, 0.0));
  return vec4(color, inside * (0.5 + 0.4 * glint));
}

void main() {
  // The tinted band along the top.
  float shade = smoothstep(shadeFrom, shadeTo, vGlass.y);
  vec4 color = vec4(vec3(0.02, 0.06, 0.07), 0.42 * shade);
  if (rain > 0.0) {
    vec2 a = wiped(pivotA, 0.0);
    vec2 b = wiped(pivotB, 1.0);
    vec2 wipeAge = a.x < b.x ? a : b;
    vec4 small = drop(0.028, wipeAge, 0.0);
    vec4 large = drop(0.07, wipeAge, 5.0);
    vec4 drops = small.a > large.a ? small : large;
    // The drop over the band.
    float alpha = drops.a + color.a * (1.0 - drops.a);
    color.rgb = (drops.rgb * drops.a + color.rgb * color.a * (1.0 - drops.a)) / max(alpha, 1e-4);
    color.a = alpha;
  }
  gl_FragColor = color;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
