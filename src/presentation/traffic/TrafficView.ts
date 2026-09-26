import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
  Vector2,
  type DataTexture,
  type Scene,
  type Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { TrafficCarBody, TrafficVehicleDefinition } from '../../data/definitions/TrafficVehicleDefinition';
import type { TrafficSimulation } from '../../domain/traffic/TrafficSimulation';
import { softBoxShadowImage } from '../textures/proceduralImages';
import { toTexture } from '../textures/toTexture';
import { LampGlows } from '../vehicles/LampGlows';
import type { LampMirror } from '../world/WetReflections';
import type { SkyUniforms } from '../world/EnvironmentView';
import type { TrafficHeadlamps } from '../world/LampLighting';
import { reflectSky } from '../world/skyReflection';

/** Parts in white take the vehicle's paint (the instance colour); the rest keep their own colour (`paint` 0). */
const PAINT = 0xffffff;
const GLASS = 0x1d2630;
const TYRE = 0x161616;
const TRIM = 0x3a3d42;
const HUB = 0xb4b9bf;
/**
 * A bus's white upper body and roof (its livery's paint is below the
 * windows), its windows and doors, lit from inside at night, and its route
 * sign over the windscreen, an orange LED line at night: what glows, in
 * linear light at full lamps (setLamps).
 */
const BUS_WHITE = 0xf1f1ec;
const BUS_WINDOW = 0x223140;
const BUS_DOOR = 0x2a3a48;
const SIGN = 0x121212;
/** Number plates: plain and light, without letters. */
const PLATE = 0xe4e4dc;
/** A lorry's white box, its light grey ribs and rails, and the amber markers along its sides, lit at night. */
const BOX_WHITE = 0xecece6;
const RIB = 0xc4c8cc;
const MARKER = 0xf29a1c;
const GLOW: Readonly<Record<number, readonly [number, number, number]>> = {
  [BUS_WINDOW]: [0.95, 0.85, 0.6],
  [BUS_DOOR]: [0.7, 0.62, 0.45],
  [SIGN]: [1.6, 0.55, 0.08],
  [MARKER]: [1.3, 0.55, 0.05],
};
/** Painted bodies' edges are rounded off by this share of their smallest side. */
const BODY_ROUNDING = 0.14;
const WHEEL_SEGMENTS = 12;
/** A wheel arch in a body's side is drawn in this many straight steps. */
const ARCH_STEPS = 6;
/** Windows and the like lie this far off the face under them, meters, so they never flicker into it. */
const PANE_CLEARANCE = 0.012;
/** Every vehicle has two headlights and two tail lights, in this order: front left, front right, rear left, rear right. */
const LAMPS_PER_VEHICLE = 4;
const HEADLIGHT = 0xfff4d6;
const TAIL_LIGHT = 0xff3322;
const HEADLIGHT_GLOW = 0xfff1cf;
const TAIL_LIGHT_GLOW = 0xff2a1a;
const GLOW_SIZE_METERS = 1.6;
/** The glow sits this far out from the lamp's face, clear of the body. */
const GLOW_OFFSET_METERS = 0.12;
/** The lamps shine this much brighter at night (setLamps(1)) than by day. */
const LAMP_NIGHT_BOOST = 1.5;
/**
 * headlampsNear: a vehicle's headlights fade out over this many meters
 * before the reach, and the farthest one shown as the next one out comes
 * within this many meters of it, so none pops in or out.
 */
const HEADLAMP_FADE_METERS = 20;
/** The soft shadow under a vehicle reaches this much past its sides and ends, meters, and is this dark in its middle. */
const SHADOW_MARGIN_METERS = 0.7;
const SHADOW_OPACITY = 0.5;

export interface TrafficViewOptions {
  /** False leaves the lamps without their glow at night (weaker devices). Default: true. */
  readonly lampGlows?: boolean;
  /** The vehicles cast the sun's real-time shadows (the high preset's shadow map). Default: false. */
  readonly castShadows?: boolean;
  /** The sky their paint and glass mirror (EnvironmentView.sky); without it they mirror nothing. */
  readonly sky?: SkyUniforms;
}

/** How much each part mirrors the sky (skyReflection's per-vertex shine): glossy paint, glass, dull trim, no tyres. */
const SHINE: Readonly<Record<number, number>> = {
  [PAINT]: 0.85,
  [GLASS]: 1,
  [TRIM]: 0.25,
  [TYRE]: 0,
  [HUB]: 0.6,
  [BUS_WHITE]: 0.85,
  [BUS_WINDOW]: 1,
  [BUS_DOOR]: 1,
  [SIGN]: 0.4,
  [PLATE]: 0.4,
  [BOX_WHITE]: 0.6,
  [RIB]: 0.5,
  [MARKER]: 0.6,
};
/**
 * The traffic's own light, over its lighting: only the painted parts take
 * the vehicle's paint (the instance colour), and what glows at night (GLOW)
 * glows as bright as the lamps shine (nightLights).
 */
const OWN_LIGHT_VERTEX_PARS = /* glsl */ `
attribute float paint;
attribute vec3 glow;
varying vec3 vGlow;
`;
const OWN_LIGHT_COLOR = /* glsl */ `
vColor = vec4( color, 1.0 );
#ifdef USE_INSTANCING_COLOR
  vColor.rgb *= mix( vec3( 1.0 ), instanceColor.rgb, paint );
#endif
vGlow = glow;
`;
const OWN_LIGHT_FRAGMENT_PARS = /* glsl */ `
uniform float nightLights;
varying vec3 vGlow;
`;

/**
 * Draws the NPC traffic (roadmap step 22): one instanced mesh per kind of
 * vehicle, so all traffic costs a draw call per kind, and one more for all
 * their lamps (self-lit, so they shine at night). Shapes are generic and
 * original, low-poly but detailed: a hatchback, a saloon, a minibus and a
 * box lorry drawn from their side profiles, with arches over the wheels, glass
 * between the pillars, bumpers, grilles, plates and mirrors, and a city
 * bus; painted per vehicle, each on a soft shadow (one more draw call for
 * all of them). Vehicles move between fixed steps
 * like the truck (interpolated poses). At night (setLamps) the lamps glow,
 * one more draw call. Per frame it only writes instance matrices (and glow
 * positions at night), and colours when a new vehicle takes a slot.
 */
export class TrafficView implements TrafficHeadlamps {
  private readonly root = new Group();
  private readonly meshes: InstancedMesh[];
  private readonly material: MeshLambertMaterial;
  /** The vehicle (by serial) each instance of each mesh showed last frame, to repaint only when it changes. */
  private readonly shown: Int32Array[];
  private readonly counts: Int32Array;
  /** All vehicles' lamps: LAMPS_PER_VEHICLE instances per vehicle, in the order vehicles are drawn. */
  private readonly lamps: InstancedMesh;
  private readonly lampMaterial = new MeshBasicMaterial();
  /** Per kind: each lamp's box in the vehicle's frame, and where its glow sits (x, y, z per lamp). */
  private readonly lampBoxes: readonly (readonly Matrix4[])[];
  private readonly glowSpots: readonly Float32Array[];
  private readonly glows: LampGlows;
  /** Every vehicle's soft shadow, in the order vehicles are drawn; each kind's size (x, z scale) for its shadow. */
  private readonly shadows: InstancedMesh;
  private readonly shadowTexture: DataTexture;
  private readonly shadowSizes: readonly (readonly [number, number])[];
  /** How brightly what glows at night glows (GLOW, setLamps). */
  private readonly nightLights = { value: 0 };
  private readonly matrix = new Matrix4();
  private readonly lampMatrix = new Matrix4();
  private readonly shadowMatrix = new Matrix4();
  private readonly paint = new Color();
  /** The vehicles drawn last (update): where each stands, the way it faces and its kind (headlampsNear). */
  private readonly placedX: Float32Array;
  private readonly placedZ: Float32Array;
  private readonly placedHeading: Float32Array;
  private readonly placedType: Int32Array;
  private placedCount = 0;
  /** Scratch for headlampsNear: the nearest vehicles (into placed*) and their squared distances, nearest first. */
  private nearest = new Int32Array(0);
  private nearestSq = new Float64Array(0);

  constructor(
    private readonly scene: Scene,
    types: readonly TrafficVehicleDefinition[],
    capacity: number,
    private readonly options: TrafficViewOptions = {},
  ) {
    const instances = Math.max(1, capacity);
    const shapes = types.map(shapeOf);
    this.material = new MeshLambertMaterial({ vertexColors: true });
    if (options.sky !== undefined) {
      reflectSky(this.material, options.sky, { facing: 0.05, perVertex: true });
    }
    this.lightOwn(this.material);
    this.meshes = types.map((type, index) => {
      const mesh = new InstancedMesh(merged(shapes[index]!.parts), this.material, instances);
      mesh.name = `traffic:${type.id}`;
      mesh.count = 0;
      // Instances roam the whole map: the mesh's own bounds would cull them wrongly. Few vertices, cheap to draw.
      mesh.frustumCulled = false;
      mesh.castShadow = options.castShadows === true;
      mesh.setColorAt(0, this.paint.setHex(PAINT));
      this.root.add(mesh);
      return mesh;
    });
    this.shadowTexture = toTexture(softBoxShadowImage(), { srgb: false });
    this.shadows = new InstancedMesh(
      new PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0.06, 0),
      new MeshBasicMaterial({
        map: this.shadowTexture,
        color: 0x000000,
        transparent: true,
        opacity: SHADOW_OPACITY,
        depthWrite: false,
      }),
      instances,
    );
    this.shadows.name = 'traffic:shadows';
    this.shadows.count = 0;
    this.shadows.frustumCulled = false;
    this.shadowSizes = types.map((type) => [type.widthMeters + SHADOW_MARGIN_METERS * 2, type.lengthMeters + SHADOW_MARGIN_METERS * 2]);
    this.root.add(this.shadows);
    this.shown = types.map(() => new Int32Array(instances));
    this.counts = new Int32Array(types.length);
    const placed = instances * Math.max(1, types.length);
    this.placedX = new Float32Array(placed);
    this.placedZ = new Float32Array(placed);
    this.placedHeading = new Float32Array(placed);
    this.placedType = new Int32Array(placed);

    this.lampBoxes = shapes.map(({ lamps }) => lamps.map(({ box }) => box));
    this.glowSpots = shapes.map(({ lamps }) => new Float32Array(lamps.flatMap(({ glow }) => glow)));
    const lampCount = instances * LAMPS_PER_VEHICLE;
    this.lamps = new InstancedMesh(new BoxGeometry(1, 1, 1), this.lampMaterial, lampCount);
    this.lamps.name = 'traffic:lamps';
    this.lamps.count = 0;
    this.lamps.frustumCulled = false;
    this.glows = new LampGlows(lampCount, GLOW_SIZE_METERS);
    // Every vehicle lists its lamps in the same order, so their colours never change.
    for (let lamp = 0; lamp < lampCount; lamp++) {
      const front = lamp % LAMPS_PER_VEHICLE < 2;
      this.lamps.setColorAt(lamp, this.paint.setHex(front ? HEADLIGHT : TAIL_LIGHT));
      this.glows.setColor(lamp, front ? HEADLIGHT_GLOW : TAIL_LIGHT_GLOW);
    }
    this.root.add(this.lamps, this.glows.points);
    this.root.name = 'traffic';
    scene.add(this.root);
  }

  /** How brightly the lamps shine, 0..1 (the weather: 0 by day, 1 at night), and the buses' insides and signs. Cheap to call every frame. */
  setLamps(level: number): void {
    this.nightLights.value = level;
    this.lampMaterial.color.setScalar(1 + level * LAMP_NIGHT_BOOST);
    this.glows.setLevel(this.options.lampGlows === false ? 0 : level);
  }

  /**
   * Shows `traffic`'s vehicles `alpha` (0..1) of the way from their pose
   * before the last fixed step to their current one; nothing when null.
   * Allocation-free.
   */
  update(traffic: TrafficSimulation | null, alpha: number): void {
    const counts = this.counts;
    counts.fill(0);
    const glowing = this.glows.visible;
    let lamps = 0;
    let shadows = 0;
    this.placedCount = 0;
    if (traffic !== null) {
      for (let i = 0; i < traffic.capacity; i++) {
        if (traffic.active[i] !== 1) {
          continue;
        }
        const type: number = traffic.type[i]!;
        const mesh = this.meshes[type];
        if (mesh === undefined || counts[type]! >= mesh.instanceMatrix.count) {
          continue;
        }
        const slot = counts[type]!++;
        const x = traffic.previousX[i]! + (traffic.x[i]! - traffic.previousX[i]!) * alpha;
        const z = traffic.previousZ[i]! + (traffic.z[i]! - traffic.previousZ[i]!) * alpha;
        const heading = traffic.previousHeading[i]! + (traffic.heading[i]! - traffic.previousHeading[i]!) * alpha;
        mesh.setMatrixAt(slot, this.matrix.makeRotationY(heading).setPosition(x, 0, z));
        const shadowSize = this.shadowSizes[type]!;
        this.shadows.setMatrixAt(shadows++, this.shadowMatrix.makeScale(shadowSize[0], 1, shadowSize[1]).premultiply(this.matrix));
        const shown = this.shown[type]!;
        if (shown[slot] !== traffic.serial[i]) {
          shown[slot] = traffic.serial[i]!;
          mesh.setColorAt(slot, this.paint.setHex(traffic.color[i]!));
          mesh.instanceColor!.needsUpdate = true;
        }
        lamps = this.placeLamps(type, lamps, x, z, heading, glowing);
        const placed = this.placedCount++;
        this.placedX[placed] = x;
        this.placedZ[placed] = z;
        this.placedHeading[placed] = heading;
        this.placedType[placed] = type;
      }
    }
    for (let type = 0; type < this.meshes.length; type++) {
      const mesh = this.meshes[type]!;
      if (mesh.count !== counts[type] || counts[type]! > 0) {
        mesh.count = counts[type]!;
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
    if (this.lamps.count !== lamps || lamps > 0) {
      this.lamps.count = lamps;
      this.lamps.instanceMatrix.needsUpdate = true;
    }
    if (this.shadows.count !== shadows || shadows > 0) {
      this.shadows.count = shadows;
      this.shadows.instanceMatrix.needsUpdate = true;
    }
    this.glows.setCount(glowing ? lamps : 0);
  }

  /**
   * The headlamps of up to `strengths.length` vehicles nearest (`x`, `z`),
   * as last drawn (update), within `reach` meters: see TrafficHeadlamps.
   * Allocation-free once it has been asked for that many.
   */
  headlampsNear(
    x: number,
    z: number,
    reach: number,
    lamps: readonly Vector3[],
    forwards: readonly Vector3[],
    strengths: number[],
  ): number {
    const wanted = Math.min(Math.floor(lamps.length / 2), forwards.length, strengths.length);
    if (wanted <= 0) {
      return 0;
    }
    if (this.nearest.length < wanted) {
      this.nearest = new Int32Array(wanted);
      this.nearestSq = new Float64Array(wanted);
    }
    const { nearest, nearestSq } = this;
    const reachSq = reach * reach;
    let found = 0;
    // The nearest vehicle left out: the farthest shown fades as it comes as near.
    let nextSq = reachSq;
    for (let vehicle = 0; vehicle < this.placedCount; vehicle++) {
      const dx = this.placedX[vehicle]! - x;
      const dz = this.placedZ[vehicle]! - z;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq >= reachSq) {
        continue;
      }
      if (found === wanted) {
        if (distanceSq >= nearestSq[wanted - 1]!) {
          nextSq = Math.min(nextSq, distanceSq);
          continue;
        }
        nextSq = Math.min(nextSq, nearestSq[wanted - 1]!);
      }
      let slot = found < wanted ? found++ : wanted - 1;
      while (slot > 0 && nearestSq[slot - 1]! > distanceSq) {
        nearestSq[slot] = nearestSq[slot - 1]!;
        nearest[slot] = nearest[slot - 1]!;
        slot--;
      }
      nearestSq[slot] = distanceSq;
      nearest[slot] = vehicle;
    }
    const next = Math.sqrt(nextSq);
    for (let slot = 0; slot < found; slot++) {
      const vehicle = nearest[slot]!;
      const distance = Math.sqrt(nearestSq[slot]!);
      // The last one shown makes way for the next; every one fades toward the reach.
      const edge = slot === found - 1 ? next : reach;
      strengths[slot] = Math.min(1, Math.max(0, (edge - distance) / HEADLAMP_FADE_METERS));
      const heading = this.placedHeading[vehicle]!;
      const sin = Math.sin(heading);
      const cos = Math.cos(heading);
      const spots = this.glowSpots[this.placedType[vehicle]!]!;
      const vx = this.placedX[vehicle]!;
      const vz = this.placedZ[vehicle]!;
      // The front lamps come first (front left, front right), turned by the heading like makeRotationY.
      for (let lamp = 0; lamp < 2; lamp++) {
        const localX = spots[lamp * 3]!;
        const localZ = spots[lamp * 3 + 2]!;
        lamps[slot * 2 + lamp]!.set(vx + localX * cos + localZ * sin, spots[lamp * 3 + 1]!, vz - localX * sin + localZ * cos);
      }
      forwards[slot]!.set(sin, 0, cos);
    }
    return found;
  }

  /**
   * Every vehicle's lamps as last drawn (update), for a wet road to mirror
   * (WetReflections): the headlights facing ahead, the tail lights facing
   * back. Allocation-free.
   */
  mirrorLamps(into: LampMirror): void {
    for (let vehicle = 0; vehicle < this.placedCount; vehicle++) {
      const heading = this.placedHeading[vehicle]!;
      const sin = Math.sin(heading);
      const cos = Math.cos(heading);
      const spots = this.glowSpots[this.placedType[vehicle]!]!;
      const vx = this.placedX[vehicle]!;
      const vz = this.placedZ[vehicle]!;
      for (let lamp = 0; lamp < LAMPS_PER_VEHICLE; lamp++) {
        const localX = spots[lamp * 3]!;
        const localZ = spots[lamp * 3 + 2]!;
        // The front lamps come first, turned by the heading like makeRotationY.
        const facing = lamp < 2 ? 1 : -1;
        into.add(
          lamp < 2 ? 'head' : 'tail',
          vx + localX * cos + localZ * sin,
          spots[lamp * 3 + 1]!,
          vz - localX * sin + localZ * cos,
          facing * sin,
          facing * cos,
        );
      }
    }
  }

  dispose(): void {
    this.scene.remove(this.root);
    for (const mesh of [...this.meshes, this.lamps, this.shadows]) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.material.dispose();
    this.lampMaterial.dispose();
    (this.shadows.material as MeshBasicMaterial).dispose();
    this.shadowTexture.dispose();
    this.glows.dispose();
  }

  /** Gives `material` the traffic's own light (OWN_LIGHT_*), after whatever it does to its shaders already. */
  private lightOwn(material: MeshLambertMaterial): void {
    const previous = material.onBeforeCompile.bind(material);
    const key = material.customProgramCacheKey();
    const nightLights = this.nightLights;
    material.onBeforeCompile = (shader, renderer) => {
      previous(shader, renderer);
      shader.uniforms['nightLights'] = nightLights;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${OWN_LIGHT_VERTEX_PARS}`)
        .replace('#include <color_vertex>', OWN_LIGHT_COLOR);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${OWN_LIGHT_FRAGMENT_PARS}`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vGlow * nightLights;');
    };
    material.customProgramCacheKey = () => `${key}|traffic-own-light`;
  }

  /**
   * Places the lamps of a vehicle of kind `type` at (x, z), facing `heading`,
   * from lamp instance `first` on (and their glows, when `glowing`). Returns
   * the next free lamp instance.
   */
  private placeLamps(type: number, first: number, x: number, z: number, heading: number, glowing: boolean): number {
    const boxes = this.lampBoxes[type]!;
    for (let lamp = 0; lamp < LAMPS_PER_VEHICLE; lamp++) {
      this.lamps.setMatrixAt(first + lamp, this.lampMatrix.multiplyMatrices(this.matrix, boxes[lamp]!));
    }
    if (glowing) {
      const spots = this.glowSpots[type]!;
      const sin = Math.sin(heading);
      const cos = Math.cos(heading);
      for (let lamp = 0; lamp < LAMPS_PER_VEHICLE; lamp++) {
        const localX = spots[lamp * 3]!;
        const localZ = spots[lamp * 3 + 2]!;
        // Turned by the heading, like makeRotationY.
        this.glows.setPosition(first + lamp, x + localX * cos + localZ * sin, spots[lamp * 3 + 1]!, z - localX * sin + localZ * cos);
      }
    }
    return first + LAMPS_PER_VEHICLE;
  }
}

/** A vehicle's body (without its lamps), centred on its middle at ground level, facing +Z. */
export function vehicleGeometry(type: TrafficVehicleDefinition): BufferGeometry {
  return merged(shapeOf(type).parts);
}

/** Where a vehicle's lamps are: each one's box in the vehicle's frame, and the point its glow sits at. */
export function vehicleLamps(type: TrafficVehicleDefinition): readonly VehicleLamp[] {
  const shape = shapeOf(type);
  for (const part of shape.parts) {
    part.dispose();
  }
  return shape.lamps;
}

export interface VehicleLamp {
  /** A unit cube's transform to the lamp's box. */
  readonly box: Matrix4;
  readonly glow: readonly [number, number, number];
}

interface VehicleShape {
  readonly parts: BufferGeometry[];
  readonly lamps: readonly VehicleLamp[];
}

function merged(parts: BufferGeometry[]): BufferGeometry {
  const geometry = mergeGeometries(parts);
  for (const part of parts) {
    part.dispose();
  }
  return geometry;
}

function shapeOf(type: TrafficVehicleDefinition): VehicleShape {
  switch (type.kind) {
    case 'car':
      return carShape(type.lengthMeters, type.widthMeters, type.heightMeters, type.carBody ?? 'hatchback');
    case 'minibus':
      return minibusShape(type.lengthMeters, type.widthMeters, type.heightMeters);
    case 'truck':
      return lorryShape(type.lengthMeters, type.widthMeters, type.heightMeters);
    case 'bus':
      return busShape(type.lengthMeters, type.widthMeters, type.heightMeters);
  }
}

/**
 * How a car's back is shaped, by its body (meters in from the tail):
 * where the rear window's foot is and how high over the waist, where the
 * roof's rear edge ends and the roof itself, how far the rear side window
 * keeps off the rear window's line (the pillar behind it), the rear door's
 * back edge and handle, the rear axle, and its tail lamps' height.
 */
const CAR_BACKS: Readonly<
  Record<TrafficCarBody, { glassFoot: number; glassRise: number; roofEdge: number; roof: number; pillar: number; door: number; axle: number; tailLamps: number }>
> = {
  hatchback: { glassFoot: 0.26, glassRise: 0.04, roofEdge: 0.92, roof: 1.2, pillar: 0.2, door: 0.7, axle: 0.82, tailLamps: 0.74 },
  saloon: { glassFoot: 1.02, glassRise: 0.07, roofEdge: 1.5, roof: 1.78, pillar: 0.12, door: 1.25, axle: 0.95, tailLamps: 0.72 },
};

/**
 * A car: a body drawn from its side (a short nose, the bonnet rising to the
 * windscreen, the waist along the doors, then a squared-off tail, or a boot
 * behind the rear window on a saloon) with arches over the wheels, and the
 * narrower cabin on it (the roof, the pillars, the raked windscreen and the
 * rear window). Windows in the doors either side of the pillar between
 * them; the doors' lines and handles, the grille and the air intake in
 * bumpers of the body's colour, plates and mirrors.
 */
function carShape(length: number, width: number, height: number, body: TrafficCarBody): VehicleShape {
  const back = CAR_BACKS[body];
  const front = length / 2;
  const wheel = 0.31;
  const axles = [-front + back.axle, front - 0.8 - (length - 4.3) / 4];
  const sill = 0.3;
  const waist = 0.9;
  // The tail: a hatch's squared-off end, or a saloon's boot lid over its lamps.
  const tail: [number, number][] =
    body === 'saloon'
      ? [
          [-front + back.glassFoot, waist + back.glassRise - 0.02],
          [-front + 0.3, waist + 0.1],
          [-front + 0.05, waist + 0.08],
          [-front, 0.66],
        ]
      : [
          [-front + 0.45, waist + 0.06],
          [-front + 0.15, waist + 0.07],
          [-front + 0.02, 0.86],
          [-front, 0.62],
        ];
  const outline: [number, number][] = [
    [front - 0.07, sill],
    [front, 0.42],
    [front, 0.62],
    [front - 0.07, 0.76],
    [front - 0.55, 0.85],
    [front - 1.2, waist],
    ...tail,
    [-front + 0.02, 0.42],
    [-front + 0.1, sill],
    ...archesAlong(sill, wheel, axles, wheel + 0.08),
  ];
  // The cabin: from the windscreen's foot (sunk into the body) up to the roof and down the rear window.
  const cabinWidth = width * 0.84;
  const cabin: [number, number][] = [
    [front - 1.12, waist - 0.04],
    [front - 2.15, height - 0.06],
    [front - 2.35, height],
    [-front + back.roof, height - 0.01],
    [-front + back.roofEdge, height - 0.08],
    [-front + back.glassFoot, waist + back.glassRise],
    [-front + back.glassFoot, waist - 0.04],
  ];
  const windowFoot = waist + 0.04;
  const windowTop = height - 0.1;
  const pillar = -0.55;
  const aPillar = along(cabin[0]!, cabin[1]!);
  const cPillar = along(cabin[4]!, cabin[5]!);
  const parts = [
    profile(outline, width, 0.07, PAINT),
    profile(cabin, cabinWidth, 0.05, PAINT),
    slopedPanel(cabin[0]!, cabin[1]!, cabinWidth / 2 - 0.08, 0.06, 0.05, GLASS),
    slopedPanel(cabin[4]!, cabin[5]!, cabinWidth / 2 - 0.1, 0.05, 0.06, GLASS),
    // Arches' insides, dark, so nothing shows through under the car.
    ...axles.map((z) => box(width - 0.44, 0.34, 0.86, 0, wheel + 0.2, z, TRIM)),
    // Bumpers in the body's colour: the grille and the air intake under it at the front, a dark strip at the back.
    box(0.66, 0.12, 0.03, 0, 0.6, front - 0.005, TRIM),
    box(width - 0.36, 0.1, 0.03, 0, 0.36, front - 0.005, TRIM),
    box(width - 0.2, 0.08, 0.03, 0, 0.35, -front + 0.005, TRIM),
    box(0.5, 0.11, 0.02, 0, 0.47, front + 0.01, PLATE),
    box(0.5, 0.11, 0.02, 0, 0.56, -front - 0.01, PLATE),
    ...wheels(width, wheel, axles),
  ];
  for (const side of [1, -1]) {
    const glass = side * (cabinWidth / 2 + 0.006);
    const skin = side * (width / 2 + 0.004);
    parts.push(
      sidePanel(
        [
          [aPillar(windowFoot) - 0.09, windowFoot],
          [aPillar(windowTop) - 0.09, windowTop],
          [pillar + 0.04, windowTop],
          [pillar + 0.04, windowFoot],
        ],
        glass,
        GLASS,
      ),
      sidePanel(
        [
          [pillar - 0.04, windowFoot],
          [pillar - 0.04, windowTop],
          [cPillar(windowTop) + back.pillar, windowTop],
          [cPillar(windowFoot) + back.pillar, windowFoot],
        ],
        glass,
        GLASS,
      ),
      // The doors' edges and handles.
      line(skin, front - 1.25, 0.36, waist - 0.02),
      line(skin, pillar, sill + 0.04, waist + 0.04),
      line(skin, -front + back.door, wheel + 0.42, waist + 0.04),
      sidePanel(rectangle(pillar + 0.28, 0.83, 0.16, 0.035), skin, TRIM),
      sidePanel(rectangle(-front + back.door + 0.25, 0.85, 0.16, 0.035), skin, TRIM),
      // The mirror on its arm, by the windscreen's foot.
      box(0.08, 0.1, 0.16, side * (width / 2 + 0.09), waist + 0.08, front - 1.25, PAINT),
      box(0.1, 0.03, 0.06, side * (width / 2 + 0.03), waist + 0.06, front - 1.22, TRIM),
    );
  }
  return {
    parts,
    lamps: lamps(
      length,
      { x: width / 2 - 0.26, y: 0.66, width: 0.34, height: 0.13 },
      { x: width / 2 - 0.17, y: back.tailLamps, width: 0.26, height: 0.14 },
    ),
  };
}

/**
 * A minibus: a short bonnet under a tall windscreen, one long body with
 * arches over the wheels, a band of windows along both sides with pillars
 * between them (lit from inside at night), the front doors' windows, a
 * sliding door on the kerb side and two rear doors with their windows;
 * bumpers, the grille, plates and mirrors on arms.
 */
function minibusShape(length: number, width: number, height: number): VehicleShape {
  const front = length / 2;
  const wheel = 0.35;
  const axles = [-front + 1.1, front - 1.0];
  const floor = 0.34;
  const outline: [number, number][] = [
    [front - 0.05, floor],
    [front, 0.46],
    [front, 0.98],
    [front - 0.12, 1.1],
    [front - 0.66, 1.2],
    [front - 1.55, height - 0.16],
    [front - 1.75, height],
    [-front + 0.12, height],
    [-front, height - 0.12],
    [-front, 0.46],
    [-front + 0.05, floor],
    ...archesAlong(floor, wheel, axles, wheel + 0.09),
  ];
  const aPillar = along(outline[4]!, outline[5]!);
  const windowFoot = 1.44;
  const windowTop = height - 0.3;
  const back = -front - 0.006;
  const parts = [
    profile(outline, width, 0.08, PAINT),
    slopedPanel(outline[4]!, outline[5]!, width / 2 - 0.12, 0.08, 0.06, GLASS),
    // The rear doors' windows, and the line between the doors.
    backPanel(-width / 2 + 0.16, -0.08, windowFoot, windowTop, back, GLASS),
    backPanel(0.08, width / 2 - 0.16, windowFoot, windowTop, back, GLASS),
    backPanel(-0.012, 0.012, floor + 0.12, height - 0.1, back, TRIM),
    ...axles.map((z) => box(width - 0.5, 0.36, 0.95, 0, wheel + 0.22, z, TRIM)),
    box(width - 0.08, 0.26, 0.16, 0, 0.47, front - 0.08, TRIM),
    box(width - 0.08, 0.24, 0.14, 0, 0.45, -front + 0.07, TRIM),
    box(1.1, 0.26, 0.03, 0, 0.82, front - 0.005, TRIM),
    box(0.5, 0.11, 0.02, 0, 0.47, front + 0.01, PLATE),
    box(0.5, 0.11, 0.02, 0, 0.75, -front - 0.01, PLATE),
    ...wheels(width, wheel, axles),
  ];
  // The band of windows behind the front doors: three panes, the middle one the sliding door's on the kerb side.
  const panes: [number, number][] = [
    [0.86, -0.46],
    [-0.58, -1.86],
    [-1.98, -front + 0.2],
  ];
  for (const side of [1, -1]) {
    const skin = side * (width / 2 + 0.006);
    parts.push(
      sidePanel(
        [
          [aPillar(windowFoot) - 0.1, windowFoot],
          [aPillar(windowTop) - 0.1, windowTop],
          [1.05, windowTop],
          [1.05, windowFoot],
        ],
        skin,
        GLASS,
      ),
      // Lit from inside at night, as the bus's are.
      ...panes.map(([from, to]) => sidePanel(rectangle((from + to) / 2, (windowFoot + windowTop) / 2, from - to, windowTop - windowFoot), skin, BUS_WINDOW)),
      line(skin, front - 0.64, floor + 0.14, 1.14),
      line(skin, 0.97, floor + 0.12, height - 0.2),
      sidePanel(rectangle(1.16, 1.3, 0.16, 0.035), skin, TRIM),
      // Mirrors on arms by the windscreen's foot, black.
      box(0.16, 0.035, 0.05, side * (width / 2 + 0.07), 1.5, front - 0.72, TRIM),
      box(0.07, 0.3, 0.16, side * (width / 2 + 0.16), 1.62, front - 0.72, TRIM),
    );
  }
  // The sliding door on the kerb side (-X, the right facing +Z): its back edge and handle.
  parts.push(line(-(width / 2 + 0.006), -0.52, floor + 0.12, height - 0.2), sidePanel(rectangle(-0.38, 1.3, 0.16, 0.035), -(width / 2 + 0.006), TRIM));
  return {
    parts,
    lamps: lamps(length, { x: width / 2 - 0.3, y: 0.94, width: 0.36, height: 0.16 }, { x: width / 2 - 0.1, y: 1.0, width: 0.14, height: 0.36 }),
  };
}

/**
 * A box lorry: a cab over the front axle in the fleet's colour, its
 * windscreen, door windows, grille, bumper and mirrors on arms; a white box
 * on the chassis with ribs up its sides, rails along its top and foot, the
 * fleet's stripe, amber markers along its sides (lit at night), and two
 * rear doors with their hinges and locking bars; a fuel tank and side
 * guards between the axles, a bar at the back with the tail lamps and the
 * plate, a tandem rear axle.
 */
function lorryShape(length: number, width: number, height: number): VehicleShape {
  const front = length / 2;
  const wheel = 0.45;
  const frontAxle = front - 1.4;
  const rearAxles = [-front + 2.2, -front + 1.1];
  const cabBack = front - 2.12;
  const cabTop = height * 0.78;
  const cabFloor = 0.55;
  const cab: [number, number][] = [
    [front - 0.03, 0.46],
    [front, 0.6],
    [front, 1.42],
    [front - 0.07, cabTop - 0.2],
    [front - 0.18, cabTop],
    [cabBack + 0.06, cabTop],
    [cabBack, cabTop - 0.08],
    [cabBack, cabFloor],
    ...archesAlong(cabFloor, wheel, [frontAxle], wheel + 0.07),
  ];
  const boxFront = cabBack - 0.12;
  const boxRear = -front + 0.02;
  const boxFoot = 0.98;
  const boxLength = boxFront - boxRear;
  const boxMiddle = (boxFront + boxRear) / 2;
  const back = boxRear - 0.005;
  const parts = [
    profile(cab, width, 0.1, PAINT),
    slopedPanel(cab[2]!, cab[3]!, width / 2 - 0.14, 0.1, 0.08, GLASS),
    box(1.5, 0.6, 0.03, 0, 1.08, front - 0.005, TRIM),
    box(width - 0.02, 0.32, 0.2, 0, 0.6, front - 0.1, TRIM),
    box(0.52, 0.11, 0.02, 0, 0.6, front + 0.01, PLATE),
    box(width - 0.6, 0.4, 1.0, 0, 0.75, frontAxle, TRIM),
    // The box: white, the fleet's stripe along its foot, rails along its top and foot.
    rounded(width, height - boxFoot, boxLength, 0, (height + boxFoot) / 2, boxMiddle, BOX_WHITE),
    box(width + 0.012, 0.2, boxLength - 0.1, 0, boxFoot + 0.24, boxMiddle, PAINT),
    box(width + 0.01, 0.07, boxLength, 0, height - 0.035, boxMiddle, RIB),
    box(width + 0.02, 0.1, boxLength, 0, boxFoot + 0.05, boxMiddle, TRIM),
    // Its rear doors: the line between them, the locking bars and the hinges.
    backPanel(-0.012, 0.012, boxFoot + 0.12, height - 0.1, back, TRIM),
    ...[-0.85, -0.35, 0.35, 0.85].map((x) => backPanel(x - 0.02, x + 0.02, boxFoot + 0.15, height - 0.15, back, RIB)),
    ...[1.35, 2.15, 2.9].flatMap((y) =>
      [1, -1].map((side) => backPanel(side * (width / 2 - 0.06) - 0.05, side * (width / 2 - 0.06) + 0.05, y - 0.06, y + 0.06, back, TRIM)),
    ),
    // The chassis, the bar at the back (the tail lamps and the plate on it), the tank and the guards.
    box(width * 0.72, 0.26, length - 0.4, 0, 0.7, -0.1, TRIM),
    box(width - 0.1, 0.3, 0.08, 0, 0.6, -front + 0.06, TRIM),
    box(0.52, 0.11, 0.02, 0, 0.6, -front + 0.01, PLATE),
    colored(new CylinderGeometry(0.27, 0.27, 1.0, 10).rotateX(Math.PI / 2).translate(width / 2 - 0.35, 0.72, 0.95), HUB),
    ...wheels(width, wheel, [frontAxle, ...rearAxles]),
  ];
  const ribs = Math.round((boxLength - 1) / 0.95);
  for (const side of [1, -1]) {
    const skin = side * (width / 2 + 0.004);
    parts.push(
      sidePanel(
        [
          [front - 0.16, 1.52],
          [front - 0.22, cabTop - 0.22],
          [front - 1.15, cabTop - 0.22],
          [front - 1.15, 1.52],
        ],
        side * (width / 2 + 0.006),
        GLASS,
      ),
      line(side * (width / 2 + 0.006), front - 1.28, cabFloor + 0.05, cabTop - 0.1),
      sidePanel(rectangle(front - 1.12, 1.35, 0.16, 0.035), side * (width / 2 + 0.006), TRIM),
      ...Array.from({ length: ribs + 1 }, (_, i) =>
        sidePanel(rectangle(boxFront - 0.5 - (i * (boxLength - 1)) / ribs, (boxFoot + 0.45 + height - 0.1) / 2, 0.07, height - boxFoot - 0.55), skin, RIB),
      ),
      ...[boxFront - 0.4, boxMiddle, boxRear + 0.4].map((z) => box(0.02, 0.06, 0.14, side * (width / 2 + 0.012), boxFoot + 0.12, z, MARKER)),
      box(0.04, 0.06, 3.2, side * (width / 2 - 0.03), 0.55, 0.35, TRIM),
      box(0.04, 0.06, 3.2, side * (width / 2 - 0.03), 0.8, 0.35, TRIM),
      // Mirrors on arms at the cab's front corners.
      box(0.25, 0.04, 0.05, side * (width / 2 + 0.1), 2.1, front - 0.25, TRIM),
      box(0.06, 0.42, 0.2, side * (width / 2 + 0.22), 1.95, front - 0.22, TRIM),
    );
  }
  return {
    parts,
    lamps: lamps(length, { x: width / 2 - 0.32, y: 0.62, width: 0.34, height: 0.14 }, { x: width / 2 - 0.24, y: 0.62, width: 0.3, height: 0.14 }),
  };
}

/**
 * A city bus: a two-tone livery (its paint up to the windows, white above),
 * the windows' band with pillars between the panes, a tall windscreen under
 * the route sign, two doors on the kerb side, the air-conditioning on the
 * roof, a rear window and bumpers.
 */
function busShape(length: number, width: number, height: number): VehicleShape {
  const wheel = 0.48;
  const floor = 0.36;
  // The livery's paint up to the windows, white above; the windows' band with pillars between the panes. The roof
  // stands low enough for the air-conditioning to make up the bus's height.
  const roof = height - 0.22;
  const belt = floor + (roof - floor) * 0.4;
  const windowTop = roof - 0.3;
  const windowHeight = windowTop - belt - 0.06;
  const windowY = belt + 0.03 + windowHeight / 2;
  const front = length / 2;
  // Two doors on the kerb side (-X: the right, facing +Z): at the front, and in the middle.
  const doorWidth = 1.15;
  const doors = [front - 0.95, 0.4];
  const panes: BufferGeometry[] = [];
  const pane = (side: number, fromZ: number, toZ: number): void => {
    panes.push(box(0.03, windowHeight, toZ - fromZ, side * (width / 2 + 0.004), windowY, (fromZ + toZ) / 2, BUS_WINDOW));
  };
  // Panes from behind the front door to the back, each run split by pillars.
  const runs: [number, number, number][] = [
    [1, -front + 0.7, front - 1.9],
    [-1, doors[1]! + doorWidth / 2 + 0.15, front - 1.9],
    [-1, -front + 0.7, doors[1]! - doorWidth / 2 - 0.15],
  ];
  for (const [side, fromZ, toZ] of runs) {
    const count = Math.max(1, Math.round((toZ - fromZ) / 1.9));
    const step = (toZ - fromZ) / count;
    for (let i = 0; i < count; i++) {
      pane(side, fromZ + i * step + 0.06, fromZ + (i + 1) * step - 0.06);
    }
  }
  return {
    parts: [
      // The painted skirt is square below; the white body above is rounded along the roof.
      box(width, belt - floor + 0.02, length, 0, (floor + belt) / 2, 0, PAINT),
      rounded(width, roof - belt, length, 0, (belt + roof) / 2, 0, BUS_WHITE),
      ...panes,
      // The driver's side window, the tall windscreen and the route sign over it.
      box(0.03, windowHeight, 1.3, width / 2 + 0.004, windowY, front - 1.05, BUS_WINDOW),
      box(width * 0.9, windowTop - floor - 0.55, 0.04, 0, (windowTop + floor + 0.55) / 2, front + 0.005, GLASS),
      box(width * 0.72, 0.24, 0.04, 0, windowTop + 0.15, front + 0.007, SIGN),
      ...doors.map((z) => box(0.03, windowTop - floor - 0.12, doorWidth, -(width / 2 + 0.005), (windowTop + floor + 0.12) / 2, z, BUS_DOOR)),
      // The rear window, the roof's air-conditioning, the bumpers and the skirt.
      box(width * 0.8, 0.7, 0.04, 0, windowTop - 0.4, -front + 0.005, GLASS),
      box(width * 0.62, height - roof, 2.6, 0, (roof + height) / 2, -length * 0.08, BUS_WHITE),
      box(width + 0.03, 0.14, length, 0, floor + 0.07, 0, TRIM),
      box(width * 0.96, 0.32, 0.1, 0, floor + 0.2, front - 0.03, TRIM),
      box(width * 0.96, 0.32, 0.1, 0, floor + 0.2, -front + 0.03, TRIM),
      ...wheels(width, wheel, [front - 2.4, -front + 2.8]),
    ],
    lamps: lamps(length, { x: width / 2 - 0.32, y: floor + 0.45, width: 0.4, height: 0.18 }, { x: width / 2 - 0.32, y: floor + 0.45, width: 0.32, height: 0.18 }),
  };
}

/**
 * A body drawn from its side: `outline` (z along the vehicle, forward, and
 * y up; once round, either way) extruded `width` wide across X and centred,
 * its edges rounded off by `bevel`, within the outline.
 */
function profile(outline: readonly (readonly [number, number])[], width: number, bevel: number, color: number): BufferGeometry {
  const shape = new Shape(outline.map(([z, y]) => new Vector2(z, y)));
  const depth = width - 2 * bevel;
  const extruded = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments: 2,
    curveSegments: 1,
  });
  // The outline's first axis along the vehicle (+Z), extruded across it (X), centred.
  extruded.rotateY(-Math.PI / 2).translate(depth / 2, 0, 0);
  // three.js builds it without an index; welded, it merges with the other (indexed) parts.
  const welded = mergeVertices(extruded);
  extruded.dispose();
  return colored(welded, color);
}

/**
 * The points of `sill`'s line (y) from the back to the front, arching up
 * over each wheel (`axles`, z, from the back; the wheels `wheel` meters in
 * radius) `radius` meters round its hub, for profile()'s outline.
 */
function archesAlong(sill: number, wheel: number, axles: readonly number[], radius: number): [number, number][] {
  const points: [number, number][] = [];
  for (const axle of axles) {
    for (let step = 0; step <= ARCH_STEPS; step++) {
      const angle = Math.PI * (1 - step / ARCH_STEPS);
      points.push([axle + radius * Math.cos(angle), Math.max(sill, wheel + radius * Math.sin(angle))]);
    }
  }
  return points;
}

/** Along an outline's edge from `from` to `to` (z, y): the z at a height. */
function along(from: readonly [number, number], to: readonly [number, number]): (y: number) => number {
  return (y) => from[0] + ((y - from[1]) / (to[1] - from[1])) * (to[0] - from[0]);
}

/**
 * A pane (the windscreen, the rear window) on the sloped face of a
 * profile() between its outline's points `from` and `to` (in the order the
 * outline runs over the top, front to back), `halfWidth` either side of the
 * middle, clear of the face's ends by `insetFrom` and `insetTo` meters,
 * lying just off the face.
 */
function slopedPanel(
  from: readonly [number, number],
  to: readonly [number, number],
  halfWidth: number,
  insetFrom: number,
  insetTo: number,
  color: number,
): BufferGeometry {
  const dz = to[0] - from[0];
  const dy = to[1] - from[1];
  const edge = Math.hypot(dz, dy);
  // Out of the body: the outline runs over the top from the front to the back.
  const outZ = (dy / edge) * PANE_CLEARANCE;
  const outY = (-dz / edge) * PANE_CLEARANCE;
  const at = (share: number): [number, number] => [from[0] + dz * share + outZ, from[1] + dy * share + outY];
  const [z0, y0] = at(insetFrom / edge);
  const [z1, y1] = at(1 - insetTo / edge);
  return panel(
    [
      [-halfWidth, y0, z0],
      [halfWidth, y0, z0],
      [halfWidth, y1, z1],
      [-halfWidth, y1, z1],
    ],
    color,
  );
}

/** A flat four-cornered panel (`corners`, x y z, round it the way that faces out), in one colour. */
function panel(corners: readonly (readonly [number, number, number])[], color: number): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(corners.flat()), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  return colored(geometry, color);
}

/** A rectangle on a vehicle's back at `z`, facing back: from `left` to `right` across it (x) and `bottom` to `top`. */
function backPanel(left: number, right: number, bottom: number, top: number, z: number, color: number): BufferGeometry {
  return panel(
    [
      [left, bottom, z],
      [left, top, z],
      [right, top, z],
      [right, bottom, z],
    ],
    color,
  );
}

/**
 * A flat panel (a window, a door's line) on a vehicle's side at `x` (its
 * sign the side), facing out: `outline` in z along the vehicle and y up.
 */
function sidePanel(outline: readonly (readonly [number, number])[], x: number, color: number): BufferGeometry {
  // A shape lies in its own plane facing +Z: turned to face out of the side, the first coordinate along the vehicle.
  const side = Math.sign(x);
  const shape = new Shape(outline.map(([z, y]) => new Vector2(side > 0 ? -z : z, y)));
  const geometry = new ShapeGeometry(shape).rotateY((side * Math.PI) / 2).translate(x, 0, 0);
  return colored(geometry, color);
}

/** A rectangle's corners (z, y) round its middle (`z`, `y`), `length` along the vehicle and `height` tall. */
function rectangle(z: number, y: number, length: number, height: number): [number, number][] {
  return [
    [z - length / 2, y - height / 2],
    [z - length / 2, y + height / 2],
    [z + length / 2, y + height / 2],
    [z + length / 2, y - height / 2],
  ];
}

/** A door's edge: a dark line up the side at `x`, at `z`, from `bottom` to `top`. */
function line(x: number, z: number, bottom: number, top: number): BufferGeometry {
  return sidePanel(rectangle(z, (bottom + top) / 2, 0.014, top - bottom), x, TRIM);
}

/** Where a lamp is on a vehicle's front or back: out from the middle, up from the ground, its size, meters. */
interface LampPlace {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A box `w` wide, `h` tall and `d` long centred at (x, y, z), in one colour. */
function box(w: number, h: number, d: number, x: number, y: number, z: number, color: number): BufferGeometry {
  return colored(new BoxGeometry(w, h, d).translate(x, y, z), color);
}

/** A box like box(), its edges rounded off: a body that catches the light and the sky along its edges. */
function rounded(w: number, h: number, d: number, x: number, y: number, z: number, color: number): BufferGeometry {
  const radius = Math.min(w, h, d) * BODY_ROUNDING;
  // three.js builds it without an index; welded, it merges with the other (indexed) parts.
  const shape = new RoundedBoxGeometry(w, h, d, 1, radius);
  const welded = mergeVertices(shape);
  shape.dispose();
  return colored(welded.translate(x, y, z), color);
}

/**
 * Headlights at the front and tail lights at the back, each pair where
 * `head` and `tail` put them, in the order LAMPS_PER_VEHICLE describes
 * (left is +X, the driver's left facing +Z), on the ends of a vehicle
 * `length` long.
 */
function lamps(length: number, head: LampPlace, tail: LampPlace): VehicleLamp[] {
  const lamp = (x: number, z: number, place: LampPlace, out: number): VehicleLamp => ({
    box: new Matrix4().makeScale(place.width, place.height, 0.06).setPosition(x, place.y, z),
    glow: [x, place.y, z + out * GLOW_OFFSET_METERS],
  });
  return [
    lamp(head.x, length / 2 + 0.02, head, 1),
    lamp(-head.x, length / 2 + 0.02, head, 1),
    lamp(tail.x, -length / 2 - 0.02, tail, -1),
    lamp(-tail.x, -length / 2 - 0.02, tail, -1),
  ];
}

/**
 * A pair of wheels on each axle, `axles` meters ahead of the middle, each
 * with a light rim on its outer face and a dark cap in the rim's middle.
 */
function wheels(width: number, radius: number, axles: readonly number[]): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  for (const z of axles) {
    for (const side of [-1, 1]) {
      const x = side * (width / 2 - 0.12);
      const tyre = new CylinderGeometry(radius, radius, 0.26, WHEEL_SEGMENTS).rotateZ(Math.PI / 2).translate(x, radius, z);
      parts.push(colored(tyre, TYRE));
      const rim = new CircleGeometry(radius * 0.6, WHEEL_SEGMENTS)
        .rotateY((side * Math.PI) / 2)
        .translate(x + side * 0.132, radius, z);
      parts.push(colored(rim, HUB));
      const cap = new CircleGeometry(radius * 0.2, 6)
        .rotateY((side * Math.PI) / 2)
        .translate(x + side * 0.136, radius, z);
      parts.push(colored(cap, TRIM));
    }
  }
  return parts;
}

/**
 * Gives every vertex of `geometry` one colour, the shine of the part that
 * colour stands for (SHINE), whether it takes the vehicle's paint (the
 * white parts only) and what it glows at night (GLOW).
 */
function colored(geometry: BufferGeometry, hex: number): BufferGeometry {
  const color = new Color(hex);
  const glow = GLOW[hex] ?? [0, 0, 0];
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  const glows = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
    glows.set(glow, i * 3);
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.setAttribute('shine', new BufferAttribute(new Float32Array(count).fill(SHINE[hex] ?? 0), 1));
  geometry.setAttribute('paint', new BufferAttribute(new Float32Array(count).fill(hex === PAINT ? 1 : 0), 1));
  geometry.setAttribute('glow', new BufferAttribute(glows, 3));
  return geometry;
}
