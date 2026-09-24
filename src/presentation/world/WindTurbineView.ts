import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { WindTurbine } from '../../domain/world/DrivingWorld';
import { LampGlows } from '../vehicles/LampGlows';

/** The tower: its height and radius at the foot and the top, meters. */
export const TURBINE_HUB_HEIGHT = 64;
const TOWER_FOOT_RADIUS = 2.2;
const TOWER_TOP_RADIUS = 1.2;
/** The rotor turns this far in front of the tower, blades this long. */
const ROTOR_OFFSET = 4.4;
export const TURBINE_BLADE_LENGTH = 27;
/** Every rotor faces the prevailing wind, from the south-south-west (0° faces +Z, 90° faces +X). */
const ROTOR_FACING = (200 * Math.PI) / 180;
/** Rotor speed, radians per second (about 14 turns a minute). */
const ROTOR_SPEED = 1.47;
const TURBINE_COLOR = 0xeef1f4;
/** The red warning light on each nacelle at night: its glow's size, and how often it blinks (seconds per flash). */
const WARNING_LIGHT_COLOR = 0xff3322;
const WARNING_LIGHT_SIZE = 5;
const BLINK_SECONDS = 1.5;

export interface WindTurbineViewOptions {
  /** Whether the warning lights glow at night (off on the low preset). Default: true. */
  readonly lampGlows?: boolean;
}

/**
 * The wind turbines: white towers with a nacelle, and three-bladed rotors
 * that turn (update() every frame). Towers and rotors are instanced: two
 * draw calls for them all. At night a red warning light blinks on each
 * nacelle, one more.
 */
export class WindTurbineView {
  private readonly root = new Group();
  private readonly resources: { dispose(): void }[] = [];
  private readonly rotors: InstancedMesh | null = null;
  private readonly glows: LampGlows | null = null;
  private readonly hubs: readonly { readonly x: number; readonly z: number }[];
  private spin = 0;
  private clock = 0;
  private lamps = 0;
  /** Scratch objects for the per-frame rotor matrices. */
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly facing = new Quaternion();
  private readonly turn = new Quaternion();
  private readonly scale = new Vector3(1, 1, 1);
  private readonly axis = new Vector3(0, 0, 1);

  constructor(
    private readonly scene: Scene,
    turbines: readonly WindTurbine[],
    options: WindTurbineViewOptions = {},
  ) {
    this.root.name = 'wind-turbines';
    this.facing.setFromAxisAngle(new Vector3(0, 1, 0), ROTOR_FACING);
    // The rotor's hub, in front of the tower's top along the way the rotors face.
    this.hubs = turbines.map((turbine) => ({
      x: turbine.x + Math.sin(ROTOR_FACING) * ROTOR_OFFSET,
      z: turbine.z + Math.cos(ROTOR_FACING) * ROTOR_OFFSET,
    }));
    scene.add(this.root);
    if (turbines.length === 0) {
      return;
    }
    const material = this.track(new MeshLambertMaterial({ color: TURBINE_COLOR }));
    const towers = this.track(new InstancedMesh(this.track(towerGeometry()), material, turbines.length));
    turbines.forEach((turbine, index) => {
      towers.setMatrixAt(index, this.matrix.compose(this.position.set(turbine.x, 0, turbine.z), this.facing, this.scale));
    });
    towers.instanceMatrix.needsUpdate = true;
    towers.computeBoundingSphere();
    this.rotors = this.track(new InstancedMesh(this.track(rotorGeometry()), material, turbines.length));
    this.rotors.name = 'turbine-rotors';
    this.placeRotors();
    // The rotors turn in place, about their hubs: these bounds hold at any angle.
    this.rotors.computeBoundingSphere();
    this.root.add(towers, this.rotors);

    if (options.lampGlows !== false) {
      this.glows = new LampGlows(turbines.length, WARNING_LIGHT_SIZE);
      turbines.forEach((turbine, index) => {
        this.glows!.setPosition(index, turbine.x, TURBINE_HUB_HEIGHT + 2.2, turbine.z);
        this.glows!.setColor(index, WARNING_LIGHT_COLOR);
      });
      this.glows.setCount(turbines.length);
      this.root.add(this.glows.points);
    }
  }

  /** How brightly lamps shine, 0..1 (the weather): the warning lights blink at night. */
  setLamps(level: number): void {
    this.lamps = level;
  }

  /** Per frame: turns the rotors and blinks the warning lights. Allocation-free. */
  update(deltaSeconds: number): void {
    if (this.rotors === null) {
      return;
    }
    this.spin = (this.spin + ROTOR_SPEED * deltaSeconds) % (Math.PI * 2);
    this.clock = (this.clock + deltaSeconds) % BLINK_SECONDS;
    this.placeRotors();
    // On for the first third of each blink.
    this.glows?.setLevel(this.clock < BLINK_SECONDS / 3 ? this.lamps : 0);
  }

  dispose(): void {
    this.scene.remove(this.root);
    this.glows?.dispose();
    for (const resource of this.resources) {
      resource.dispose();
    }
  }

  /** Each rotor at its hub, facing the wind, turned by the current spin (each a little ahead of the last). */
  private placeRotors(): void {
    const rotors = this.rotors!;
    for (let i = 0; i < this.hubs.length; i++) {
      const hub = this.hubs[i]!;
      this.turn.setFromAxisAngle(this.axis, this.spin + i * 0.7).premultiply(this.facing);
      rotors.setMatrixAt(i, this.matrix.compose(this.position.set(hub.x, TURBINE_HUB_HEIGHT, hub.z), this.turn, this.scale));
    }
    rotors.instanceMatrix.needsUpdate = true;
  }

  /** Remembers a GPU resource so dispose() can release it. */
  private track<T extends { dispose(): void }>(resource: T): T {
    this.resources.push(resource);
    return resource;
  }
}

/** A tapered tower with the nacelle on top, at the origin, the nacelle's front (where the rotor turns) toward +Z. */
function towerGeometry(): BufferGeometry {
  const parts = [
    new CylinderGeometry(TOWER_TOP_RADIUS, TOWER_FOOT_RADIUS, TURBINE_HUB_HEIGHT, 14).translate(0, TURBINE_HUB_HEIGHT / 2, 0),
    new BoxGeometry(3, 3.2, 9).translate(0, TURBINE_HUB_HEIGHT + 0.4, 0.4),
  ];
  const tower = mergeGeometries(parts);
  for (const part of parts) {
    part.dispose();
  }
  return tower;
}

/** The hub and three blades, turning about +Z, the hub's nose toward +Z. */
function rotorGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [new ConeGeometry(1.3, 2.6, 12).rotateX(Math.PI / 2).translate(0, 0, 1.3)];
  for (let blade = 0; blade < 3; blade++) {
    // A blade tapers from its root at the hub to its tip, flat to the wind.
    const geometry = new CylinderGeometry(0.28, 0.9, TURBINE_BLADE_LENGTH, 4, 1)
      .scale(1, 1, 0.3)
      .translate(0, TURBINE_BLADE_LENGTH / 2 + 0.8, 0)
      .rotateZ((blade * Math.PI * 2) / 3);
    parts.push(geometry);
  }
  const rotor = mergeGeometries(parts);
  for (const part of parts) {
    part.dispose();
  }
  return rotor;
}
