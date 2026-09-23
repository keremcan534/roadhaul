import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Material,
  type Scene,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, dampFactor } from '../../core/math/scalar';
import type { VehicleClass, VehicleDefinition } from '../../data/definitions/VehicleDefinition';
import type { VehicleRuntimeState } from '../../domain/vehicles/VehicleRuntimeState';
import type { VehiclePose } from '../../systems/driving/DrivingService';
import type { Rgb } from '../textures/pixelImage';
import { grilleImage, liveryImage, rearDoorsImage, rimImage, softBoxShadowImage } from '../textures/proceduralImages';
import { toTexture } from '../textures/toTexture';

/** Cab paint and livery accent per truck class: original colours, no real-world liveries. */
const CLASS_PAINT: Readonly<Record<VehicleClass, number>> = {
  light: 0xe0622a,
  medium: 0x2f6fb5,
  heavy: 0xb3262e,
};
const DASHBOARD_COLOR = 0x3a4047;
const TIRE_WIDTH = 0.36;
/** A heavy truck's two rear axles stand this far either side of the rear axle the physics uses. */
const TANDEM_HALF_SPACING = 0.68;
/** Colours of the flatbed's load: pallets, bricks and ratchet straps. */
const PALLET_COLOR = 0x9c7a4f;
const BRICK_COLOR = 0xa94f35;
const STRAP_COLOR = 0xffa21c;

/** Body lean per m/s² of acceleration (radians), capped, and how fast the lean follows. */
const PITCH_PER_ACCELERATION = 0.008;
const ROLL_PER_ACCELERATION = 0.012;
const MAX_LEAN = 0.07;
const LEAN_RESPONSE_RATE = 5;

type PartMaterial =
  | 'paint'
  | 'dark'
  | 'metal'
  | 'glass'
  | 'lamps'
  | 'grille'
  | 'panels'
  | 'livery'
  | 'doors'
  | 'deck';

/**
 * A cab-over truck built from a VehicleDefinition's body dimensions and body
 * type: original designs, no real-world models. The cab has windows, grille,
 * headlights and mirrors. A box body carries the RoadHaul livery on its sides
 * and doors; a refrigerated one adds a cooling unit over the cab; a flatbed
 * has a deck, headboard and stakes, and shows its load of bricks while loaded.
 * Heavy trucks stand on two rear axles. Parts that share a material are
 * merged, so a truck costs about 15 draw calls. Its origin is the rear axle,
 * like VehicleRuntimeState. Front wheels steer, all wheels roll, and the body
 * pitches and rolls with acceleration.
 *
 * update() runs every frame and allocates nothing.
 */
export class TruckView {
  private readonly root = new Group();
  private readonly body = new Group();
  private readonly windshield: Mesh;
  /** Only shown from the driver's seat. */
  private readonly dashboard: Mesh;
  /** The flatbed's visible load; null for closed bodies, whose load is out of sight. */
  private readonly load: Mesh | null = null;
  private readonly wheels: InstancedMesh;
  private readonly resources: { dispose(): void }[] = [];
  private readonly wheelPositions: readonly (readonly [number, number, number])[];
  private wheelSpin = 0;
  private pitch = 0;
  private roll = 0;
  // Scratch objects reused every frame.
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly euler = new Euler(0, 0, 0, 'YXZ');
  private readonly unitScale = new Vector3(1, 1, 1);

  constructor(
    private readonly scene: Scene,
    readonly definition: VehicleDefinition,
  ) {
    const { lengthMeters: L, widthMeters: W, heightMeters: H, wheelbaseMeters: B, wheelRadiusMeters: R } = definition.body;
    const paint = CLASS_PAINT[definition.vehicleClass];
    const centreZ = B / 2;
    const frontZ = centreZ + L / 2;
    const rearZ = centreZ - L / 2;
    // Heights: the box floor clears the wheels; the cab sits on top of the front axle (cab-over).
    const deckY = 2 * R + 0.1;
    const frameY = 2 * R - 0.12;
    const cabBottom = 2 * R + 0.04;
    const bumperTop = R + 0.16;
    const cabTop = deckY + (H - deckY) * 0.78;
    const beltY = deckY + (cabTop - deckY) * 0.42;
    const cabLength = Math.min(2.4, Math.max(1.8, L * 0.28));
    const cabRear = frontZ - cabLength;
    const boxFront = cabRear - 0.12;
    const halfW = W / 2;
    const { bodyType } = definition;
    const tandem = definition.vehicleClass === 'heavy';

    const parts = new Map<PartMaterial, BufferGeometry[]>();
    const add = (material: PartMaterial, geometry: BufferGeometry): void => {
      const list = parts.get(material) ?? [];
      list.push(geometry);
      parts.set(material, list);
    };
    const box = (material: PartMaterial, size: readonly [number, number, number], at: readonly [number, number, number]): void =>
      add(material, new BoxGeometry(...size).translate(...at));
    const lamp = (color: number, size: readonly [number, number, number], at: readonly [number, number, number]): void =>
      add('lamps', colored(new BoxGeometry(...size).translate(...at), color));

    // Cab: lower body, the apron in front of the front wheels and the glasshouse. On the roof, a
    // deflector in front of the box, the cooling unit of a refrigerated body, or a flatbed's beacons.
    box('paint', [W, beltY - cabBottom, cabLength], [0, (cabBottom + beltY) / 2, frontZ - cabLength / 2]);
    box('paint', [W, cabBottom - bumperTop + 0.02, 0.36], [0, (bumperTop + cabBottom) / 2, frontZ - 0.18]);
    box('paint', [W - 0.06, cabTop - beltY, cabLength - 0.1], [0, (beltY + cabTop) / 2, frontZ - 0.05 - (cabLength - 0.1) / 2]);
    if (bodyType === 'box') {
      add('paint', wedge(W - 0.12, H - 0.06 - cabTop, cabLength * 0.72).translate(0, (cabTop + H - 0.06) / 2, cabRear + (cabLength * 0.72) / 2));
    } else if (bodyType === 'refrigerated') {
      const unitHeight = H - 0.04 - (cabTop + 0.04);
      const unitDepth = 0.62;
      box('panels', [W * 0.72, unitHeight, unitDepth], [0, cabTop + 0.04 + unitHeight / 2, boxFront + unitDepth / 2]);
      add('grille', frontQuad(W * 0.6, unitHeight * 0.7, boxFront + unitDepth + 0.005, cabTop + 0.04 + unitHeight * 0.15));
    } else {
      for (const side of [1, -1] as const) {
        lamp(0xffa21c, [0.26, 0.14, 0.22], [side * 0.45, cabTop + 0.07, frontZ - 0.45]);
      }
      box('dark', [W * 0.7, 0.06, 0.3], [0, cabTop + 0.03, frontZ - 0.45]);
    }
    // Side windows face outward only, so they do not block the view from the driver's seat.
    const windowHeight = (cabTop - beltY) * 0.7;
    const windowLength = cabLength * 0.5;
    for (const side of [1, -1] as const) {
      add(
        'glass',
        sideQuad(side, side * (halfW - 0.02), beltY + (cabTop - beltY) * 0.18, windowHeight, frontZ - 0.25 - windowLength, windowLength),
      );
    }
    // Front: grille, bumper, headlights and indicators, and the mirrors.
    add('grille', frontQuad(W * 0.6, beltY - 0.2 - (bumperTop + 0.2), frontZ + 0.012, bumperTop + 0.2));
    box('dark', [W + 0.06, 0.32, 0.24], [0, bumperTop - 0.16, frontZ + 0.02]);
    for (const side of [1, -1] as const) {
      lamp(0xfff4d6, [0.42, 0.18, 0.05], [side * (halfW - 0.32), bumperTop + 0.2, frontZ + 0.015]);
      lamp(0xffa21c, [0.14, 0.12, 0.05], [side * (halfW - 0.06), bumperTop + 0.2, frontZ + 0.015]);
      // Mirror on an arm near the front pillar.
      const mirrorY = beltY + (cabTop - beltY) * 0.3;
      box('dark', [0.36, 0.04, 0.04], [side * (halfW + 0.16), mirrorY + 0.2, frontZ - 0.32]);
      box('dark', [0.07, 0.36, 0.2], [side * (halfW + 0.36), mirrorY, frontZ - 0.32]);
    }

    // Chassis, fuel tank, battery box, rear mudguards, underrun bar and light bar.
    box('dark', [W * 0.7, 0.24, L * 0.9], [0, frameY, centreZ]);
    add('metal', new CylinderGeometry(0.28, 0.28, 1.1, 16).rotateX(Math.PI / 2).translate(halfW - 0.32, frameY - 0.05, B * 0.45));
    box('dark', [0.5, 0.45, 0.7], [-(halfW - 0.3), frameY - 0.08, B * 0.45]);
    const guardLength = 2 * R + 0.3 + (tandem ? 2 * TANDEM_HALF_SPACING : 0);
    for (const side of [1, -1] as const) {
      box('dark', [TIRE_WIDTH + 0.08, 0.05, guardLength], [side * (halfW - 0.2), 2 * R + 0.05, 0]);
    }
    box('dark', [W - 0.3, 0.12, 0.1], [0, R + 0.02, rearZ + 0.08]);
    box('dark', [W, 0.2, 0.08], [0, R + 0.26, rearZ + 0.02]);
    for (const side of [1, -1] as const) {
      lamp(0xd4261c, [0.34, 0.14, 0.05], [side * (halfW - 0.3), R + 0.26, rearZ - 0.03]);
      lamp(0xf2f2f2, [0.12, 0.1, 0.05], [side * (halfW - 0.56), R + 0.26, rearZ - 0.03]);
      lamp(0xffa21c, [0.12, 0.1, 0.05], [side * (halfW - 0.08), R + 0.26, rearZ - 0.03]);
    }

    const bodyLength = boxFront - rearZ;
    const loadParts: BufferGeometry[] = [];
    if (bodyType === 'flatbed') {
      // Deck with side rails, a headboard behind the cab and stakes along both sides.
      box('deck', [W, 0.16, bodyLength], [0, deckY - 0.08, rearZ + bodyLength / 2]);
      for (const side of [1, -1] as const) {
        box('dark', [0.06, 0.2, bodyLength], [side * (halfW - 0.03), deckY - 0.1, rearZ + bodyLength / 2]);
        for (let z = rearZ + 0.2; z < boxFront - 0.5; z += 1.6) {
          box('dark', [0.07, 0.45, 0.07], [side * (halfW - 0.035), deckY + 0.22, z]);
        }
      }
      box('metal', [W, 1.35, 0.08], [0, deckY + 0.675, boxFront - 0.04]);
      box('dark', [W, 0.08, 0.1], [0, deckY + 1.35, boxFront - 0.04]);
      // The load: pallets of bricks under ratchet straps, shown while loaded (setLoaded).
      const palletLength = Math.min(2.2, (bodyLength - 0.9) / 3);
      for (let i = 0; i < 3; i++) {
        const z = boxFront - 0.35 - (palletLength + 0.1) * (i + 0.5);
        loadParts.push(colored(new BoxGeometry(W * 0.86, 0.14, palletLength).translate(0, deckY + 0.07, z), PALLET_COLOR));
        loadParts.push(
          colored(new BoxGeometry(W * 0.8, 0.85, palletLength - 0.12).translate(0, deckY + 0.565, z), BRICK_COLOR),
        );
        for (const dz of [-palletLength * 0.25, palletLength * 0.25]) {
          loadParts.push(colored(new BoxGeometry(W * 0.82, 0.03, 0.06).translate(0, deckY + 1.005, z + dz), STRAP_COLOR));
          for (const side of [1, -1] as const) {
            loadParts.push(
              colored(new BoxGeometry(0.03, 0.85, 0.06).translate(side * W * 0.41, deckY + 0.565, z + dz), STRAP_COLOR),
            );
          }
        }
      }
    } else {
      // Cargo box: livery on both sides, doors at the back, plain white roof and front, metal corner posts.
      const boxHeight = H - deckY;
      for (const side of [1, -1] as const) {
        add('livery', sideQuad(side, side * (halfW + 0.02), deckY, boxHeight, rearZ, bodyLength));
      }
      add('doors', rearQuad(W + 0.04, boxHeight, rearZ, deckY));
      box('panels', [W + 0.04, 0.02, bodyLength], [0, H - 0.01, rearZ + bodyLength / 2]);
      box('panels', [W + 0.04, boxHeight, 0.02], [0, deckY + boxHeight / 2, boxFront - 0.01]);
      for (const x of [halfW + 0.02, -(halfW + 0.02)]) {
        for (const z of [rearZ, boxFront]) {
          box('metal', [0.07, boxHeight, 0.07], [x, deckY + boxHeight / 2, z]);
        }
      }
    }

    const accentRgb: Rgb = [(paint >> 16) & 255, (paint >> 8) & 255, paint & 255];
    const materials: Readonly<Record<PartMaterial, Material>> = {
      paint: this.track(new MeshPhongMaterial({ color: paint, shininess: 80, specular: 0x404040 })),
      dark: this.track(new MeshLambertMaterial({ color: 0x2b2e33 })),
      metal: this.track(new MeshPhongMaterial({ color: 0xa9b0b8, shininess: 100, specular: 0xdddddd })),
      glass: this.track(new MeshPhongMaterial({ color: 0x1b2733, shininess: 140, specular: 0x9aa7b3 })),
      lamps: this.track(new MeshBasicMaterial({ vertexColors: true })),
      grille: this.track(new MeshLambertMaterial({ map: this.texture(toTexture(grilleImage())) })),
      panels: this.track(new MeshPhongMaterial({ color: 0xf2f2ee, shininess: 25, specular: 0x222222 })),
      livery: this.track(
        new MeshPhongMaterial({ map: this.texture(toTexture(liveryImage(accentRgb))), shininess: 25, specular: 0x222222 }),
      ),
      doors: this.track(
        new MeshPhongMaterial({ map: this.texture(toTexture(rearDoorsImage(accentRgb))), shininess: 25, specular: 0x222222 }),
      ),
      deck: this.track(new MeshLambertMaterial({ color: 0x6e5238 })),
    };
    for (const [material, geometries] of parts) {
      this.body.add(new Mesh(this.track(mergeGeometries(geometries)), materials[material]));
      for (const geometry of geometries) {
        geometry.dispose();
      }
    }

    // The windshield is its own mesh: the cabin camera hides it.
    this.windshield = new Mesh(
      this.track(frontQuad(W - 0.2, (cabTop - beltY) * 0.8, frontZ - 0.05 + 0.012, beltY + (cabTop - beltY) * 0.1)),
      materials.glass,
    );
    this.body.add(this.windshield);

    // The cab interior, seen only in cabin view (see CameraRig's eye position): a low dashboard along the
    // windscreen. It does not lean with the body: neither does the driver's eye, and it would bob up and
    // down the screen.
    const eyeY = H * 0.72;
    const interior = [
      new BoxGeometry(W * 0.9, 0.22, 0.6).translate(0, eyeY - 0.6, frontZ - 0.42),
      new BoxGeometry(W * 0.9, 0.04, 0.12).translate(0, eyeY - 0.48, frontZ - 0.16),
    ];
    this.dashboard = new Mesh(
      this.track(mergeGeometries(interior)),
      this.track(new MeshLambertMaterial({ color: DASHBOARD_COLOR })),
    );
    for (const part of interior) {
      part.dispose();
    }
    this.dashboard.visible = false;

    if (loadParts.length > 0) {
      this.load = new Mesh(this.track(mergeGeometries(loadParts)), this.track(new MeshLambertMaterial({ vertexColors: true })));
      for (const part of loadParts) {
        part.dispose();
      }
      this.load.visible = false;
      this.body.add(this.load);
    }

    // Front wheels first: they steer.
    const trackHalf = halfW - 0.2;
    const rearAxles = tandem ? [TANDEM_HALF_SPACING, -TANDEM_HALF_SPACING] : [0];
    this.wheelPositions = [
      [trackHalf, R, B],
      [-trackHalf, R, B],
      ...rearAxles.flatMap((z) => [
        [trackHalf, R, z] as const,
        [-trackHalf, R, z] as const,
      ]),
    ];
    this.wheels = this.createWheels(R, this.wheelPositions.length);
    this.updateWheels(0);

    // A soft shadow under the truck; it stays flat on the road while the body leans.
    const shadow = new Mesh(
      this.track(new PlaneGeometry(W + 1.6, L + 2).rotateX(-Math.PI / 2).translate(0, 0.075, centreZ)),
      this.track(
        new MeshBasicMaterial({
          map: this.texture(toTexture(softBoxShadowImage(), { srgb: false })),
          color: 0x000000,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
        }),
      ),
    );

    this.root.add(shadow, this.body, this.dashboard, this.wheels);
    scene.add(this.root);
  }

  /** Places the truck at `pose` (interpolated between fixed steps) and animates wheels and body lean. */
  update(pose: Readonly<VehiclePose>, state: Readonly<VehicleRuntimeState>, deltaSeconds: number): void {
    this.root.position.set(pose.x, 0, pose.z);
    this.root.rotation.y = pose.heading;

    this.wheelSpin += (state.speed * deltaSeconds) / this.definition.body.wheelRadiusMeters;
    this.updateWheels(state.steerAngle);

    // Nose dips when braking and lifts when accelerating; the body leans out of turns.
    const response = dampFactor(LEAN_RESPONSE_RATE, deltaSeconds);
    const targetPitch = clamp(-state.longitudinalAcceleration * PITCH_PER_ACCELERATION, -MAX_LEAN, MAX_LEAN);
    const targetRoll = clamp(state.lateralAcceleration * ROLL_PER_ACCELERATION, -MAX_LEAN, MAX_LEAN);
    this.pitch += (targetPitch - this.pitch) * response;
    this.roll += (targetRoll - this.roll) * response;
    this.body.rotation.set(this.pitch, 0, this.roll);
  }

  /** Shows or hides a flatbed's load. Closed bodies keep their load out of sight. */
  setLoaded(loaded: boolean): void {
    if (this.load !== null) {
      this.load.visible = loaded;
    }
  }

  /** From the driver's seat the windshield would block the view: swap it for the dashboard. */
  setCabinView(enabled: boolean): void {
    this.windshield.visible = !enabled;
    this.dashboard.visible = enabled;
  }

  dispose(): void {
    this.scene.remove(this.root);
    for (const resource of this.resources) {
      resource.dispose();
    }
  }

  /** Tyres with a rim on each face: two draw calls for all the wheels. */
  private createWheels(radius: number, count: number): InstancedMesh {
    const tire = new CylinderGeometry(radius, radius, TIRE_WIDTH, 22).rotateZ(Math.PI / 2);
    const outer = new CircleGeometry(radius * 0.72, 22).rotateY(Math.PI / 2).translate(TIRE_WIDTH / 2 + 0.002, 0, 0);
    const inner = new CircleGeometry(radius * 0.72, 22).rotateY(-Math.PI / 2).translate(-TIRE_WIDTH / 2 - 0.002, 0, 0);
    const wheel = mergeGeometries([tire, outer, inner], true);
    for (const part of [tire, outer, inner]) {
      part.dispose();
    }
    const rim = this.track(new MeshPhongMaterial({ map: this.texture(toTexture(rimImage())), shininess: 90 }));
    return this.track(
      new InstancedMesh(this.track(wheel), [this.track(new MeshLambertMaterial({ color: 0x1d1d1f })), rim, rim], count),
    );
  }

  private updateWheels(steerAngle: number): void {
    for (let i = 0; i < this.wheelPositions.length; i++) {
      const [x, y, z] = this.wheelPositions[i]!;
      // Positive steering turns right, which is a negative rotation about Y.
      const steer = i < 2 ? -steerAngle : 0;
      this.rotation.setFromEuler(this.euler.set(this.wheelSpin, steer, 0));
      this.position.set(x, y, z);
      this.wheels.setMatrixAt(i, this.matrix.compose(this.position, this.rotation, this.unitScale));
    }
    this.wheels.instanceMatrix.needsUpdate = true;
  }

  private texture<T extends Texture>(texture: T): T {
    return this.track(texture);
  }

  private track<T extends { dispose(): void }>(resource: T): T {
    this.resources.push(resource);
    return resource;
  }
}

/** Gives every vertex of `geometry` one colour (for the merged, self-lit lamps). */
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

/** A box whose top slopes down to the front: a roof deflector. */
function wedge(width: number, height: number, depth: number): BufferGeometry {
  const geometry = new BoxGeometry(width, height, depth);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    if (position.getY(i) > 0 && position.getZ(i) > 0) {
      position.setY(i, -height / 2 + 0.02);
    }
  }
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A rectangle on the side of the truck facing outward (`side` 1 = left, +X;
 * -1 = right), from `z0` to `z0 + length` and `y0` to `y0 + height`. Texture
 * u runs so text reads left to right from outside on both sides.
 */
function sideQuad(side: 1 | -1, x: number, y0: number, height: number, z0: number, length: number): BufferGeometry {
  const zStart = side === 1 ? z0 + length : z0;
  const zEnd = side === 1 ? z0 : z0 + length;
  return quad(
    [
      [x, y0, zStart],
      [x, y0, zEnd],
      [x, y0 + height, zEnd],
      [x, y0 + height, zStart],
    ],
    [side, 0, 0],
  );
}

/** A rectangle facing forward (+Z), centred on x = 0, bottom edge at `y0`. */
function frontQuad(width: number, height: number, z: number, y0: number): BufferGeometry {
  return quad(
    [
      [-width / 2, y0, z],
      [width / 2, y0, z],
      [width / 2, y0 + height, z],
      [-width / 2, y0 + height, z],
    ],
    [0, 0, 1],
  );
}

/** A rectangle facing backward (-Z), centred on x = 0, bottom edge at `y0`; u runs left to right seen from behind. */
function rearQuad(width: number, height: number, z: number, y0: number): BufferGeometry {
  return quad(
    [
      [width / 2, y0, z - 0.01],
      [-width / 2, y0, z - 0.01],
      [-width / 2, y0 + height, z - 0.01],
      [width / 2, y0 + height, z - 0.01],
    ],
    [0, 0, -1],
  );
}

/** Two triangles through four corners (counter-clockwise seen from the front), uv 0..1. */
function quad(corners: readonly (readonly [number, number, number])[], normal: readonly [number, number, number]): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(corners.flat()), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array([...normal, ...normal, ...normal, ...normal]), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}
