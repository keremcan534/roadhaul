import {
  Color,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  MeshStandardMaterial,
  Vector3,
  type Camera,
  type Material,
  type Object3D,
} from 'three';
import type { PrelitMaterials } from './lighting';

/** Headlights: a neutral LED white, a touch warm. */
const HEADLIGHT_COLOR = 0xfff2e2;
/**
 * A headlight's peak intensity at full level, in the scene's light units
 * (the light on a surface square to the beam one meter away). With the beam
 * pattern below, a pair lights the road just ahead of the bumper several
 * times as brightly as the moon does, half as brightly some 50 m out, and
 * fades into the dark by about 100 m (further on the right).
 */
const HEADLIGHT_PEAK = 14000;
/** Street lamps: a warm white. */
const STREET_LAMP_COLOR = 0xffcf96;
/** A street lamp's intensity straight down: the road under it about five times as bright as by the moon. */
const STREET_LAMP_PEAK = 220;
/**
 * No surface takes more light than this from one lamp (a little over twice
 * a clear day's): a camera's exposure, which the night scene does not
 * adapt, so what stands right in front of a lamp is blown out, not endless.
 */
const MOST_LIGHT = 6;
/**
 * The low beam (ECE, right-hand traffic), as tangents of angles from the
 * lamp, after measured beams: a sharp cut-off this far under the horizon on
 * the left, rising at 15° from just right of straight ahead to this far over
 * it, softened over about half a degree; the hot zone right under it, a
 * little right of ahead, narrow (its core) in a wider spread (this share of
 * it), the spread widening and taking over toward the road near the car;
 * below the hot zone the light falls as the angle down to this power, and a
 * little more near the bumper; a little stray light over the cut-off.
 */
const BEAM = {
  cutoff: 0.01,
  kinkFrom: 0.01,
  kinkSlope: 0.27,
  kinkTop: 0.012,
  soft: [-0.003, 0.004],
  hot: 0.015,
  falloff: 1.8,
  foreground: { from: 0.15, to: 0.4, loss: 0.3 },
  core: 0.12,
  hotRight: 0.03,
  spread: { far: 0.35, near: 0.8, share: 0.45 },
  stray: 0.012,
} as const;
/**
 * A street lamp (a full cut-off road luminaire): no light more than about
 * 80° from straight down, all of it from about 65°; toward the road's far
 * reaches up to this much more than straight down ("batwing"), so the road
 * between lamps is lit too; and behind the lamp, away from the road it
 * faces, this much less.
 */
const STREET_LAMP_BEAM = { cutoff: [0.17, 0.42], spread: 1.2, behind: 0.7 } as const;
/**
 * A street lamp (its lens 7.4 m up) lights nothing further off than this:
 * past its cut-off, about 80° from straight down. The shaders skip it there.
 */
const STREET_LAMP_RANGE_METERS = 44;
/**
 * Asphalt and grass send light back toward where it came from far more than
 * a matt surface does at a grazing angle (road lighting's luminance
 * coefficients): the ground takes the cosine of a headlight's angle to it to
 * this power, not to the first. A wet road loses most of it: it mirrors the
 * light away instead, to this power.
 */
const GROUND_BACKSCATTER = 0.35;
const WET_BACKSCATTER = 0.75;
/**
 * A wet road mirrors the lamps (glossyUnderLamps): a Beckmann lobe this
 * rough when damp, this rough when streaming with rain, stretched this much
 * along the view (the ripples of the rain), so each lamp ahead lays a streak
 * of light on the road toward the eye. What it mirrors of one lamp is kept
 * under this (a camera's highlights), so a streak glows rather than blinds.
 */
const WET_ROUGHNESS = [0.12, 0.035] as const;
const WET_STRETCH = 2.5;
const MOST_MIRRORED = 1.5;
/** Plants and smoke scatter the light they catch every way: this share of it, whatever way they face. */
const SCATTERING = 0.7;

/** How many street lamps and oncoming or leading vehicles light the scene at once, at most (the nearest). */
export const MAX_STREET_LAMPS = 8;
export const MAX_TRAFFIC_VEHICLES = 2;
/**
 * The lamps nearest this point, this many meters ahead of the camera (level),
 * light the scene: what the camera sees, rather than what lies behind it.
 */
export const LAMP_PICK_AHEAD_METERS = 20;
/**
 * Street lamps fade out between these distances from the pick point, and the
 * farthest one shown as the next one out comes within this many meters of
 * it, so none pops in or out.
 */
const STREET_LAMP_FADE_METERS = [60, 90] as const;
const STREET_LAMP_SWAP_METERS = 10;
/** Numbers per street lamp in LampLighting's list: where it is (x, y, z) and the way it faces (x, z). */
const STREET_LAMP_STRIDE = 5;
/** Vehicles light the scene within this distance of the pick point. */
const TRAFFIC_REACH_METERS = 160;

/** The flags views set on what the lamps should leave alone, light every way, or mirror when wet. */
const UNLIT = 'lampsUnlit';
const SCATTERS = 'lampsScatter';
const GLOSSY = 'lampsGloss';

/** Keeps the lamps' light off `object` and everything under it (the sky and its hills). */
export function unlitByLamps(object: Object3D | Material): void {
  object.userData[UNLIT] = true;
}

/** `material`'s surfaces scatter the lamps' light every way (grass, flowers, smoke, spray), not as flat ground. */
export function scattersLamplight(material: Material): void {
  material.userData[SCATTERS] = true;
}

/** `material` (a pre-lit road surface) mirrors the lamps when the rain wets it (LampLighting.setWetness). */
export function glossyUnderLamps(material: Material): void {
  material.userData[GLOSSY] = true;
}

/** A street lamp's light: where it shines from, and the way its head faces the road (level, unit). */
export interface StreetLampLight {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly facingX: number;
  readonly facingZ: number;
}

/** What carries headlamps: the truck (TruckView). */
export interface Headlamps {
  /** Writes where the left and right lamps are in the world, and the way they face (level). */
  headlamps(left: Vector3, right: Vector3, forward: Vector3): void;
}

/** The traffic's headlamps (TrafficView). */
export interface TrafficHeadlamps {
  /**
   * Writes the headlamps of up to `strengths.length` vehicles nearest
   * (`x`, `z`) and within `reach` meters, nearest first: each one's left and
   * right lamp in the world into `lamps` (pairs), the way it faces (level)
   * into `forwards`, and how brightly it shines, 0..1, into `strengths`
   * (fading toward `reach`, and the farthest as the next one out comes as
   * near, so none pops in or out). Returns how many vehicles it wrote.
   * Allocation-free.
   */
  headlampsNear(
    x: number,
    z: number,
    reach: number,
    lamps: readonly Vector3[],
    forwards: readonly Vector3[],
    strengths: number[],
  ): number;
}

const f = (value: number): string => (Number.isInteger(value) ? `${value}.0` : `${value}`);

const PARS = /* glsl */ `
uniform float lampLevel;
uniform vec3 lampUp;
uniform vec3 headlightColor;
uniform float headlightPeak;
uniform vec3 truckLamps[ 2 ];
uniform vec3 truckForward;
uniform vec3 truckRight;
uniform int trafficLampCount;
uniform vec3 trafficLamps[ ${MAX_TRAFFIC_VEHICLES * 2} ];
uniform vec3 trafficForward[ ${MAX_TRAFFIC_VEHICLES} ];
uniform vec3 trafficRight[ ${MAX_TRAFFIC_VEHICLES} ];
uniform float trafficStrength[ ${MAX_TRAFFIC_VEHICLES} ];
uniform vec3 streetLampColor;
uniform float streetLampPeak;
uniform int streetLampCount;
uniform vec3 streetLamps[ ${MAX_STREET_LAMPS} ];
uniform vec3 streetLampFacing[ ${MAX_STREET_LAMPS} ];
uniform float streetLampFade[ ${MAX_STREET_LAMPS} ];

// How strongly a low beam facing \`forward\` shines toward \`ray\` (unit, from the lamp, view space), 0..1.
float lowBeam( vec3 ray, vec3 forward, vec3 right ) {
  float ahead = dot( ray, forward );
  if ( ahead < 0.05 ) return 0.0;
  float across = dot( ray, right ) / ahead;
  float up = dot( ray, lampUp ) / ahead;
  float cutoff = min( ${f(-BEAM.cutoff)} + ${f(BEAM.kinkSlope)} * max( across - ${f(BEAM.kinkFrom)}, 0.0 ), ${f(BEAM.kinkTop)} );
  float lit = smoothstep( ${f(BEAM.soft[0])}, ${f(BEAM.soft[1])}, cutoff - up );
  float down = max( - up, 0.0 );
  float falloff = pow( ${f(BEAM.hot)} / max( down, ${f(BEAM.hot)} ), ${f(BEAM.falloff)} )
    * ( 1.0 - ${f(BEAM.foreground.loss)} * smoothstep( ${f(BEAM.foreground.from)}, ${f(BEAM.foreground.to)}, down ) );
  float near = smoothstep( ${f(BEAM.hot)}, 0.15, down );
  float spread = mix( ${f(BEAM.spread.far)}, ${f(BEAM.spread.near)}, near );
  float lateral = mix(
    exp( - pow2( ( across - ${f(BEAM.hotRight)} ) / ${f(BEAM.core)} ) ),
    exp( - pow2( across / spread ) ),
    mix( ${f(BEAM.spread.share)}, 1.0, near )
  );
  float stray = ${f(BEAM.stray)} * exp( - pow2( across / 0.3 ) );
  return mix( stray, falloff * lateral, lit );
}

// How strongly a street lamp facing the road \`facing\` shines toward \`ray\` (unit, from the lamp): down and out
// along the road, not up, and less behind it.
float streetLampBeam( vec3 ray, vec3 facing ) {
  float down = - dot( ray, lampUp );
  float level = sqrt( max( 1.0 - down * down, 0.0 ) );
  float behind = smoothstep( 0.0, 0.7, - dot( ray, facing ) / max( level, 1e-3 ) ) * smoothstep( 0.05, 0.4, level );
  return smoothstep( ${f(STREET_LAMP_BEAM.cutoff[0])}, ${f(STREET_LAMP_BEAM.cutoff[1])}, down )
    * ( 1.0 + ${f(STREET_LAMP_BEAM.spread)} * ( 1.0 - down ) ) * ( 1.0 - ${f(STREET_LAMP_BEAM.behind)} * behind );
}

// One lamp's light on a surface (already turned by how the surface faces it), none of it over MOST_LIGHT.
float lampSqueeze( float light ) {
  return light * ${f(MOST_LIGHT)} / ( ${f(MOST_LIGHT)} + light );
}
`;

/**
 * GLSL for what hangs in the air and catches the lamps' light (the rain):
 * `vec3 lampScatter( vec3 at )`, the lamps' light at `at` (view space),
 * coloured, as on a surface square to each lamp, for the caller to scatter.
 * Its uniforms are a LampLighting's `uniforms`, which the material shares.
 * Needs three's <common> chunk; cheap enough per vertex.
 */
export const LAMP_SCATTER_GLSL = /* glsl */ `
${PARS}
vec3 lampScatter( vec3 at ) {
  if ( lampLevel <= 0.0 ) return vec3( 0.0 );
  float headlit = 0.0;
  float streetlit = 0.0;
  for ( int i = 0; i < 2; i ++ ) {
    vec3 toLamp = truckLamps[ i ] - at;
    float distanceSq = max( dot( toLamp, toLamp ), 1e-4 );
    headlit += headlightPeak * lowBeam( - toLamp * inversesqrt( distanceSq ), truckForward, truckRight ) / ( distanceSq + 1.0 );
  }
  for ( int i = 0; i < ${MAX_TRAFFIC_VEHICLES * 2}; i ++ ) {
    if ( i >= trafficLampCount ) break;
    vec3 toLamp = trafficLamps[ i ] - at;
    float distanceSq = max( dot( toLamp, toLamp ), 1e-4 );
    headlit += headlightPeak * trafficStrength[ i / 2 ]
      * lowBeam( - toLamp * inversesqrt( distanceSq ), trafficForward[ i / 2 ], trafficRight[ i / 2 ] ) / ( distanceSq + 1.0 );
  }
  for ( int i = 0; i < ${MAX_STREET_LAMPS}; i ++ ) {
    if ( i >= streetLampCount ) break;
    vec3 toLamp = streetLamps[ i ] - at;
    float distanceSq = max( dot( toLamp, toLamp ), 1e-4 );
    if ( distanceSq > ${f(STREET_LAMP_RANGE_METERS * STREET_LAMP_RANGE_METERS)} ) continue;
    streetlit += streetLampPeak * streetLampFade[ i ]
      * streetLampBeam( - toLamp * inversesqrt( distanceSq ), streetLampFacing[ i ] ) / ( distanceSq + 1.0 );
  }
  return ( headlightColor * headlit + streetLampColor * streetlit ) * lampLevel;
}
`;

const PRELIT_VERTEX_PARS = /* glsl */ `
varying vec3 vLampView;
`;

const PRELIT_VERTEX = /* glsl */ `
vLampView = mvPosition.xyz;
`;

const PRELIT_FRAGMENT_PARS = /* glsl */ `
${PARS}
uniform vec3 prelitAlbedo;
varying vec3 vLampView;
#ifdef LAMPS_GLOSS
  uniform float lampWetness;
#endif

// How a surface facing up (the ground), or scattering, takes light from \`toward\` (the way to the lamp):
// headlights graze the ground, which sends much of it back (backscatter, less when wet); street lamps light it
// from above.
float lampFacing( vec3 toward, bool grazing ) {
  #ifdef LAMPS_SCATTER
    return ${f(SCATTERING)};
  #else
    float cosine = max( dot( lampUp, toward ), 0.0 );
    #ifdef LAMPS_GLOSS
      float backscatter = mix( ${f(GROUND_BACKSCATTER)}, ${f(WET_BACKSCATTER)}, lampWetness );
    #else
      float backscatter = ${f(GROUND_BACKSCATTER)};
    #endif
    return grazing ? pow( cosine, backscatter ) : cosine;
  #endif
}

#ifdef LAMPS_GLOSS
  // How much of a lamp's light (on a surface square to it) a wet road mirrors toward the eye: a Beckmann lobe
  // \`roughness\` wide across the view (\`across\`, level) and stretched along it, with Schlick's Fresnel term.
  float lampGloss( vec3 toward, vec3 toEye, vec3 across, float roughness ) {
    vec3 halfway = normalize( toward + toEye );
    float up = max( dot( lampUp, halfway ), 1e-3 );
    float sideways = dot( halfway, across ) / ( up * roughness );
    float lengthways = dot( halfway, cross( across, lampUp ) ) / ( up * roughness * ${f(WET_STRETCH)} );
    float lobe = exp( - sideways * sideways - lengthways * lengthways )
      / ( PI * roughness * roughness * ${f(WET_STRETCH)} * pow2( up * up ) );
    float fresnel = 0.02 + 0.98 * pow( 1.0 - max( dot( halfway, toEye ), 0.0 ), 5.0 );
    return fresnel * lobe / ( 4.0 * max( dot( lampUp, toEye ), 0.05 ) );
  }

  // What a wet road mirrors of one lamp, none of it over MOST_MIRRORED.
  float mirroredSqueeze( float light ) {
    return light * ${f(MOST_MIRRORED)} / ( ${f(MOST_MIRRORED)} + light );
  }
#endif
`;

/**
 * After the pre-lit colour: the lamps' light on the surface's own colour
 * (the pre-lit colour over the light it was lit with), as it faces up (the
 * ground) or scatters every way; on a wet road, also what it mirrors
 * (added after the rain's sheen, with PRELIT_GLOSS_FRAGMENT).
 */
const PRELIT_FRAGMENT = /* glsl */ `
vec3 lampMirrored = vec3( 0.0 );
if ( lampLevel > 0.0 ) {
  float headlit = 0.0;
  float streetlit = 0.0;
  #ifdef LAMPS_GLOSS
    bool wet = lampWetness > 0.0;
    vec3 toEye = normalize( - vLampView );
    vec3 across = normalize( cross( lampUp, toEye ) );
    float roughness = mix( ${f(WET_ROUGHNESS[0])}, ${f(WET_ROUGHNESS[1])}, lampWetness );
    float headMirrored = 0.0;
    float streetMirrored = 0.0;
  #endif
  for ( int i = 0; i < 2; i ++ ) {
    vec3 toLamp = truckLamps[ i ] - vLampView;
    float distanceSq = max( dot( toLamp, toLamp ), 1e-4 );
    vec3 toward = toLamp * inversesqrt( distanceSq );
    float light = headlightPeak * lowBeam( - toward, truckForward, truckRight ) / ( distanceSq + 1.0 );
    headlit += lampSqueeze( light * lampFacing( toward, true ) );
    #ifdef LAMPS_GLOSS
      if ( wet ) headMirrored += mirroredSqueeze( light * lampGloss( toward, toEye, across, roughness ) );
    #endif
  }
  for ( int i = 0; i < ${MAX_TRAFFIC_VEHICLES * 2}; i ++ ) {
    if ( i >= trafficLampCount ) break;
    vec3 toLamp = trafficLamps[ i ] - vLampView;
    float distanceSq = max( dot( toLamp, toLamp ), 1e-4 );
    vec3 toward = toLamp * inversesqrt( distanceSq );
    float light = headlightPeak * trafficStrength[ i / 2 ] * lowBeam( - toward, trafficForward[ i / 2 ], trafficRight[ i / 2 ] ) / ( distanceSq + 1.0 );
    headlit += lampSqueeze( light * lampFacing( toward, true ) );
    #ifdef LAMPS_GLOSS
      if ( wet ) headMirrored += mirroredSqueeze( light * lampGloss( toward, toEye, across, roughness ) );
    #endif
  }
  for ( int i = 0; i < ${MAX_STREET_LAMPS}; i ++ ) {
    if ( i >= streetLampCount ) break;
    vec3 toLamp = streetLamps[ i ] - vLampView;
    float distanceSq = max( dot( toLamp, toLamp ), 1e-4 );
    if ( distanceSq > ${f(STREET_LAMP_RANGE_METERS * STREET_LAMP_RANGE_METERS)} ) continue;
    vec3 toward = toLamp * inversesqrt( distanceSq );
    float light = streetLampPeak * streetLampFade[ i ] * streetLampBeam( - toward, streetLampFacing[ i ] ) / ( distanceSq + 1.0 );
    streetlit += lampSqueeze( light * lampFacing( toward, false ) );
    #ifdef LAMPS_GLOSS
      if ( wet ) streetMirrored += mirroredSqueeze( light * lampGloss( toward, toEye, across, roughness ) );
    #endif
  }
  outgoingLight += diffuseColor.rgb * prelitAlbedo * ( headlightColor * headlit + streetLampColor * streetlit ) * ( lampLevel * RECIPROCAL_PI );
  #ifdef LAMPS_GLOSS
    lampMirrored = ( headlightColor * headMirrored + streetLampColor * streetMirrored ) * ( lampLevel * lampWetness );
  #endif
}
`;

/** Last, over the rain's sheen: what a wet road mirrors of the lamps. */
const PRELIT_GLOSS_FRAGMENT = /* glsl */ `
outgoingLight += lampMirrored;
`;

/**
 * After three's own lights: every lamp as one more direct light through the
 * material's own lighting (RE_Direct: Lambert's, or Phong's, which gives
 * painted cars a highlight), shaped by its beam.
 */
const LIT_FRAGMENT = /* glsl */ `
if ( lampLevel > 0.0 ) {
  IncidentLight lamp;
  lamp.visible = true;
  for ( int i = 0; i < 2; i ++ ) {
    vec3 toLamp = truckLamps[ i ] - geometryPosition;
    float distanceSq = max( dot( toLamp, toLamp ), 1e-4 );
    lamp.direction = toLamp * inversesqrt( distanceSq );
    float light = lampLevel * headlightPeak * lowBeam( - lamp.direction, truckForward, truckRight ) / ( distanceSq + 1.0 );
    float facing = max( dot( geometryNormal, lamp.direction ), 1e-3 );
    lamp.color = headlightColor * ( lampSqueeze( light * facing ) / facing );
    RE_Direct( lamp, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  }
  for ( int i = 0; i < ${MAX_TRAFFIC_VEHICLES * 2}; i ++ ) {
    if ( i >= trafficLampCount ) break;
    vec3 toLamp = trafficLamps[ i ] - geometryPosition;
    float distanceSq = max( dot( toLamp, toLamp ), 1e-4 );
    lamp.direction = toLamp * inversesqrt( distanceSq );
    float light = lampLevel * headlightPeak * trafficStrength[ i / 2 ] * lowBeam( - lamp.direction, trafficForward[ i / 2 ], trafficRight[ i / 2 ] ) / ( distanceSq + 1.0 );
    float facing = max( dot( geometryNormal, lamp.direction ), 1e-3 );
    lamp.color = headlightColor * ( lampSqueeze( light * facing ) / facing );
    RE_Direct( lamp, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  }
  for ( int i = 0; i < ${MAX_STREET_LAMPS}; i ++ ) {
    if ( i >= streetLampCount ) break;
    vec3 toLamp = streetLamps[ i ] - geometryPosition;
    float distanceSq = max( dot( toLamp, toLamp ), 1e-4 );
    if ( distanceSq > ${f(STREET_LAMP_RANGE_METERS * STREET_LAMP_RANGE_METERS)} ) continue;
    lamp.direction = toLamp * inversesqrt( distanceSq );
    float light = lampLevel * streetLampPeak * streetLampFade[ i ] * streetLampBeam( - lamp.direction, streetLampFacing[ i ] ) / ( distanceSq + 1.0 );
    float facing = max( dot( geometryNormal, lamp.direction ), 1e-3 );
    lamp.color = streetLampColor * ( lampSqueeze( light * facing ) / facing );
    RE_Direct( lamp, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  }
}
`;

type LitMaterial = MeshLambertMaterial | MeshPhongMaterial | MeshStandardMaterial;

export interface LampLightingOptions {
  /** How many of the nearest street lamps light the scene, up to MAX_STREET_LAMPS. Default: all of them. */
  readonly streetLamps?: number;
  /** How many of the nearest vehicles' headlights light it, up to MAX_TRAFFIC_VEHICLES. Default: all of them. */
  readonly trafficVehicles?: number;
  /** Whether wet roads mirror the lamps (glossyUnderLamps). Default: true. */
  readonly wetGloss?: boolean;
}

/**
 * The night's lamps lighting the world, as real lights rather than decals:
 * the truck's headlights, the headlights of the vehicles nearest what the
 * camera sees and the nearest street lamps. They light what is there by its
 * own colour (dark asphalt dimly, road paint and grass brightly), the faces
 * of trees, posts, rails, signs, buildings and vehicles that turn to them
 * (with a highlight on paint), and fall off with the square of the
 * distance. In the rain the road mirrors them: a streak of light toward the
 * eye under each lamp ahead, and oncoming headlights glaring off it.
 *
 * The headlights are low beams (ECE, right-hand traffic): a sharp cut-off,
 * the step up to the right that lights the verge further, the hot zone under
 * it and the wide, dimmer light near the bumper, nothing over the cut-off
 * but a little stray light. The street lamps are full cut-off luminaires:
 * their light goes down and along the road, not out.
 *
 * It is shader code added to the scene's materials once, at boot
 * (lightScene): the lit ones take the lamps as more direct lights; the
 * pre-lit ground, roads, yards, plants and smoke add them to their pre-lit
 * colour. update() moves the lamps with the camera every frame; by day (the
 * lamps off) the shaders skip them. No draw calls, no shadow maps.
 */
export class LampLighting {
  /** The shaders' uniforms, shared by every lit material. */
  readonly uniforms = {
    lampLevel: { value: 0 },
    lampUp: { value: new Vector3(0, 1, 0) },
    lampWetness: { value: 0 },
    headlightColor: { value: new Color(HEADLIGHT_COLOR) },
    headlightPeak: { value: HEADLIGHT_PEAK },
    truckLamps: { value: [new Vector3(), new Vector3()] },
    truckForward: { value: new Vector3(0, 0, -1) },
    truckRight: { value: new Vector3(1, 0, 0) },
    trafficLampCount: { value: 0 },
    trafficLamps: { value: Array.from({ length: MAX_TRAFFIC_VEHICLES * 2 }, () => new Vector3()) },
    trafficForward: { value: Array.from({ length: MAX_TRAFFIC_VEHICLES }, () => new Vector3()) },
    trafficRight: { value: Array.from({ length: MAX_TRAFFIC_VEHICLES }, () => new Vector3()) },
    trafficStrength: { value: new Array<number>(MAX_TRAFFIC_VEHICLES).fill(0) },
    streetLampColor: { value: new Color(STREET_LAMP_COLOR) },
    streetLampPeak: { value: STREET_LAMP_PEAK },
    streetLampCount: { value: 0 },
    streetLamps: { value: Array.from({ length: MAX_STREET_LAMPS }, () => new Vector3()) },
    streetLampFacing: { value: Array.from({ length: MAX_STREET_LAMPS }, () => new Vector3(0, 0, -1)) },
    streetLampFade: { value: new Array<number>(MAX_STREET_LAMPS).fill(0) },
  };
  private readonly lit = new WeakSet<Material>();
  private readonly streetLampsShown: number;
  private readonly trafficShown: number;
  private readonly wetGloss: boolean;
  /** Every street lamp's light in the world: x, y, z and the way it faces (x, z) per lamp. */
  private streetLampAt = new Float32Array(0);
  /** Scratch: the nearest street lamps' indices and squared distances, nearest first. */
  private readonly nearest: number[];
  private readonly nearestSq: number[];
  private readonly left = new Vector3();
  private readonly right = new Vector3();
  private readonly forward = new Vector3();
  /** Scratch: the vehicles' lamps (pairs), headings in the world and strengths, one slot per vehicle shown. */
  private readonly trafficWorld: readonly Vector3[];
  private readonly trafficHeading: readonly Vector3[];
  private readonly trafficStrength: number[];

  constructor(options: LampLightingOptions = {}) {
    this.streetLampsShown = Math.max(0, Math.min(MAX_STREET_LAMPS, options.streetLamps ?? MAX_STREET_LAMPS));
    this.trafficShown = Math.max(0, Math.min(MAX_TRAFFIC_VEHICLES, options.trafficVehicles ?? MAX_TRAFFIC_VEHICLES));
    this.wetGloss = options.wetGloss !== false;
    this.nearest = new Array<number>(this.streetLampsShown).fill(-1);
    this.nearestSq = new Array<number>(this.streetLampsShown).fill(Infinity);
    this.trafficWorld = Array.from({ length: this.trafficShown * 2 }, () => new Vector3());
    this.trafficHeading = Array.from({ length: this.trafficShown }, () => new Vector3());
    this.trafficStrength = new Array<number>(this.trafficShown).fill(0);
  }

  /** Where the street lamps shine from (their lenses, in the world), and the ways they face. Not per frame. */
  setStreetLamps(lamps: readonly StreetLampLight[]): void {
    this.streetLampAt = Float32Array.from(lamps.flatMap(({ x, y, z, facingX, facingZ }) => [x, y, z, facingX, facingZ]));
  }

  /** How wet the roads are, 0..1 (the weather's rain): wet roads mirror the lamps. Cheap to call every frame. */
  setWetness(level: number): void {
    this.uniforms.lampWetness.value = Math.min(1, Math.max(0, level));
  }

  /**
   * Lights every material under `root` by the lamps, once: pre-lit ones
   * (`prelit`) on their pre-lit colour, lit ones (Lambert, Phong, standard)
   * as more lights. Leaves out what unlitByLamps() marked. At boot, before
   * the shaders compile, and for views built later (the truck); not per
   * frame.
   */
  lightScene(root: Object3D, prelit: PrelitMaterials): void {
    if (root.userData[UNLIT] === true) {
      return;
    }
    if (root instanceof Mesh) {
      for (const material of [root.material as Material | Material[]].flat()) {
        this.light(material, prelit);
      }
    }
    for (const child of root.children) {
      this.lightScene(child, prelit);
    }
  }

  /**
   * Moves the lamps to where they are, as `camera` sees them now: the
   * truck's (`truck`), the vehicles' nearest what the camera sees
   * (`traffic`, when there is traffic) and the street lamps nearest it; and
   * sets how brightly they shine (0..1, the weather's lamps: 0 by day turns
   * them off). Allocation-free: every frame, after the camera has moved.
   */
  update(truck: Headlamps, traffic: TrafficHeadlamps | null, camera: Camera, level: number): void {
    const u = this.uniforms;
    u.lampLevel.value = Math.max(0, level);
    if (level <= 0) {
      return;
    }
    camera.updateMatrixWorld();
    const view = camera.matrixWorldInverse;
    u.lampUp.value.set(0, 1, 0).transformDirection(view);

    truck.headlamps(this.left, this.right, this.forward);
    u.truckLamps.value[0]!.copy(this.left).applyMatrix4(view);
    u.truckLamps.value[1]!.copy(this.right).applyMatrix4(view);
    this.facing(this.forward, view, u.truckForward.value, u.truckRight.value);

    // The point the lamps are picked round: ahead of the camera, level (the world matrix's −Z column).
    const world = camera.matrixWorld.elements;
    const lookX = -world[8]!;
    const lookZ = -world[10]!;
    const look = Math.hypot(lookX, lookZ);
    const ahead = look > 1e-6 ? LAMP_PICK_AHEAD_METERS / look : 0;
    const pickX = world[12]! + lookX * ahead;
    const pickZ = world[14]! + lookZ * ahead;

    let vehicles = 0;
    if (traffic !== null && this.trafficShown > 0) {
      vehicles = Math.min(
        this.trafficShown,
        traffic.headlampsNear(pickX, pickZ, TRAFFIC_REACH_METERS, this.trafficWorld, this.trafficHeading, this.trafficStrength),
      );
    }
    for (let v = 0; v < vehicles; v++) {
      u.trafficLamps.value[v * 2]!.copy(this.trafficWorld[v * 2]!).applyMatrix4(view);
      u.trafficLamps.value[v * 2 + 1]!.copy(this.trafficWorld[v * 2 + 1]!).applyMatrix4(view);
      this.facing(this.trafficHeading[v]!, view, u.trafficForward.value[v]!, u.trafficRight.value[v]!);
      u.trafficStrength.value[v] = this.trafficStrength[v]!;
    }
    u.trafficLampCount.value = vehicles * 2;

    u.streetLampCount.value = this.nearestStreetLamps(pickX, pickZ, view);
  }

  /** The way `forward` (world) faces and its right, level, as `view` sees them. */
  private facing(forward: Vector3, view: Camera['matrixWorldInverse'], outForward: Vector3, outRight: Vector3): void {
    outForward.copy(forward).setY(0).normalize().transformDirection(view);
    // To the right of the way it faces (y up): forward × up.
    outRight.crossVectors(outForward, this.uniforms.lampUp.value).normalize();
  }

  /**
   * Picks the street lamps nearest (x, z), fading those far off and the
   * farthest as the next one out comes as near, and puts them in the
   * uniforms as `view` sees them. Returns how many. No allocation: an
   * insertion into the short, sorted list.
   */
  private nearestStreetLamps(x: number, z: number, view: Camera['matrixWorldInverse']): number {
    const shown = this.streetLampsShown;
    if (shown === 0) {
      return 0;
    }
    const { nearest, nearestSq } = this;
    nearest.fill(-1);
    nearestSq.fill(Infinity);
    const at = this.streetLampAt;
    const [near, far] = STREET_LAMP_FADE_METERS;
    const farSq = far * far;
    // The nearest lamp left out.
    let nextSq = farSq;
    for (let lamp = 0; lamp < at.length / STREET_LAMP_STRIDE; lamp++) {
      const dx = at[lamp * STREET_LAMP_STRIDE]! - x;
      const dz = at[lamp * STREET_LAMP_STRIDE + 2]! - z;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq >= farSq) {
        continue;
      }
      const last = nearestSq[shown - 1]!;
      if (distanceSq >= last) {
        nextSq = Math.min(nextSq, distanceSq);
        continue;
      }
      nextSq = Math.min(nextSq, last);
      let slot = shown - 1;
      while (slot > 0 && nearestSq[slot - 1]! > distanceSq) {
        nearestSq[slot] = nearestSq[slot - 1]!;
        nearest[slot] = nearest[slot - 1]!;
        slot--;
      }
      nearestSq[slot] = distanceSq;
      nearest[slot] = lamp;
    }
    const u = this.uniforms;
    let count = 0;
    while (count < shown && nearest[count]! >= 0) {
      count++;
    }
    const next = Math.sqrt(nextSq);
    for (let slot = 0; slot < count; slot++) {
      const first = nearest[slot]! * STREET_LAMP_STRIDE;
      u.streetLamps.value[slot]!.set(at[first]!, at[first + 1]!, at[first + 2]!).applyMatrix4(view);
      u.streetLampFacing.value[slot]!.set(at[first + 3]!, 0, at[first + 4]!).transformDirection(view);
      const distance = Math.sqrt(nearestSq[slot]!);
      let fade = 1 - Math.min(1, Math.max(0, (distance - near) / (far - near)));
      if (slot === count - 1) {
        fade = Math.min(fade, Math.max(0, (next - distance) / STREET_LAMP_SWAP_METERS));
      }
      u.streetLampFade.value[slot] = fade;
    }
    return count;
  }

  private light(material: Material, prelit: PrelitMaterials): void {
    if (this.lit.has(material) || material.userData[UNLIT] === true) {
      return;
    }
    if (material instanceof MeshBasicMaterial) {
      if (prelit.has(material)) {
        this.lightPrelit(material, prelit);
      }
      return;
    }
    if (
      material instanceof MeshLambertMaterial ||
      material instanceof MeshPhongMaterial ||
      material instanceof MeshStandardMaterial
    ) {
      this.lightLit(material);
    }
  }

  /** The lamps as more lights of `material`'s own lighting. */
  private lightLit(material: LitMaterial): void {
    this.lit.add(material);
    const uniforms = this.uniforms;
    this.chain(material, 'lamplit', (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${PARS}`)
        .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>\n${LIT_FRAGMENT}`);
    });
  }

  /** The lamps' light added to `material`'s pre-lit colour, by its own colour. */
  private lightPrelit(material: MeshBasicMaterial, prelit: PrelitMaterials): void {
    this.lit.add(material);
    const uniforms = this.uniforms;
    const scatters = material.userData[SCATTERS] === true;
    const glossy = this.wetGloss && !scatters && material.userData[GLOSSY] === true;
    const defines = `${scatters ? '#define LAMPS_SCATTER\n' : ''}${glossy ? '#define LAMPS_GLOSS\n' : ''}`;
    this.chain(material, scatters ? 'lamplit-scatter' : glossy ? 'lamplit-gloss' : 'lamplit-ground', (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.uniforms['prelitAlbedo'] = prelit.albedo;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${PRELIT_VERTEX_PARS}`)
        .replace('#include <project_vertex>', `#include <project_vertex>\n${PRELIT_VERTEX}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${defines}${PRELIT_FRAGMENT_PARS}`)
        // Before any later touch of the colour (the rain's wet sheen darkens it too)...
        .replace('#include <envmap_fragment>', `#include <envmap_fragment>\n${PRELIT_FRAGMENT}`)
        // ...but what a wet road mirrors comes last, over the sheen.
        .replace('#include <opaque_fragment>', `${PRELIT_GLOSS_FRAGMENT}\n#include <opaque_fragment>`);
    });
  }

  /**
   * Runs `inject` after whatever `material` did to its shaders already, and
   * keeps its program apart from those of materials without it.
   */
  private chain(material: Material, variant: string, inject: (shader: Parameters<Material['onBeforeCompile']>[0]) => void): void {
    const previous = material.onBeforeCompile.bind(material);
    const key = material.customProgramCacheKey();
    material.onBeforeCompile = (shader, renderer) => {
      previous(shader, renderer);
      inject(shader);
    };
    material.customProgramCacheKey = () => `${key}|${variant}`;
  }
}
