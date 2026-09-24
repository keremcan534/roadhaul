import {
  BoxGeometry,
  BufferAttribute,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type BufferGeometry,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { TrafficVehicleDefinition } from '../../data/definitions/TrafficVehicleDefinition';
import type { TrafficSimulation } from '../../domain/traffic/TrafficSimulation';
import { LampGlows } from '../vehicles/LampGlows';

/** Parts in white take the vehicle's paint (the instance colour); the rest are dark or light enough to stay themselves. */
const PAINT = 0xffffff;
const GLASS = 0x1d2630;
const TYRE = 0x161616;
const TRIM = 0x3a3d42;
const WHEEL_SEGMENTS = 10;
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
 * Draws the NPC traffic (roadmap step 22): one instanced mesh per kind of
 * vehicle, so all traffic costs a draw call per kind, and one more for all
 * their lamps (self-lit, so they shine at night). Shapes are generic and
 * original: a hatchback-like car, a van, a box lorry and a bus, low-poly
 * with dark glass and tyres, painted per vehicle. Vehicles move between
 * fixed steps like the truck (interpolated poses). At night (setLamps) the
 * lamps glow, one more draw call. Per frame it only writes instance
 * matrices (and glow positions at night), and colours when a new vehicle
 * takes a slot.
 */
export class TrafficView {
  private readonly root = new Group();
  private readonly meshes: InstancedMesh[];
  private readonly material = new MeshLambertMaterial({ vertexColors: true });
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
  private readonly matrix = new Matrix4();
  private readonly lampMatrix = new Matrix4();
  private readonly paint = new Color();

  /** `lampGlows: false` leaves the lamps without their glow at night (weaker devices). */
  constructor(
    private readonly scene: Scene,
    types: readonly TrafficVehicleDefinition[],
    capacity: number,
    private readonly options: { readonly lampGlows?: boolean } = {},
  ) {
    const instances = Math.max(1, capacity);
    const shapes = types.map(shapeOf);
    this.meshes = types.map((type, index) => {
      const mesh = new InstancedMesh(merged(shapes[index]!.parts), this.material, instances);
      mesh.name = `traffic:${type.id}`;
      mesh.count = 0;
      // Instances roam the whole map: the mesh's own bounds would cull them wrongly. Few vertices, cheap to draw.
      mesh.frustumCulled = false;
      mesh.setColorAt(0, this.paint.setHex(PAINT));
      this.root.add(mesh);
      return mesh;
    });
    this.shown = types.map(() => new Int32Array(instances));
    this.counts = new Int32Array(types.length);

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

  /** How brightly the lamps shine, 0..1 (the weather: 0 by day, 1 at night). Cheap to call every frame. */
  setLamps(level: number): void {
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
        const shown = this.shown[type]!;
        if (shown[slot] !== traffic.serial[i]) {
          shown[slot] = traffic.serial[i]!;
          mesh.setColorAt(slot, this.paint.setHex(traffic.color[i]!));
          mesh.instanceColor!.needsUpdate = true;
        }
        lamps = this.placeLamps(type, lamps, x, z, heading, glowing);
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
    this.glows.setCount(glowing ? lamps : 0);
  }

  dispose(): void {
    this.scene.remove(this.root);
    for (const mesh of [...this.meshes, this.lamps]) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.material.dispose();
    this.lampMaterial.dispose();
    this.glows.dispose();
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
  const length = type.lengthMeters;
  const width = type.widthMeters;
  const height = type.heightMeters;
  switch (type.kind) {
    case 'car': {
      const wheel = 0.31;
      const sill = 0.22;
      const body = height * 0.42;
      const glass = height - sill - body - 0.06;
      return {
        parts: [
          box(width, body, length, 0, sill + body / 2, 0, PAINT),
          // The glasshouse sits back from the bonnet, with the roof painted.
          box(width * 0.86, glass, length * 0.5, 0, sill + body + glass / 2, -length * 0.06, GLASS),
          box(width * 0.84, 0.06, length * 0.46, 0, height - 0.03, -length * 0.06, PAINT),
          ...wheels(width, wheel, [length * 0.32, -length * 0.32]),
        ],
        lamps: lamps(width, length, sill + body * 0.7, 0.3),
      };
    }
    case 'minibus': {
      const wheel = 0.35;
      const floor = 0.3;
      const body = height - floor;
      return {
        parts: [
          box(width, body, length, 0, floor + body / 2, 0, PAINT),
          // A band of side windows and the windscreen.
          box(width + 0.02, body * 0.32, length * 0.78, 0, floor + body * 0.72, -length * 0.06, GLASS),
          box(width * 0.9, body * 0.36, 0.04, 0, floor + body * 0.7, length / 2 + 0.01, GLASS),
          box(width, 0.12, length * 0.98, 0, floor + 0.06, 0, TRIM),
          ...wheels(width, wheel, [length * 0.34, -length * 0.34]),
        ],
        lamps: lamps(width, length, floor + body * 0.3, 0.32),
      };
    }
    case 'truck': {
      const wheel = 0.45;
      const cabLength = 2.1;
      const cabHeight = height * 0.78;
      const floor = 0.55;
      const cargoLength = length - cabLength - 0.25;
      const cab = cabHeight - floor;
      const cargo = height - floor - 0.1;
      const windowY = floor + cab * 0.72;
      return {
        parts: [
          // Cab at the front with its windscreen, the painted box behind, a dark chassis under both.
          box(width, cab, cabLength, 0, floor + cab / 2, length / 2 - cabLength / 2, PAINT),
          box(width * 0.9, cab * 0.36, 0.04, 0, windowY, length / 2 + 0.01, GLASS),
          box(width + 0.02, cab * 0.3, cabLength * 0.4, 0, windowY, length / 2 - cabLength * 0.3, GLASS),
          box(width, cargo, cargoLength, 0, floor + 0.1 + cargo / 2, -length / 2 + cargoLength / 2, PAINT),
          box(width * 0.8, 0.3, length * 0.96, 0, floor - 0.1, 0, TRIM),
          ...wheels(width, wheel, [length / 2 - 1.4, -length / 2 + 2.2, -length / 2 + 1.1]),
        ],
        lamps: lamps(width, length, floor + 0.35, 0.34),
      };
    }
    case 'bus': {
      const wheel = 0.48;
      const floor = 0.4;
      const body = height - floor;
      return {
        parts: [
          box(width, body, length, 0, floor + body / 2, 0, PAINT),
          box(width + 0.02, body * 0.36, length * 0.84, 0, floor + body * 0.66, -length * 0.03, GLASS),
          box(width * 0.92, body * 0.5, 0.04, 0, floor + body * 0.6, length / 2 + 0.01, GLASS),
          box(width + 0.03, 0.14, length, 0, floor + 0.07, 0, TRIM),
          ...wheels(width, wheel, [length / 2 - 2.4, -length / 2 + 2.8]),
        ],
        lamps: lamps(width, length, floor + 0.35, 0.4),
      };
    }
  }
}

/** A box `w` wide, `h` tall and `d` long centred at (x, y, z), in one colour. */
function box(w: number, h: number, d: number, x: number, y: number, z: number, color: number): BufferGeometry {
  return colored(new BoxGeometry(w, h, d).translate(x, y, z), color);
}

/**
 * Headlights at the front and tail lights at the back, `y` above the ground,
 * in the order LAMPS_PER_VEHICLE describes (left is +X, the driver's left
 * facing +Z).
 */
function lamps(width: number, length: number, y: number, size: number): VehicleLamp[] {
  const lamp = (x: number, z: number, lampWidth: number, out: number): VehicleLamp => ({
    box: new Matrix4().makeScale(lampWidth, size * 0.45, 0.06).setPosition(x, y, z),
    glow: [x, y, z + out * GLOW_OFFSET_METERS],
  });
  const x = width / 2 - size * 0.8;
  return [
    lamp(x, length / 2 + 0.02, size, 1),
    lamp(-x, length / 2 + 0.02, size, 1),
    lamp(x, -length / 2 - 0.02, size * 0.8, -1),
    lamp(-x, -length / 2 - 0.02, size * 0.8, -1),
  ];
}

/** A pair of wheels on each axle, `axles` meters ahead of the middle. */
function wheels(width: number, radius: number, axles: readonly number[]): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  for (const z of axles) {
    for (const side of [-1, 1]) {
      const tyre = new CylinderGeometry(radius, radius, 0.26, WHEEL_SEGMENTS)
        .rotateZ(Math.PI / 2)
        .translate(side * (width / 2 - 0.12), radius, z);
      parts.push(colored(tyre, TYRE));
    }
  }
  return parts;
}

function colored(geometry: BufferGeometry, hex: number): BufferGeometry {
  const color = new Color(hex);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}
