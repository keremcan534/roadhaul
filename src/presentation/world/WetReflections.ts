import {
  AdditiveBlending,
  BufferAttribute,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
  Vector4,
  type Camera,
  type Scene,
} from 'three';
import {
  HEADLIGHT_COLOR,
  HEADLIGHT_PEAK,
  LAMP_BEAMS_GLSL,
  STREET_LAMP_COLOR,
  STREET_LAMP_PEAK,
  unlitByLamps,
  type StreetLampLight,
} from './LampLighting';

/** The kinds of lamp a wet road mirrors, each with its own beam and colour. */
export const MIRRORED_LAMPS = ['street', 'head', 'tail'] as const;
export type MirroredLampKind = (typeof MIRRORED_LAMPS)[number];
const KIND: Readonly<Record<MirroredLampKind, number>> = { street: 0, head: 1, tail: 2 };

/** Tail lights: red, dim beside a headlight, shining back in a wide cone. */
const TAIL_LIGHT_COLOR = 0xff2a1a;
const TAIL_LIGHT_PEAK = 9;
/**
 * The road mirrors a lamp as a Beckmann lobe this rough when damp and this
 * rough when streaming with rain, stretched this much along the view, so
 * each lamp lays a long streak of its light on the road toward the eye,
 * from under it. What it mirrors of one lamp is kept under this (a camera's
 * highlights), so a streak glows rather than blinds.
 */
const WET_ROUGHNESS = [0.12, 0.05] as const;
const WET_STRETCH = 4;
const MOST_MIRRORED = 1.5;
/** The lobe fades out this many roughnesses off its middle: the streak's quad reaches that far across, and a little more. */
const LOBE_REACH = 2.6;
const QUAD_MARGIN_METERS = 0.35;
/**
 * The rain ripples the water on the road, breaking each streak into
 * shimmering pieces: waves tilting it toward and away from the eye by this
 * much at most (a slope) in the rain, and a little in the wind once it has
 * stopped; sideways only this share of it, so a streak stays straight.
 */
const RIPPLE_SLOPE = 0.12;
const CALM_SLOPE = 0.025;
const RIPPLE_SIDEWAYS = 0.08;
/** The water lies this high over the ground (the road is higher: this is under its markings). */
const WATER_Y = 0.04;
/** Lamps farther than this from the camera are not mirrored, fading out over the last FADE_METERS. */
const REACH_METERS = 300;
const FADE_METERS = 60;
/** The street lamps are gathered in this many rings round the camera, the nearest first. */
const RINGS = 3;
/** A streak runs from this far behind its lamp's foot to this far short of the camera's. */
const STREAK_BEHIND_METERS = 0.6;
const STREAK_SHORT_METERS = 1;
/** Numbers per street lamp in the list: where it is (x, y, z) and the way it faces (x, z). */
const STREET_LAMP_STRIDE = 5;
/** Numbers per lamp in the instance attributes: where it is and its kind; the way it faces and its light; its colour. */
const LAMP_STRIDE = 4;
const AIM_STRIDE = 4;
const TINT_STRIDE = 3;

const f = (value: number): string => (Number.isInteger(value) ? `${value}.0` : `${value}`);

const VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec4 lamp;
attribute vec4 aim;
attribute vec3 tint;
uniform vec3 eye;
uniform float reach;
varying vec3 vAt;
varying vec4 vLamp;
varying vec4 vAim;
varying vec3 vTint;
void main() {
  // A quad on the water from the lamp's foot to the camera's, widest where the road mirrors the lamp straight
  // at the eye: as wide there as the lobe reaches across.
  vec2 toEye = eye.xz - lamp.xz;
  float distance = max( length( toEye ), 1e-3 );
  vec2 along = toEye / distance;
  vec2 across = vec2( - along.y, along.x );
  float lampHeight = max( lamp.y - ${f(WATER_Y)}, 0.05 );
  float eyeHeight = max( eye.y - ${f(WATER_Y)}, 0.05 );
  float mirror = distance * lampHeight / ( lampHeight + eyeHeight );
  float fromLamp = length( vec2( mirror, lampHeight ) );
  float fromEye = length( vec2( distance - mirror, eyeHeight ) );
  float halfWidth = ${f(QUAD_MARGIN_METERS)} + reach * ( lampHeight / fromLamp ) / ( 1.0 / fromLamp + 1.0 / fromEye );
  float t = mix( - ${f(STREAK_BEHIND_METERS)}, max( distance - ${f(STREAK_SHORT_METERS)}, 0.0 ), position.y );
  vec2 at = lamp.xz + along * t + across * ( position.x * halfWidth );
  vAt = vec3( at.x, ${f(WATER_Y)}, at.y );
  vLamp = lamp;
  vAim = aim;
  vTint = tint;
  vec4 mvPosition = viewMatrix * vec4( vAt, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${LAMP_BEAMS_GLSL}
uniform vec3 eye;
uniform float roughness;
uniform float ripple;
uniform float time;
uniform float strength;
uniform vec4 blocker;
uniform vec3 blockerSize;
varying vec3 vAt;
varying vec4 vLamp;
varying vec4 vAim;
varying vec3 vTint;

// How a tail light facing \`facing\` shines toward \`ray\` (unit, from the lamp): back, in a wide cone.
float tailBeam( vec3 ray, vec3 facing ) {
  return smoothstep( -0.1, 0.6, dot( ray, facing ) );
}

// 1 where the truck's box (\`blocker\`: its middle and its heading's sine and cosine; \`blockerSize\`: its half
// length, half width and height, none when 0 high) stands in the way of a lamp's light from \`lamp\` to the water
// at \`at\`, else 0.
float blocked( vec3 at, vec3 lamp ) {
  if ( blockerSize.z <= 0.0 ) return 0.0;
  // Into the box's frame, x across and y along it (makeRotationY's turn undone).
  vec2 a = at.xz - blocker.xy;
  vec2 b = lamp.xz - blocker.xy;
  a = vec2( a.x * blocker.w - a.y * blocker.z, a.x * blocker.z + a.y * blocker.w );
  b = vec2( b.x * blocker.w - b.y * blocker.z, b.x * blocker.z + b.y * blocker.w );
  vec2 d = b - a;
  d = vec2( abs( d.x ) < 1e-5 ? 1e-5 : d.x, abs( d.y ) < 1e-5 ? 1e-5 : d.y );
  vec2 extent = blockerSize.yx;
  vec2 t1 = ( - extent - a ) / d;
  vec2 t2 = ( extent - a ) / d;
  float enter = max( max( min( t1.x, t2.x ), min( t1.y, t2.y ) ), 0.0 );
  float leave = min( min( max( t1.x, t2.x ), max( t1.y, t2.y ) ), 1.0 );
  // The light climbs from the water to the lamp: it passes lowest where it goes into the box.
  return enter < leave ? step( mix( at.y, lamp.y, enter ), blockerSize.z ) : 0.0;
}

void main() {
  vec3 toLamp = vLamp.xyz - vAt;
  float distanceSq = max( dot( toLamp, toLamp ), 1e-4 );
  vec3 toward = toLamp * inversesqrt( distanceSq );
  vec3 toEye = normalize( eye - vAt );
  vec3 facing = vec3( vAim.x, 0.0, vAim.y );
  float beam = vLamp.w < 0.5
    ? streetLampBeam( - toward, facing )
    : vLamp.w < 1.5 ? lowBeam( - toward, facing, cross( facing, lampUp ) ) : tailBeam( - toward, facing );
  float light = vAim.z * beam / ( distanceSq + 1.0 ) * ( 1.0 - blocked( vAt, vLamp.xyz ) );
  // The water's surface, rippled: crossing waves that run on, tilting it toward and away from the eye (and a
  // little sideways), breaking the streak into shimmering pieces along it.
  vec2 at = vAt.xz;
  vec2 alongView = normalize( eye.xz - at + vec2( 1e-4 ) );
  float lengthwise = sin( dot( at, vec2( 7.3, 3.1 ) ) + time * 5.7 ) * sin( dot( at, vec2( -2.9, 6.7 ) ) - time * 4.3 );
  float crosswise = sin( dot( at, vec2( 3.7, -5.3 ) ) + time * 6.9 );
  vec2 slope = ripple * ( alongView * lengthwise + vec2( - alongView.y, alongView.x ) * ( crosswise * ${f(RIPPLE_SIDEWAYS)} ) );
  vec3 normal = normalize( vec3( slope.x, 1.0, slope.y ) );
  // A Beckmann lobe round the normal, \`roughness\` wide across the view and stretched along it, with Schlick's
  // Fresnel term.
  vec3 halfway = normalize( toward + toEye );
  vec3 across = normalize( cross( normal, toEye ) );
  float up = max( dot( normal, halfway ), 1e-3 );
  float sideways = dot( halfway, across ) / ( up * roughness );
  float lengthways = dot( halfway, cross( across, normal ) ) / ( up * roughness * ${f(WET_STRETCH)} );
  float lobe = exp( - sideways * sideways - lengthways * lengthways ) / ( PI * roughness * roughness * ${f(WET_STRETCH)} * pow2( up * up ) );
  float fresnel = 0.02 + 0.98 * pow( 1.0 - max( dot( halfway, toEye ), 0.0 ), 5.0 );
  float mirrored = light * fresnel * lobe / ( 4.0 * max( dot( normal, toEye ), 0.05 ) );
  vec3 color = vTint * ( mirrored * ${f(MOST_MIRRORED)} / ( ${f(MOST_MIRRORED)} + mirrored ) ) * strength;
  // Added light: the haze swallows it rather than colouring it.
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      color *= exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      color *= 1.0 - smoothstep( fogNear, fogFar, vFogDepth );
    #endif
  #endif
  gl_FragColor = vec4( color, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Lamps shown to a wet road (TruckView, TrafficView): each one added in turn (add), for this frame. */
export interface LampMirror {
  /**
   * One lamp: its kind, where it is in the world, the way it faces (level,
   * unit: a tail light faces back) and how brightly it shines (0..1).
   */
  add(kind: MirroredLampKind, x: number, y: number, z: number, facingX: number, facingZ: number, strength?: number): void;
  /**
   * What stands in the way of the lamps' light to the road behind it (the
   * truck, seen from behind): a box `height` tall on a footprint centred on
   * (`x`, `z`), `halfLength` along the way it faces (`heading`, radians, 0
   * along +z) and `halfWidth` across. One a frame: the last one holds.
   */
  shade(x: number, z: number, heading: number, halfLength: number, halfWidth: number, height: number): void;
}

/** What carries lamps a wet road mirrors: the truck, the traffic. */
export interface MirroredLamps {
  mirrorLamps(into: LampMirror): void;
}

/**
 * The lamps mirrored on wet roads: under every lamp in sight (the street
 * lamps, the truck's and the traffic's headlights and tail lights) a streak
 * of its light on the road toward the eye, broken up by the rain's ripples,
 * the way each lamp's beam shines (a headlight glares off the road ahead of
 * it, not behind). One draw call for all of them: a quad per lamp lying on
 * the water, whose pixels work out the glossy reflection of that one lamp
 * (a Beckmann lobe stretched along the view, with Fresnel's term), so the
 * cost goes with the streaks' area rather than with the road's times the
 * lamps. The nearest lamps come first when there are more than it has room
 * for. Hidden (no draw call) while the roads are dry or the lamps are off.
 */
export class WetReflections implements LampMirror {
  readonly mesh: Mesh;
  private readonly geometry = new InstancedBufferGeometry();
  private readonly material: ShaderMaterial;
  private readonly lamps: InstancedBufferAttribute;
  private readonly aims: InstancedBufferAttribute;
  private readonly tints: InstancedBufferAttribute;
  private readonly uniforms = {
    eye: { value: new Vector3() },
    lampUp: { value: new Vector3(0, 1, 0) },
    reach: { value: 1 },
    roughness: { value: WET_ROUGHNESS[0] as number },
    ripple: { value: CALM_SLOPE },
    time: { value: 0 },
    strength: { value: 0 },
    blocker: { value: new Vector4() },
    blockerSize: { value: new Vector3() },
  };
  /** Each kind's colour (linear) and peak intensity. */
  private readonly colors: readonly Color[];
  private readonly peaks: readonly number[];
  /** Every street lamp: x, y, z and the way it faces (x, z) per lamp. */
  private streetLampAt = new Float32Array(0);
  /** Where the camera is and looks (level), for the frame being gathered. */
  private readonly eye = new Vector3();
  private lookX = 0;
  private lookZ = 1;
  private count = 0;
  private time = 0;

  constructor(
    private readonly scene: Scene,
    private readonly capacity: number,
  ) {
    const room = Math.max(1, capacity);
    this.lamps = new InstancedBufferAttribute(new Float32Array(room * LAMP_STRIDE), LAMP_STRIDE).setUsage(DynamicDrawUsage);
    this.aims = new InstancedBufferAttribute(new Float32Array(room * AIM_STRIDE), AIM_STRIDE).setUsage(DynamicDrawUsage);
    this.tints = new InstancedBufferAttribute(new Float32Array(room * TINT_STRIDE), TINT_STRIDE).setUsage(DynamicDrawUsage);
    // A quad: x across the streak (-1..1, to the left looking from the lamp to the camera), y along it (0 at the
    // lamp, 1 at the camera), wound to face up once laid on the water.
    this.geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0]), 3));
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.geometry.setAttribute('lamp', this.lamps);
    this.geometry.setAttribute('aim', this.aims);
    this.geometry.setAttribute('tint', this.tints);
    this.geometry.instanceCount = 0;
    this.material = new ShaderMaterial({
      uniforms: UniformsUtils.merge([UniformsLib.fog]),
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -8,
    });
    // The fog's uniforms are the material's own (three fills them in); the rest are shared with update().
    Object.assign(this.material.uniforms, this.uniforms);
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.name = 'wet-reflections';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    // Over the road and its markings, under the glows and the rain.
    this.mesh.renderOrder = 1;
    // It is the lamps' light already.
    unlitByLamps(this.mesh);
    this.colors = [new Color(STREET_LAMP_COLOR), new Color(HEADLIGHT_COLOR), new Color(TAIL_LIGHT_COLOR)];
    this.peaks = [STREET_LAMP_PEAK, HEADLIGHT_PEAK, TAIL_LIGHT_PEAK];
    scene.add(this.mesh);
  }

  /** Where the street lamps shine from and the ways they face (StreetLampView.lampLights()). Not per frame. */
  setStreetLamps(lamps: readonly StreetLampLight[]): void {
    this.streetLampAt = Float32Array.from(lamps.flatMap(({ x, y, z, facingX, facingZ }) => [x, y, z, facingX, facingZ]));
  }

  /** How many lamps it mirrors this frame. */
  get lampCount(): number {
    return this.mesh.visible ? this.geometry.instanceCount : 0;
  }

  /**
   * Mirrors the lamps as `camera` sees them now, on roads `wetness` wet
   * (0..1, WeatherService.wetness) in rain `rain` hard (0..1: the ripples),
   * the lamps `level` bright (0..1: 0 by day): the street lamps, and those
   * of `sources` (the truck's, the traffic's). `deltaSeconds` runs the
   * ripples on. Allocation-free: every frame, after the camera and the
   * lamps have moved.
   */
  update(camera: Camera, wetness: number, rain: number, level: number, deltaSeconds: number, sources: readonly (MirroredLamps | null)[]): void {
    const strength = Math.min(1, Math.max(0, wetness)) * Math.max(0, level);
    this.count = 0;
    if (strength <= 0.001) {
      this.mesh.visible = false;
      return;
    }
    camera.updateMatrixWorld();
    const world = camera.matrixWorld.elements;
    this.eye.set(world[12]!, world[13]!, world[14]!);
    const lookX = -world[8]!;
    const lookZ = -world[10]!;
    const look = Math.hypot(lookX, lookZ);
    this.lookX = look > 1e-6 ? lookX / look : 0;
    this.lookZ = look > 1e-6 ? lookZ / look : 1;
    this.uniforms.blockerSize.value.set(0, 0, 0);
    for (const source of sources) {
      source?.mirrorLamps(this);
    }
    this.addStreetLamps();

    const u = this.uniforms;
    u.eye.value.copy(this.eye);
    const wet = Math.min(1, Math.max(0, wetness));
    u.roughness.value = WET_ROUGHNESS[0] + (WET_ROUGHNESS[1] - WET_ROUGHNESS[0]) * wet;
    u.ripple.value = CALM_SLOPE + (RIPPLE_SLOPE - CALM_SLOPE) * Math.min(1, Math.max(0, rain));
    // The ripples tilt the water a little sideways: the lobe reaches that much farther across.
    u.reach.value = 2 * LOBE_REACH * (u.roughness.value + 2 * RIPPLE_SIDEWAYS * u.ripple.value);
    this.time = (this.time + deltaSeconds) % 1000;
    u.time.value = this.time;
    u.strength.value = strength;
    this.geometry.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
    if (this.count > 0) {
      this.lamps.addUpdateRange(0, this.count * LAMP_STRIDE);
      this.lamps.needsUpdate = true;
      this.aims.addUpdateRange(0, this.count * AIM_STRIDE);
      this.aims.needsUpdate = true;
      this.tints.addUpdateRange(0, this.count * TINT_STRIDE);
      this.tints.needsUpdate = true;
    }
  }

  /**
   * One lamp to mirror this frame (LampMirror): left out when it is behind
   * the camera, out of reach, or a head or tail light facing away from the
   * camera (its beam lights the road the other way); fading toward the reach.
   */
  add(kind: MirroredLampKind, x: number, y: number, z: number, facingX: number, facingZ: number, strength = 1): void {
    if (this.count >= this.capacity) {
      return;
    }
    const dx = x - this.eye.x;
    const dz = z - this.eye.z;
    const distance = Math.hypot(dx, dz);
    if (distance >= REACH_METERS || dx * this.lookX + dz * this.lookZ <= 0) {
      return;
    }
    const index = KIND[kind];
    if (index !== KIND.street && dx * facingX + dz * facingZ > 0.2 * distance) {
      return;
    }
    const shown = strength * Math.min(1, (REACH_METERS - distance) / FADE_METERS);
    if (shown <= 0.001) {
      return;
    }
    const slot = this.count++;
    const lamps = this.lamps.array as Float32Array;
    lamps[slot * LAMP_STRIDE] = x;
    lamps[slot * LAMP_STRIDE + 1] = y;
    lamps[slot * LAMP_STRIDE + 2] = z;
    lamps[slot * LAMP_STRIDE + 3] = index;
    const aims = this.aims.array as Float32Array;
    aims[slot * AIM_STRIDE] = facingX;
    aims[slot * AIM_STRIDE + 1] = facingZ;
    aims[slot * AIM_STRIDE + 2] = this.peaks[index]! * shown;
    aims[slot * AIM_STRIDE + 3] = 0;
    const color = this.colors[index]!;
    const tints = this.tints.array as Float32Array;
    tints[slot * TINT_STRIDE] = color.r;
    tints[slot * TINT_STRIDE + 1] = color.g;
    tints[slot * TINT_STRIDE + 2] = color.b;
  }

  /** What stands in the way of the lamps' light this frame (LampMirror): the truck. */
  shade(x: number, z: number, heading: number, halfLength: number, halfWidth: number, height: number): void {
    this.uniforms.blocker.value.set(x, z, Math.sin(heading), Math.cos(heading));
    this.uniforms.blockerSize.value.set(halfLength, halfWidth, height);
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }

  /**
   * The street lamps in reach ahead of the camera, into the room left: the
   * nearest first, so a crowded town loses its farthest streaks.
   */
  private addStreetLamps(): void {
    const at = this.streetLampAt;
    const lamps = at.length / STREET_LAMP_STRIDE;
    // Nearer rings first: most frames every lamp in reach fits, and then one pass does.
    for (let ring = 1; ring <= RINGS && this.count < this.capacity; ring++) {
      const inner = ((ring - 1) / RINGS) * REACH_METERS;
      const outer = (ring / RINGS) * REACH_METERS;
      for (let lamp = 0; lamp < lamps; lamp++) {
        const first = lamp * STREET_LAMP_STRIDE;
        const x = at[first]!;
        const z = at[first + 2]!;
        const distance = Math.hypot(x - this.eye.x, z - this.eye.z);
        if (distance >= inner && distance < outer) {
          this.add('street', x, at[first + 1]!, z, at[first + 3]!, at[first + 4]!);
        }
      }
    }
  }
}
