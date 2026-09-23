import {
  BoxGeometry,
  BufferAttribute,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  type BufferGeometry,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { TrafficVehicleDefinition } from '../../data/definitions/TrafficVehicleDefinition';
import type { TrafficSimulation } from '../../domain/traffic/TrafficSimulation';

/** Parts in white take the vehicle's paint (the instance colour); the rest are dark or light enough to stay themselves. */
const PAINT = 0xffffff;
const GLASS = 0x1d2630;
const TYRE = 0x161616;
const TRIM = 0x3a3d42;
const HEADLIGHT = 0xfff4d6;
const TAIL_LIGHT = 0xff3322;
const WHEEL_SEGMENTS = 10;

/**
 * Draws the NPC traffic (roadmap step 22): one instanced mesh per kind of
 * vehicle, so all traffic costs a draw call per kind. Shapes are generic
 * and original: a hatchback-like car, a van, a box lorry and a bus, low-poly
 * with dark glass and tyres, painted per vehicle. Vehicles move between
 * fixed steps like the truck (interpolated poses). Per frame it only writes
 * instance matrices, and colours when a new vehicle takes a slot.
 */
export class TrafficView {
  private readonly root = new Group();
  private readonly meshes: InstancedMesh[];
  private readonly material = new MeshLambertMaterial({ vertexColors: true });
  /** The vehicle (by serial) each instance of each mesh showed last frame, to repaint only when it changes. */
  private readonly shown: Int32Array[];
  private readonly counts: Int32Array;
  private readonly matrix = new Matrix4();
  private readonly paint = new Color();

  constructor(
    private readonly scene: Scene,
    types: readonly TrafficVehicleDefinition[],
    capacity: number,
  ) {
    const instances = Math.max(1, capacity);
    this.meshes = types.map((type) => {
      const mesh = new InstancedMesh(vehicleGeometry(type), this.material, instances);
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
    this.root.name = 'traffic';
    scene.add(this.root);
  }

  /**
   * Shows `traffic`'s vehicles `alpha` (0..1) of the way from their pose
   * before the last fixed step to their current one; nothing when null.
   * Allocation-free.
   */
  update(traffic: TrafficSimulation | null, alpha: number): void {
    const counts = this.counts;
    counts.fill(0);
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
      }
    }
    for (let type = 0; type < this.meshes.length; type++) {
      const mesh = this.meshes[type]!;
      if (mesh.count !== counts[type] || counts[type]! > 0) {
        mesh.count = counts[type]!;
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }

  dispose(): void {
    this.scene.remove(this.root);
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.material.dispose();
  }
}

/** A vehicle's shape, centred on its middle at ground level, facing +Z. */
export function vehicleGeometry(type: TrafficVehicleDefinition): BufferGeometry {
  const parts = partsFor(type);
  const geometry = mergeGeometries(parts);
  for (const part of parts) {
    part.dispose();
  }
  return geometry;
}

function partsFor(type: TrafficVehicleDefinition): BufferGeometry[] {
  const length = type.lengthMeters;
  const width = type.widthMeters;
  const height = type.heightMeters;
  switch (type.kind) {
    case 'car': {
      const wheel = 0.31;
      const sill = 0.22;
      const body = height * 0.42;
      const glass = height - sill - body - 0.06;
      return [
        box(width, body, length, 0, sill + body / 2, 0, PAINT),
        // The glasshouse sits back from the bonnet, with the roof painted.
        box(width * 0.86, glass, length * 0.5, 0, sill + body + glass / 2, -length * 0.06, GLASS),
        box(width * 0.84, 0.06, length * 0.46, 0, height - 0.03, -length * 0.06, PAINT),
        ...lights(width, length, sill + body * 0.7, 0.3),
        ...wheels(width, wheel, [length * 0.32, -length * 0.32]),
      ];
    }
    case 'minibus': {
      const wheel = 0.35;
      const floor = 0.3;
      const body = height - floor;
      return [
        box(width, body, length, 0, floor + body / 2, 0, PAINT),
        // A band of side windows and the windscreen.
        box(width + 0.02, body * 0.32, length * 0.78, 0, floor + body * 0.72, -length * 0.06, GLASS),
        box(width * 0.9, body * 0.36, 0.04, 0, floor + body * 0.7, length / 2 + 0.01, GLASS),
        box(width, 0.12, length * 0.98, 0, floor + 0.06, 0, TRIM),
        ...lights(width, length, floor + body * 0.3, 0.32),
        ...wheels(width, wheel, [length * 0.34, -length * 0.34]),
      ];
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
      return [
        // Cab at the front with its windscreen, the painted box behind, a dark chassis under both.
        box(width, cab, cabLength, 0, floor + cab / 2, length / 2 - cabLength / 2, PAINT),
        box(width * 0.9, cab * 0.36, 0.04, 0, windowY, length / 2 + 0.01, GLASS),
        box(width + 0.02, cab * 0.3, cabLength * 0.4, 0, windowY, length / 2 - cabLength * 0.3, GLASS),
        box(width, cargo, cargoLength, 0, floor + 0.1 + cargo / 2, -length / 2 + cargoLength / 2, PAINT),
        box(width * 0.8, 0.3, length * 0.96, 0, floor - 0.1, 0, TRIM),
        ...lights(width, length, floor + 0.35, 0.34),
        ...wheels(width, wheel, [length / 2 - 1.4, -length / 2 + 2.2, -length / 2 + 1.1]),
      ];
    }
    case 'bus': {
      const wheel = 0.48;
      const floor = 0.4;
      const body = height - floor;
      return [
        box(width, body, length, 0, floor + body / 2, 0, PAINT),
        box(width + 0.02, body * 0.36, length * 0.84, 0, floor + body * 0.66, -length * 0.03, GLASS),
        box(width * 0.92, body * 0.5, 0.04, 0, floor + body * 0.6, length / 2 + 0.01, GLASS),
        box(width + 0.03, 0.14, length, 0, floor + 0.07, 0, TRIM),
        ...lights(width, length, floor + 0.35, 0.4),
        ...wheels(width, wheel, [length / 2 - 2.4, -length / 2 + 2.8]),
      ];
    }
  }
}

/** A box `w` wide, `h` tall and `d` long centred at (x, y, z), in one colour. */
function box(w: number, h: number, d: number, x: number, y: number, z: number, color: number): BufferGeometry {
  return colored(new BoxGeometry(w, h, d).translate(x, y, z), color);
}

/** Headlights at the front, tail lights at the back, `y` above the ground. */
function lights(width: number, length: number, y: number, size: number): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const x = side * (width / 2 - size * 0.8);
    parts.push(
      box(size, size * 0.45, 0.06, x, y, length / 2 + 0.02, HEADLIGHT),
      box(size * 0.8, size * 0.45, 0.06, x, y, -length / 2 - 0.02, TAIL_LIGHT),
    );
  }
  return parts;
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
