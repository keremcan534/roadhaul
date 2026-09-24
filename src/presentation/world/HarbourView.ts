import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Quaternion,
  Shape,
  Vector3,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { shorelineXAt, type BoatKind } from '../../data/definitions/MapDefinition';
import {
  CRANE_HALF_BASE_METERS,
  CRANE_HALF_GAUGE_METERS,
  type Boat,
  type Crane,
  type Sea,
} from '../../domain/world/DrivingWorld';
import { LampGlows } from '../vehicles/LampGlows';
import { concreteImage } from '../textures/proceduralImages';
import { toTexture } from '../textures/toTexture';
import { flatGroundLight, type PrelitMaterials } from './lighting';

/** The quay's slabs: one texture tile covers this many meters; a layer over the beach, under the roads. */
const QUAY_TILE_METERS = 14;
const QUAY_Y = 0.02;
/** Along the water's edge: a concrete kerb, bollards every so often, and a yellow line a step back. */
const KERB_WIDTH = 0.5;
const KERB_HEIGHT = 0.45;
const BOLLARD_SPACING_METERS = 12;
const SAFETY_LINE_BACK_METERS = 2;
/** The cranes' jib: from the machinery house, this long, raised this far (radians). */
const JIB_LENGTH = 22;
const JIB_RISE = 0.28;
const JIB_PIVOT = new Vector3(0, 14, 2);
const CRANE_YELLOW = 0xe0a91b;
const CRANE_WHITE = 0xdcded9;
const DARK = 0x2c3035;
const COUNTERWEIGHT = 0x5c6166;
const GLASS = 0x3b5263;
const CONCRETE = 0x9d9b95;
const SAFETY_YELLOW = 0xf2c230;
/** Lamps at night: masthead lights on the boats, a red light on each jib's tip. */
const MAST_LIGHT = 0xfff4dc;
const WARNING_LIGHT = 0xff3322;
const GLOW_SIZE_METERS = 3;
/** How the boats rock at their moorings: rise and fall (meters), roll and pitch (radians), per kind. */
const BOAT_MOTION: Readonly<Record<BoatKind, { readonly heave: number; readonly roll: number; readonly pitch: number }>> = {
  coaster: { heave: 0.08, roll: 0.012, pitch: 0.004 },
  tug: { heave: 0.12, roll: 0.03, pitch: 0.01 },
  fishing: { heave: 0.16, roll: 0.05, pitch: 0.015 },
};

export interface HarbourViewOptions {
  /** Texture anisotropy for the quay (renderer capability). */
  readonly anisotropy?: number;
  /** Where the pre-lit quay registers, to follow the weather's light. */
  readonly prelit?: PrelitMaterials;
  /** false leaves out the lamps' glow at night (weaker devices). */
  readonly lampGlows?: boolean;
}

/**
 * The harbour (DrivingWorld.sea): the quays, paved in concrete slabs, with a
 * kerb, bollards and a yellow line along the water; portal cranes on them,
 * their jibs out over the water; and the boats moored off them, rocking
 * gently. Original designs: a small cargo ship with containers on its
 * hatches, a harbour tug and fishing boats. At night the boats' masthead
 * lights and the cranes' warning lights glow. The quays cost one draw call,
 * their kerbs and bollards one, the cranes one, each boat one, and the
 * glows one at night. update() runs every frame and allocates nothing.
 */
export class HarbourView {
  private readonly root = new Group();
  private readonly resources: { dispose(): void }[] = [];
  private readonly boats: { readonly mesh: Mesh; readonly boat: Boat; readonly phase: number }[] = [];
  private readonly glows: LampGlows | null;
  private time = 0;

  constructor(
    private readonly scene: Scene,
    sea: Sea,
    options: HarbourViewOptions = {},
  ) {
    this.root.name = 'harbour';
    if (sea.quays.length > 0) {
      this.root.add(this.createQuays(sea, options), this.createKerbs(sea));
    }
    if (sea.cranes.length > 0) {
      this.root.add(this.createCranes(sea.cranes));
    }
    const material = this.track(new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    const shapes = new Map<BoatKind, BufferGeometry>();
    sea.boats.forEach((boat, index) => {
      let geometry = shapes.get(boat.kind);
      if (geometry === undefined) {
        geometry = this.track(boatGeometry(boat.kind));
        shapes.set(boat.kind, geometry);
      }
      const mesh = new Mesh(geometry, material);
      mesh.name = `boat-${boat.kind}`;
      mesh.rotation.order = 'YXZ';
      mesh.position.set(boat.x, 0, boat.z);
      mesh.rotation.y = boat.heading;
      this.boats.push({ mesh, boat, phase: index * 1.7 });
      this.root.add(mesh);
    });
    const lights = lampsOf(sea);
    if (options.lampGlows !== false && lights.length > 0) {
      this.glows = new LampGlows(lights.length, GLOW_SIZE_METERS);
      lights.forEach(({ at, color }, index) => {
        this.glows!.setPosition(index, at.x, at.y, at.z);
        this.glows!.setColor(index, color);
      });
      this.glows.setCount(lights.length);
      this.root.add(this.glows.points);
    } else {
      this.glows = null;
    }
    scene.add(this.root);
  }

  /** Rocks the boats at their moorings `deltaSeconds` on. Allocation-free. */
  update(deltaSeconds: number): void {
    this.time = (this.time + deltaSeconds) % 3600;
    for (let i = 0; i < this.boats.length; i++) {
      const { mesh, boat, phase } = this.boats[i]!;
      const motion = BOAT_MOTION[boat.kind];
      const t = this.time + phase;
      mesh.position.y = Math.sin(t * 0.9) * motion.heave;
      mesh.rotation.z = Math.sin(t * 0.7 + 0.5) * motion.roll;
      mesh.rotation.x = Math.sin(t * 0.55 + 1.3) * motion.pitch;
    }
  }

  /** How brightly the lamps shine, 0..1 (the weather's): their glow at night. */
  setLamps(level: number): void {
    this.glows?.setLevel(level);
  }

  dispose(): void {
    this.scene.remove(this.root);
    this.glows?.dispose();
    for (const resource of this.resources) {
      resource.dispose();
    }
  }

  /** Each quay's slabs, from the water's edge back, pre-lit like the depot yards. */
  private createQuays(sea: Sea, options: HarbourViewOptions): Mesh {
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (const quay of sea.quays) {
      const zs = alongQuay(sea, quay.fromZ, quay.toZ);
      const start = positions.length / 3;
      for (const z of zs) {
        const x = shorelineXAt(sea.shoreline, z);
        for (const across of [0, quay.widthMeters]) {
          positions.push(x + across, QUAY_Y, z);
          uvs.push((x + across) / QUAY_TILE_METERS, z / QUAY_TILE_METERS);
        }
      }
      for (let i = 0; i < zs.length - 1; i++) {
        const a = start + i * 2;
        // a: the water's edge, a + 1 inland; the next pair lies south. Wound to face up.
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geometry = this.track(new BufferGeometry());
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    geometry.setIndex(indices);
    const slabs = this.track(toTexture(concreteImage(), { repeat: true, anisotropy: options.anisotropy ?? 1 }));
    const material = this.track(
      new MeshBasicMaterial({
        map: slabs,
        color: flatGroundLight(),
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -2,
      }),
    );
    options.prelit?.add(material);
    const quays = new Mesh(geometry, material);
    quays.name = 'quays';
    return quays;
  }

  /** The kerb along each quay's edge, its bollards and the yellow line, in one mesh. */
  private createKerbs(sea: Sea): Mesh {
    const parts: BufferGeometry[] = [];
    for (const quay of sea.quays) {
      const zs = alongQuay(sea, quay.fromZ, quay.toZ);
      for (let i = 0; i < zs.length - 1; i++) {
        const fromX = shorelineXAt(sea.shoreline, zs[i]!);
        const toX = shorelineXAt(sea.shoreline, zs[i + 1]!);
        parts.push(
          strut([fromX + KERB_WIDTH / 2, KERB_HEIGHT / 2, zs[i]!], [toX + KERB_WIDTH / 2, KERB_HEIGHT / 2, zs[i + 1]!], KERB_WIDTH, KERB_HEIGHT, CONCRETE),
          strut(
            [fromX + SAFETY_LINE_BACK_METERS, QUAY_Y + 0.01, zs[i]!],
            [toX + SAFETY_LINE_BACK_METERS, QUAY_Y + 0.01, zs[i + 1]!],
            0.25,
            0.02,
            SAFETY_YELLOW,
          ),
        );
      }
      for (let z = quay.fromZ + BOLLARD_SPACING_METERS / 2; z < quay.toZ; z += BOLLARD_SPACING_METERS) {
        const x = shorelineXAt(sea.shoreline, z) + KERB_WIDTH + 0.45;
        parts.push(
          colored(new CylinderGeometry(0.2, 0.24, 0.7, 8).translate(x, 0.35, z), DARK),
          colored(new CylinderGeometry(0.3, 0.3, 0.08, 8).translate(x, 0.72, z), DARK),
        );
      }
    }
    const kerbs = new Mesh(this.merged(parts), this.track(new MeshLambertMaterial({ vertexColors: true })));
    kerbs.name = 'quay-kerbs';
    return kerbs;
  }

  /** Every crane, merged: a portal on four legs, a machinery house, a mast and a raised jib out over the water. */
  private createCranes(cranes: readonly Crane[]): Mesh {
    const parts: BufferGeometry[] = [];
    for (const crane of cranes) {
      for (const part of craneParts()) {
        parts.push(part.rotateY(crane.heading).translate(crane.x, 0, crane.z));
      }
    }
    const mesh = new Mesh(this.merged(parts), this.track(new MeshLambertMaterial({ vertexColors: true, flatShading: true })));
    mesh.name = 'cranes';
    return mesh;
  }

  private merged(parts: BufferGeometry[]): BufferGeometry {
    const geometry = this.track(mergeGeometries(parts));
    for (const part of parts) {
      part.dispose();
    }
    return geometry;
  }

  private track<T extends { dispose(): void }>(resource: T): T {
    this.resources.push(resource);
    return resource;
  }
}

/** Where to cut a quay along its length: its ends and the shoreline's points between them. */
function alongQuay(sea: Sea, fromZ: number, toZ: number): number[] {
  return [fromZ, ...sea.shoreline.map(([, z]) => z).filter((z) => z > fromZ && z < toZ), toZ];
}

/** Where the harbour's lamps are at night, and their colours. */
function lampsOf(sea: Sea): { at: Vector3; color: number }[] {
  const lamps: { at: Vector3; color: number }[] = [];
  const place = (x: number, z: number, heading: number, local: Vector3, color: number): void => {
    lamps.push({ at: local.clone().applyAxisAngle(UP, heading).add(new Vector3(x, 0, z)), color });
  };
  for (const crane of sea.cranes) {
    place(crane.x, crane.z, crane.heading, jibTip(), WARNING_LIGHT);
  }
  for (const boat of sea.boats) {
    for (const light of BOAT_LIGHTS[boat.kind]) {
      place(boat.x, boat.z, boat.heading, light, MAST_LIGHT);
    }
  }
  return lamps;
}

const UP = new Vector3(0, 1, 0);

/** The jib's tip, in a crane's own frame (its jib reaching toward +Z). */
function jibTip(): Vector3 {
  return new Vector3(0, JIB_PIVOT.y + Math.sin(JIB_RISE) * JIB_LENGTH, JIB_PIVOT.z + Math.cos(JIB_RISE) * JIB_LENGTH);
}

/** A crane in its own frame, its jib toward +Z: the portal's legs stand where DrivingWorld makes them solid. */
function craneParts(): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  const gauge = CRANE_HALF_GAUGE_METERS;
  const base = CRANE_HALF_BASE_METERS;
  const box = (size: readonly [number, number, number], at: readonly [number, number, number], color: number): void => {
    parts.push(colored(new BoxGeometry(...size).translate(...at), color));
  };
  for (const x of [-base, base]) {
    for (const z of [-gauge, gauge]) {
      box([0.7, 10, 0.7], [x, 5, z], CRANE_YELLOW);
    }
    box([0.8, 1, gauge * 2 + 0.7], [x, 10, 0], CRANE_YELLOW);
  }
  for (const z of [-gauge, gauge]) {
    box([base * 2 + 0.8, 1, 0.8], [0, 10, z], CRANE_YELLOW);
  }
  // Machinery house and the driver's cab beside the jib's foot; the counterweight behind.
  box([5.5, 4, 6], [0, 12.5, -0.5], CRANE_WHITE);
  box([1.6, 1.5, 1.6], [1.8, 11.4, 3], GLASS);
  box([3, 2.5, 2], [0, 13, -4.6], COUNTERWEIGHT);
  // The mast, the jib and the stay between their tips; the hook hangs from the jib's tip.
  box([1, 9, 1], [0, 19, -1], CRANE_YELLOW);
  const tip = jibTip();
  parts.push(strut([JIB_PIVOT.x, JIB_PIVOT.y, JIB_PIVOT.z], [tip.x, tip.y, tip.z], 1.1, 1.1, CRANE_YELLOW));
  parts.push(strut([0, 23.5, -1], [tip.x, tip.y + 0.5, tip.z], 0.18, 0.18, DARK));
  parts.push(strut([tip.x, tip.y - 0.5, tip.z], [tip.x, tip.y - 9, tip.z], 0.08, 0.08, DARK));
  box([0.8, 0.9, 0.8], [tip.x, tip.y - 9.4, tip.z], CRANE_YELLOW);
  return parts;
}

/** Masthead lights of each kind of boat, in its own frame (bow toward +Z). */
const BOAT_LIGHTS: Readonly<Record<BoatKind, readonly Vector3[]>> = {
  coaster: [new Vector3(0, 10.6, 26), new Vector3(0, 14.4, -24)],
  tug: [new Vector3(0, 8.4, 1)],
  fishing: [new Vector3(0, 7.2, -1)],
};

/** A boat of `kind` in its own frame: bow toward +Z, the waterline at y 0, the hull going on below it. */
function boatGeometry(kind: BoatKind): BufferGeometry {
  // Not indexed, like the extruded hull, so the parts merge.
  const parts: BufferGeometry[] = [];
  const box = (size: readonly [number, number, number], at: readonly [number, number, number], color: number): void => {
    parts.push(colored(new BoxGeometry(...size).translate(...at).toNonIndexed(), color));
  };
  if (kind === 'coaster') {
    parts.push(hull(64, 11, 7, -3, 2.5, 0x2b4d5e));
    // Hatches, with containers stacked on the middle one.
    for (const z of [-12, 1, 14]) {
      box([8.6, 0.9, 11], [0, 2.95, z], 0x6c7a70);
    }
    const containers = [0xb5452f, 0x2f5f9e, 0xd98a2b, 0x7b8288, 0x3f7f4f, 0xb5452f];
    containers.forEach((color, i) => {
      const x = i % 2 === 0 ? -1.3 : 1.3;
      const y = 3.4 + 1.3 + (i >= 4 ? 2.6 : 0);
      const z = i < 4 ? (i < 2 ? -2.4 : 4.4) : 1;
      box([2.4, 2.55, 6], [x, y, z], color);
    });
    // Accommodation and bridge at the stern, the funnel behind; a mast on the forecastle.
    box([10, 6, 8], [0, 5.5, -26], 0xe9e9e4);
    box([11, 2.2, 4], [0, 9.6, -24], 0xe9e9e4);
    box([9, 0.8, 0.1], [0, 9.8, -21.95], GLASS);
    box([1.8, 3, 2.4], [0, 12.2, -28.5], 0xb8412f);
    box([1.85, 0.5, 2.45], [0, 13.95, -28.5], DARK);
    box([0.35, 4, 0.35], [0, 12.4, -24], DARK);
    box([0.4, 8, 0.4], [0, 6.5, 26], DARK);
  } else if (kind === 'tug') {
    parts.push(hull(24, 8.5, 6, -1.6, 2, 0xa8322a));
    box([8.7, 0.5, 20], [0, 1.4, -1], DARK);
    box([4.2, 2.6, 4.5], [0, 3.3, 1], 0xecece8);
    box([4.25, 0.7, 4.55], [0, 4, 1], GLASS);
    box([3.2, 1.4, 3], [0, 5.3, 1.4], 0xecece8);
    box([1.2, 2, 1.6], [0, 5, -2.6], 0xe0a91b);
    box([1.25, 0.4, 1.65], [0, 6.2, -2.6], DARK);
    box([0.25, 3, 0.25], [0, 7, 1], DARK);
  } else {
    parts.push(hull(15, 5, 4, -1, 1.4, 0x2f5f8f));
    box([5.1, 0.3, 12.6], [0, 1.25, -0.6], 0xeef0ee);
    box([2.6, 2, 3], [0, 2.4, 3], 0xeef0ee);
    box([2.65, 0.6, 3.05], [0, 2.9, 3], GLASS);
    box([0.22, 5.6, 0.22], [0, 4.3, -1], DARK);
    parts.push(strut([0, 5.2, -1], [0, 2.2, -6], 0.16, 0.16, DARK).toNonIndexed());
    box([3.6, 0.2, 0.2], [0, 3.6, -6.4], DARK);
    for (const x of [-1.7, 1.7]) {
      box([0.2, 2.4, 0.2], [x, 2.4, -6.4], DARK);
    }
  }
  const geometry = mergeGeometries(parts);
  for (const part of parts) {
    part.dispose();
  }
  return geometry;
}

/**
 * A hull: square at the stern, pointed at the bow (the last `bowLength`
 * meters), from `bottom` to `top` (the deck), `length` long and `beam` wide.
 */
function hull(length: number, beam: number, bowLength: number, bottom: number, top: number, color: number): BufferGeometry {
  const half = beam / 2;
  // The plan, drawn in x and y: extruded upward, y becomes −z, so the bow (at −y) points toward +Z.
  const plan = new Shape();
  plan.moveTo(-half, length / 2);
  plan.lineTo(half, length / 2);
  plan.lineTo(half, -length / 2 + bowLength);
  plan.lineTo(0, -length / 2);
  plan.lineTo(-half, -length / 2 + bowLength);
  plan.closePath();
  const geometry = new ExtrudeGeometry(plan, { depth: top - bottom, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2).translate(0, bottom, 0);
  return colored(geometry, color);
}

/**
 * A straight bar from `from` to `to`, `width` across and `height` high
 * (its cross-section's width lies level), in `color`.
 */
function strut(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  width: number,
  height: number,
  color: number,
): BufferGeometry {
  const start = new Vector3(...from);
  const direction = new Vector3(...to).sub(start);
  const length = direction.length();
  const bar = new BoxGeometry(width, height, length);
  // Level first (turn round +Y), then tilt up or down to the end point.
  const turn = new Quaternion().setFromAxisAngle(UP, Math.atan2(direction.x, direction.z));
  const tilt = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.asin(direction.y / (length || 1)));
  bar.applyQuaternion(turn.multiply(tilt));
  bar.translate(start.x + direction.x / 2, start.y + direction.y / 2, start.z + direction.z / 2);
  return colored(bar, color);
}

/** Paints every vertex of `geometry` in `hex`. Returns it. */
function colored(geometry: BufferGeometry, hex: number): BufferGeometry {
  const color = new Color(hex);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors.set([color.r, color.g, color.b], i * 3);
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}
