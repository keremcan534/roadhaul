import {
  BoxGeometry,
  BufferAttribute,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  type BufferGeometry,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  createPedestrianPose,
  crowdShows,
  placePedestrians,
  walkerAt,
  type Pedestrians,
} from '../../domain/world/pedestrians';
import { createRoadPoint, type RoadPath } from '../../domain/world/RoadPath';
import { KERB_HEIGHT_METERS, type Sidewalk, type StreetFurniture } from '../../domain/world/townscape';

/** People are placed from this seed, so a town always has the same ones. */
const PEDESTRIAN_SEED = 97;
/** They are drawn within this far of the camera (the nearest, up to the view's capacity). */
const REACH_METERS = 140;
/** They walk on the pavement's top: the road's surface plus the kerb. */
const PAVEMENT_Y = 0.03 + KERB_HEIGHT_METERS;
/** Numbers per person in the `person` attribute: how far through the walking cycle (radians), walking (1) or standing (0), how they look (0..1). */
const PERSON_STRIDE = 3;

/** The parts of a person, as the shader colours and moves them. */
const PART = { skin: 0, hair: 1, shirt: 2, trousers: 3, shoes: 4, umbrella: 5, shaft: 6 } as const;
/** The limbs that swing, round a pivot (the hip, the shoulder); the umbrella opens and closes. */
const LIMB = { none: 0, leftLeg: 1, rightLeg: 2, leftArm: 3, rightArm: 4, umbrella: 5 } as const;
/** Heights, meters: the hip and the shoulder, the pivots the legs and arms swing round. */
const HIP = 0.9;
const SHOULDER = 1.44;

/** Everyday clothes, skin tones, hair and umbrellas (sRGB), picked per person. */
const SHIRTS = [0x2f4f7f, 0xb23a3a, 0xe0d8c8, 0x3d6b4a, 0x6a4c8c, 0xd9a441, 0x2b2b2b, 0x8aa4b8] as const;
const TROUSERS = [0x2a3448, 0x3b3b3b, 0x6b5a45, 0x1d2430, 0x8c8c86, 0x40362e] as const;
const SKIN = [0xf1d0b5, 0xd9a882, 0xb98160, 0x8d5a3e] as const;
const HAIR = [0x2a1d14, 0x5a3b22, 0x1b1b1b, 0x9c7a4f, 0xb9b3aa] as const;
const UMBRELLAS = [0x1f2a44, 0xb52d2d, 0x2d6b3c, 0xd8b43a, 0x2b2b2b, 0x7a3c86] as const;

/** A palette as a GLSL array of linear colours. */
function palette(name: string, colors: readonly number[]): string {
  const color = new Color();
  const entries = colors.map((hex) => {
    color.setHex(hex);
    return `vec3( ${color.r.toFixed(4)}, ${color.g.toFixed(4)}, ${color.b.toFixed(4)} )`;
  });
  return `const vec3 ${name}[ ${colors.length} ] = vec3[ ${colors.length} ]( ${entries.join(', ')} );`;
}

const PERSON_PARS = /* glsl */ `
attribute float part;
attribute float limb;
attribute vec3 person;
uniform float time;
uniform float umbrella;
${palette('SHIRTS', SHIRTS)}
${palette('TROUSERS', TROUSERS)}
${palette('SKIN', SKIN)}
${palette('HAIR', HAIR)}
${palette('UMBRELLAS', UMBRELLAS)}
// One of \`count\` choices from a person's look, a different one for each \`salt\`.
int pick( float look, float salt, int count ) {
  return int( floor( fract( look * salt + look * look * 17.0 ) * float( count ) ) );
}
// Swings a limb forward (negative) or back round the x axis at \`pivot\`'s height.
vec3 swing( vec3 p, float pivot, float angle ) {
  float c = cos( angle );
  float s = sin( angle );
  float y = p.y - pivot;
  return vec3( p.x, pivot + y * c - p.z * s, y * s + p.z * c );
}
`;

/**
 * The walk, before the instance places the person: the legs and arms swing
 * opposite each other through the stride, the body bobs twice a stride; the
 * umbrella opens in the rain, the right arm raised to hold it.
 */
const PERSON_VERTEX = /* glsl */ `
float walking = person.y;
float cycle = person.x;
float legSwing = sin( cycle ) * 0.5 * walking;
float armSwing = sin( cycle ) * 0.4 * walking;
if ( limb > 0.5 && limb < 1.5 ) transformed = swing( transformed, ${HIP.toFixed(2)}, legSwing );
else if ( limb > 1.5 && limb < 2.5 ) transformed = swing( transformed, ${HIP.toFixed(2)}, - legSwing );
else if ( limb > 2.5 && limb < 3.5 ) transformed = swing( transformed, ${SHOULDER.toFixed(2)}, - armSwing );
else if ( limb > 3.5 && limb < 4.5 ) transformed = swing( transformed, ${SHOULDER.toFixed(2)}, mix( armSwing, -0.6, umbrella ) );
else if ( limb > 4.5 ) transformed = mix( vec3( -0.2, 1.0, 0.3 ), transformed, umbrella );
transformed.y += abs( cos( cycle ) ) * 0.035 * walking;
`;

/** Each part's colour, from the person's look (in place of three's color_vertex: vColor is a vec4). */
const PERSON_COLOR = /* glsl */ `
float look = person.z;
vec3 dress = vec3( 0.2 );
if ( part < 0.5 ) dress = SKIN[ pick( look, 13.0, ${SKIN.length} ) ];
else if ( part < 1.5 ) dress = HAIR[ pick( look, 17.0, ${HAIR.length} ) ];
else if ( part < 2.5 ) dress = SHIRTS[ pick( look, 7.0, ${SHIRTS.length} ) ];
else if ( part < 3.5 ) dress = TROUSERS[ pick( look, 11.0, ${TROUSERS.length} ) ];
else if ( part < 4.5 ) dress = vec3( 0.03 );
else if ( part < 5.5 ) dress = UMBRELLAS[ pick( look, 23.0, ${UMBRELLAS.length} ) ];
vColor = vec4( dress, 1.0 );
`;

export interface PedestrianViewOptions {
  /** How many people are drawn at most, the nearest first. Default: 120. */
  readonly capacity?: number;
}

/**
 * The towns' people (pedestrians.ts): walkers going up and down the
 * pavements and people waiting at the bus stops, low-poly and original,
 * each in their own clothes. One instanced mesh for all of them: the
 * nearest within REACH_METERS, placed every frame from the time alone; the
 * walk (legs and arms swinging, the body bobbing) is the vertex shader's.
 * Fewer are out at night and in the rain, when their umbrellas open. Lit
 * like the rest of the world (the lamps' light too). One draw call.
 */
export class PedestrianView {
  readonly mesh: InstancedMesh;
  private readonly people: Pedestrians;
  private readonly person: InstancedBufferAttribute;
  private readonly uniforms = { time: { value: 0 }, umbrella: { value: 0 } };
  private readonly capacity: number;
  /** Each pavement's middle and how far it reaches from it, to skip those out of reach at once. */
  private readonly reachOf: Float64Array;
  private readonly matrix = new Matrix4();
  private readonly pose = createPedestrianPose();
  private readonly point = createRoadPoint();
  private time = 0;

  constructor(
    private readonly scene: Scene,
    private readonly roads: readonly RoadPath[],
    private readonly sidewalks: readonly Sidewalk[],
    furniture: readonly StreetFurniture[],
    options: PedestrianViewOptions = {},
  ) {
    this.capacity = Math.max(1, options.capacity ?? 120);
    this.people = placePedestrians(roads, sidewalks, furniture, PEDESTRIAN_SEED);
    this.reachOf = new Float64Array(sidewalks.length * 3);
    sidewalks.forEach((sidewalk, index) => {
      const road = roads[sidewalk.roadIndex]!;
      const point = createRoadPoint();
      road.pointAt((sidewalk.fromMeters + sidewalk.toMeters) / 2, point);
      this.reachOf[index * 3] = point.x;
      this.reachOf[index * 3 + 1] = point.z;
      // Half its length along the road, and the width of the street and the pavement across it.
      this.reachOf[index * 3 + 2] = (sidewalk.toMeters - sidewalk.fromMeters) / 2 + road.widthMeters;
    });

    const geometry = personGeometry();
    this.person = new InstancedBufferAttribute(new Float32Array(this.capacity * PERSON_STRIDE), PERSON_STRIDE).setUsage(
      DynamicDrawUsage,
    );
    geometry.setAttribute('person', this.person);
    const material = new MeshLambertMaterial({ vertexColors: true });
    const uniforms = this.uniforms;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${PERSON_PARS}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${PERSON_VERTEX}`)
        .replace('#include <color_vertex>', PERSON_COLOR);
    };
    material.customProgramCacheKey = () => 'pedestrians';
    this.mesh = new InstancedMesh(geometry, material, this.capacity);
    this.mesh.name = 'pedestrians';
    this.mesh.count = 0;
    // They move every frame: bounds computed once would go stale.
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    scene.add(this.mesh);
  }

  /** How many people there are in all: walking the pavements, and waiting at bus stops. */
  get population(): { readonly walkers: number; readonly waiting: number } {
    return { walkers: this.people.walkers.length, waiting: this.people.waiting.length };
  }

  /** How many are drawn now. */
  get shown(): number {
    return this.mesh.count;
  }

  /**
   * Places the people near `eye` as they are after `deltaSeconds` more
   * (0 while paused): as many as are out in a crowd `crowd` strong (0..1:
   * 1 by day, thinner at night and in the rain), their umbrellas `umbrella`
   * open (0..1). Allocation-free.
   */
  update(deltaSeconds: number, eye: Readonly<{ x: number; z: number }>, crowd: number, umbrella: number): void {
    this.time += deltaSeconds;
    this.uniforms.umbrella.value = Math.min(1, Math.max(0, umbrella));
    const person = this.person.array as Float32Array;
    const reachSq = REACH_METERS * REACH_METERS;
    let count = 0;
    const { walkers, waiting } = this.people;
    for (let i = 0; i < walkers.length && count < this.capacity; i++) {
      const walker = walkers[i]!;
      if (!crowdShows(walker.presence, crowd) || !this.nearEnough(walker.sidewalk, eye)) {
        continue;
      }
      const sidewalk = this.sidewalks[walker.sidewalk]!;
      const pose = walkerAt(walker, this.roads[sidewalk.roadIndex]!, sidewalk, this.time, this.point, this.pose);
      const dx = pose.x - eye.x;
      const dz = pose.z - eye.z;
      if (dx * dx + dz * dz > reachSq) {
        continue;
      }
      this.mesh.setMatrixAt(count, this.matrix.makeRotationY(pose.heading).setPosition(pose.x, PAVEMENT_Y, pose.z));
      person[count * PERSON_STRIDE] = pose.stride;
      person[count * PERSON_STRIDE + 1] = 1;
      person[count * PERSON_STRIDE + 2] = walker.look;
      count++;
    }
    for (let i = 0; i < waiting.length && count < this.capacity; i++) {
      const one = waiting[i]!;
      const dx = one.x - eye.x;
      const dz = one.z - eye.z;
      if (!crowdShows(one.presence, crowd) || dx * dx + dz * dz > reachSq) {
        continue;
      }
      this.mesh.setMatrixAt(count, this.matrix.makeRotationY(one.heading).setPosition(one.x, PAVEMENT_Y, one.z));
      person[count * PERSON_STRIDE] = 0;
      person[count * PERSON_STRIDE + 1] = 0;
      person[count * PERSON_STRIDE + 2] = one.look;
      count++;
    }
    if (count > 0 || this.mesh.count > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.person.needsUpdate = true;
    }
    this.mesh.count = count;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshLambertMaterial).dispose();
    this.mesh.dispose();
  }

  /** Whether any of pavement `index` comes within reach of `eye`. */
  private nearEnough(index: number, eye: Readonly<{ x: number; z: number }>): boolean {
    const dx = this.reachOf[index * 3]! - eye.x;
    const dz = this.reachOf[index * 3 + 1]! - eye.z;
    const reach = REACH_METERS + this.reachOf[index * 3 + 2]!;
    return dx * dx + dz * dz <= reach * reach;
  }
}

/**
 * A person facing +z, feet at y 0, about 1.75 m tall: shoes, legs, a body,
 * arms with hands, a head with hair, and an umbrella (folded away unless it
 * rains). Every vertex knows its part (its colour) and its limb (how it
 * moves).
 */
export function personGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const add = (geometry: BufferGeometry, part: number, limb: number): void => {
    const count = geometry.getAttribute('position').count;
    geometry.setAttribute('part', new BufferAttribute(new Float32Array(count).fill(part), 1));
    geometry.setAttribute('limb', new BufferAttribute(new Float32Array(count).fill(limb), 1));
    parts.push(geometry);
  };
  const box = (w: number, h: number, d: number, x: number, y: number, z: number): BufferGeometry =>
    new BoxGeometry(w, h, d).translate(x, y, z);
  for (const side of [1, -1] as const) {
    const leg = side === 1 ? LIMB.leftLeg : LIMB.rightLeg;
    const arm = side === 1 ? LIMB.leftArm : LIMB.rightArm;
    add(box(0.11, 0.08, 0.26, side * 0.1, 0.04, 0.04), PART.shoes, leg);
    add(box(0.13, HIP - 0.08, 0.15, side * 0.1, 0.08 + (HIP - 0.08) / 2, 0), PART.trousers, leg);
    add(box(0.09, 0.5, 0.1, side * 0.245, SHOULDER - 0.25, 0), PART.shirt, arm);
    add(box(0.08, 0.12, 0.09, side * 0.245, SHOULDER - 0.56, 0), PART.skin, arm);
  }
  add(box(0.36, SHOULDER - HIP + 0.06, 0.2, 0, (HIP + SHOULDER + 0.06) / 2, 0), PART.shirt, LIMB.none);
  add(box(0.08, 0.08, 0.08, 0, SHOULDER + 0.07, 0), PART.skin, LIMB.none);
  add(box(0.2, 0.23, 0.22, 0, SHOULDER + 0.22, 0.01), PART.skin, LIMB.none);
  add(box(0.22, 0.08, 0.24, 0, SHOULDER + 0.35, -0.01), PART.hair, LIMB.none);
  // The umbrella over the head, its shaft in the raised right hand.
  add(new ConeGeometry(0.55, 0.26, 8, 1, true).translate(-0.05, 2.08, 0.18), PART.umbrella, LIMB.umbrella);
  add(new CylinderGeometry(0.012, 0.012, 1.05, 4, 1, true).translate(-0.2, 1.5, 0.3), PART.shaft, LIMB.umbrella);
  const merged = mergeGeometries(parts.map((part) => stripped(part)));
  for (const part of parts) {
    part.dispose();
  }
  if (merged === null) {
    throw new Error('The parts of a person do not merge.');
  }
  return merged;
}

/** A part with just what the person needs (position, normal, part, limb), so parts of any shape merge. */
function stripped(geometry: BufferGeometry): BufferGeometry {
  for (const name of Object.keys(geometry.attributes)) {
    if (!['position', 'normal', 'part', 'limb'].includes(name)) {
      geometry.deleteAttribute(name);
    }
  }
  return geometry;
}
