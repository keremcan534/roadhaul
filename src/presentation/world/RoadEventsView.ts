import {
  BoxGeometry,
  BufferAttribute,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type BufferGeometry,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { TrafficVehicleDefinition } from '../../data/definitions/TrafficVehicleDefinition';
import type { DrivingWorld } from '../../domain/world/DrivingWorld';
import type { WorkZone, ZonePiece } from '../../domain/world/workZones';
import type { StrandedDriver } from '../../systems/world/RoadEventService';
import { vehicleGeometry } from '../traffic/TrafficView';
import { LampGlows } from '../vehicles/LampGlows';

/** What the road's events are, as RoadEventService has them. */
export interface RoadEventsSource {
  readonly workZones: readonly WorkZone[];
  readonly stranded: Readonly<StrandedDriver> | null;
}

/** The convoy, as ConvoyService has it: its trucks, the lead first. */
export interface ConvoySource {
  readonly active: boolean;
  readonly vehicleX: Float64Array;
  readonly vehicleZ: Float64Array;
  readonly vehicleHeading: Float64Array;
}

/** The convoy's trucks' cabs, lead first. */
const CONVOY_PAINTS = [0xe8742a, 0x2f6dff, 0x35a46b] as const;
/** The convoy's trucks, after the traffic's. */
const CONVOY_TRUCK: TrafficVehicleDefinition = {
  id: 'convoy_truck',
  kind: 'truck',
  lengthMeters: 9.4,
  widthMeters: 2.5,
  heightMeters: 3.5,
  cruiseSpeedFactor: 1,
  accelerationMetersPerSecondSquared: 1,
  spawnWeight: 0,
  colors: [0xffffff],
};

const ORANGE = 0xff6a13;
const AMBER = 0xffa31a;
/** Hazard lights and the arrow board blink this many times a second. */
const BLINK_HZ = 1.4;
/** A camera's flash dies away over this long, seconds. */
const FLASH_SECONDS = 0.3;
/** The camera's lens: this high on its post. */
const CAMERA_HEIGHT = 4.3;
/** The stranded car's warning triangle stands this far behind it. */
const TRIANGLE_BEHIND_METERS = 14;

/** The stranded car: a saloon, after the traffic's. */
const STRANDED_CAR: TrafficVehicleDefinition = {
  id: 'stranded_car',
  kind: 'car',
  carBody: 'saloon',
  lengthMeters: 4.5,
  widthMeters: 1.8,
  heightMeters: 1.45,
  cruiseSpeedFactor: 1,
  accelerationMetersPerSecondSquared: 1,
  spawnWeight: 0,
  colors: [0xffffff],
};

/**
 * The road's events in the world (RoadEventService): the speed cameras on
 * their posts and their blue warning signs (one merged mesh per world), the
 * day's road works (cones, signs, an arrow board blinking amber, a roller;
 * one mesh, made again when the works change), a stranded car with its
 * hazard lights blinking and a warning triangle behind it, and a camera's
 * flash. Lit by the scene's lights; the lamps glow at night.
 */
export class RoadEventsView {
  private readonly root = new Group();
  private readonly lambert = new MeshLambertMaterial({ vertexColors: true });
  /** What shines with its own light: the arrow boards' lamps, the hazard lights. */
  private readonly lit = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  /**
   * Each camera with its signs, and each of the day's works, a mesh of its
   * own: drawn only when in view (a few draw calls near them, none elsewhere).
   */
  private readonly fixtures: Mesh[] = [];
  private world: DrivingWorld | null = null;
  private shownZones: readonly WorkZone[] | null = null;
  private readonly car: Group;
  private readonly hazards: Mesh;
  private readonly triangle: Mesh;
  private readonly carGeometries: BufferGeometry[];
  private readonly convoyTrucks: Mesh[];
  /** The hazard lights' and the arrow boards' glows (at night), and a camera's flash. */
  private readonly glows = new LampGlows(16, 2.2);
  private readonly flashGlow = new LampGlows(1, 9);
  private flashLeft = 0;
  private time = 0;

  constructor(scene: Scene) {
    this.root.name = 'roadEvents';
    scene.add(this.root);
    this.root.add(this.glows.points, this.flashGlow.points);
    this.flashGlow.setColor(0, 0xffffff);
    const body = paintedCar(0x8b97a5);
    const lamps = hazardLamps();
    const triangle = warningTriangle();
    this.carGeometries = [body, lamps, triangle];
    this.car = new Group();
    this.car.add(new Mesh(body, this.lambert));
    this.hazards = new Mesh(lamps, this.lit);
    this.car.add(this.hazards);
    this.car.visible = false;
    this.triangle = new Mesh(triangle, this.lambert);
    this.triangle.visible = false;
    this.root.add(this.car, this.triangle);
    this.convoyTrucks = CONVOY_PAINTS.map((paint) => {
      const geometry = paintedVehicle(CONVOY_TRUCK, paint);
      this.carGeometries.push(geometry);
      const truck = new Mesh(geometry, this.lambert);
      truck.visible = false;
      this.root.add(truck);
      return truck;
    });
  }

  /** The world the truck drives in: its speed cameras are drawn (with the works). */
  setWorld(world: DrivingWorld): void {
    if (world === this.world) {
      return;
    }
    this.world = world;
    this.build(this.shownZones ?? []);
  }

  /** A camera caught the truck at (x, z): the camera there flashes. */
  flash(x: number, z: number): void {
    const cameras = this.world?.speedCameras ?? [];
    let best = Number.POSITIVE_INFINITY;
    let at: { readonly x: number; readonly z: number } = { x, z };
    for (const camera of cameras) {
      const distance = (camera.x - x) ** 2 + (camera.z - z) ** 2;
      if (distance < best && distance < 60 * 60) {
        best = distance;
        at = camera;
      }
    }
    this.flashGlow.setPosition(0, at.x, CAMERA_HEIGHT, at.z);
    this.flashGlow.setCount(1);
    this.flashLeft = FLASH_SECONDS;
  }

  /** Per frame: the works as they are today, the stranded car, the blinking and the flash. `night` 0..1 lights the glows. */
  update(dt: number, source: RoadEventsSource, night: number, convoy: ConvoySource): void {
    this.time += dt;
    if (source.workZones !== this.shownZones) {
      this.shownZones = source.workZones;
      this.build(source.workZones);
    }
    const blinkOn = (this.time * BLINK_HZ) % 1 < 0.5;
    let glows = 0;
    const stranded = source.stranded;
    this.car.visible = stranded !== null;
    this.triangle.visible = stranded !== null;
    if (stranded !== null) {
      this.car.position.set(stranded.x, 0, stranded.z);
      this.car.rotation.y = stranded.heading;
      this.hazards.visible = blinkOn;
      const sin = Math.sin(stranded.heading);
      const cos = Math.cos(stranded.heading);
      this.triangle.position.set(stranded.x - sin * TRIANGLE_BEHIND_METERS, 0, stranded.z - cos * TRIANGLE_BEHIND_METERS);
      this.triangle.rotation.y = stranded.heading + Math.PI;
      if (blinkOn) {
        for (const [across, along] of HAZARD_CORNERS) {
          this.glows.setPosition(glows, stranded.x + cos * across + sin * along, 0.78, stranded.z - sin * across + cos * along);
          this.glows.setColor(glows, AMBER);
          glows++;
        }
      }
    }
    for (let i = 0; i < this.convoyTrucks.length; i++) {
      const truck = this.convoyTrucks[i]!;
      truck.visible = convoy.active;
      if (convoy.active) {
        truck.position.set(convoy.vehicleX[i]!, 0, convoy.vehicleZ[i]!);
        truck.rotation.y = convoy.vehicleHeading[i]!;
      }
    }
    // The lead truck's amber beacon, blinking.
    if (convoy.active && blinkOn && glows < 16) {
      this.glows.setPosition(glows, convoy.vehicleX[0]!, CONVOY_TRUCK.heightMeters + 0.4, convoy.vehicleZ[0]!);
      this.glows.setColor(glows, AMBER);
      glows++;
    }
    if (blinkOn) {
      for (const zone of this.shownZones ?? []) {
        if (glows >= 16) {
          break;
        }
        const board = zone.arrowBoard;
        this.glows.setPosition(glows, board.x, 1.6, board.z);
        this.glows.setColor(glows, AMBER);
        glows++;
      }
    }
    this.glows.setCount(glows);
    this.glows.setLevel(glows > 0 ? Math.max(0.35, night) : 0);
    this.flashLeft = Math.max(0, this.flashLeft - dt);
    this.flashGlow.setLevel(this.flashLeft / FLASH_SECONDS);
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const fixture of this.fixtures) {
      fixture.geometry.dispose();
    }
    for (const geometry of this.carGeometries) {
      geometry.dispose();
    }
    this.lambert.dispose();
    this.lit.dispose();
    this.glows.dispose();
    this.flashGlow.dispose();
  }

  /**
   * The world's speed cameras with their signs, and the day's works
   * (`zones`), a mesh each, made again when the works change (once a day):
   * the arrow boards' lamps in them, their glow blinking over them.
   */
  private build(zones: readonly WorkZone[]): void {
    for (const fixture of this.fixtures) {
      fixture.geometry.dispose();
      fixture.removeFromParent();
    }
    this.fixtures.length = 0;
    const add = (parts: BufferGeometry[], name: string): void => {
      const fixture = new Mesh(merge(parts), this.lambert);
      fixture.name = name;
      // It never moves: its matrix is worked out once.
      fixture.matrixAutoUpdate = false;
      fixture.updateMatrix();
      this.fixtures.push(fixture);
      this.root.add(fixture);
    };
    for (const camera of this.world?.speedCameras ?? []) {
      add(
        [
          placed(cameraGeometry(), camera.x, camera.z, camera.heading),
          ...camera.signs.map((sign) => placed(cameraSignGeometry(), sign.x, sign.z, sign.heading)),
        ],
        'speedCamera',
      );
    }
    const at = (geometry: BufferGeometry, piece: ZonePiece): BufferGeometry => placed(geometry, piece.x, piece.z, piece.heading);
    for (const zone of zones) {
      add(
        [
          ...zone.cones.map((cone) => at(coneGeometry(), cone)),
          ...zone.signs.map((sign) => at(worksSignGeometry(), sign)),
          at(arrowBoardGeometry(), zone.arrowBoard),
          at(arrowLampsGeometry(), zone.arrowBoard),
          at(rollerGeometry(), zone.machine),
        ],
        'roadWorks',
      );
    }
  }
}

/** Where the hazard lights are, across and along the car from its middle. */
const HAZARD_CORNERS: readonly (readonly [number, number])[] = [
  [0.72, 2.2],
  [-0.72, 2.2],
  [0.72, -2.2],
  [-0.72, -2.2],
];

/** A speed camera: a grey post, a grey box with a yellow face and a black lens, looking along +z. */
function cameraGeometry(): BufferGeometry {
  return merge([
    cylinder(0.09, 0.11, CAMERA_HEIGHT, 6, 0x7c838c, 0, CAMERA_HEIGHT / 2, 0),
    box(0.5, 0.56, 0.74, 0, CAMERA_HEIGHT, 0, 0x34383e),
    box(0.54, 0.6, 0.05, 0, CAMERA_HEIGHT, 0.39, 0xf2c230),
    turned(cylinder(0.11, 0.11, 0.1, 8, 0x101214, 0, 0, 0), Math.PI / 2, 0, CAMERA_HEIGHT + 0.06, 0.45),
  ]);
}

/** Its warning sign: a blue square on a post with a white camera on it, facing +z. */
function cameraSignGeometry(): BufferGeometry {
  return merge([
    cylinder(0.05, 0.05, 2.0, 6, 0x9aa1a8, 0, 1.0, 0),
    box(0.72, 0.72, 0.04, 0, 2.25, 0.04, 0x1c54a0),
    box(0.36, 0.2, 0.03, -0.03, 2.22, 0.075, 0xf4f6f2),
    box(0.1, 0.08, 0.03, 0.18, 2.22, 0.075, 0xf4f6f2),
    box(0.12, 0.05, 0.03, -0.1, 2.36, 0.075, 0xf4f6f2),
  ]);
}

/** A traffic cone, orange with a white band, on a black foot. */
function coneGeometry(): BufferGeometry {
  return merge([
    box(0.42, 0.04, 0.42, 0, 0.02, 0, 0x16181b),
    cylinder(0.02, 0.21, 0.72, 6, ORANGE, 0, 0.4, 0),
    cylinder(0.11, 0.145, 0.13, 6, 0xf4f4f0, 0, 0.42, 0),
  ]);
}

/** The "road works" sign: a red-rimmed white triangle on a post, facing +z. */
function worksSignGeometry(): BufferGeometry {
  return merge([
    cylinder(0.05, 0.05, 1.9, 6, 0x9aa1a8, 0, 0.95, 0),
    turned(cylinder(0.62, 0.62, 0.04, 3, 0xd5281b, 0, 0, 0), Math.PI / 2, 0, 2.15, 0.05),
    turned(cylinder(0.44, 0.44, 0.04, 3, 0xf4f6f2, 0, 0, 0), Math.PI / 2, 0, 2.13, 0.08),
    box(0.1, 0.24, 0.03, 0, 2.08, 0.11, 0x16181b),
  ]);
}

/** An arrow board on its trailer, facing +z: black, its lamps apart (arrowLampsGeometry). */
function arrowBoardGeometry(): BufferGeometry {
  return merge([
    box(1.7, 0.25, 0.9, 0, 0.45, 0, 0x2c3036),
    turned(cylinder(0.25, 0.25, 0.2, 10, 0x16181b, 0, 0, 0), 0, 0, 0.3, 0, Math.PI / 2),
    box(0.1, 1.1, 0.1, 0, 1.0, -0.2, 0x5a6068),
    box(1.6, 1.0, 0.12, 0, 1.75, -0.2, 0x16181b),
  ]);
}

/** The arrow board's lamps, an amber arrow pointing to the traffic's left (away from the works). */
function arrowLampsGeometry(): BufferGeometry {
  const lamps: BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    lamps.push(box(0.11, 0.11, 0.03, 0.5 - i * 0.22, 1.75, -0.13, AMBER));
  }
  lamps.push(box(0.11, 0.11, 0.03, -0.25, 1.97, -0.13, AMBER), box(0.11, 0.11, 0.03, -0.25, 1.53, -0.13, AMBER));
  lamps.push(box(0.11, 0.11, 0.03, -0.08, 2.12, -0.13, AMBER), box(0.11, 0.11, 0.03, -0.08, 1.38, -0.13, AMBER));
  return merge(lamps);
}

/** A road roller, yellow, its drums grey. */
function rollerGeometry(): BufferGeometry {
  return merge([
    box(1.5, 0.9, 2.2, 0, 1.15, 0, 0xf2b705),
    box(1.3, 0.95, 1.0, 0, 2.05, -0.4, 0x24292f),
    box(1.4, 0.08, 1.15, 0, 2.56, -0.4, 0xf2b705),
    turned(cylinder(0.62, 0.62, 1.6, 14, 0x80878f, 0, 0, 0), 0, 0, 0.62, 1.45, Math.PI / 2),
    turned(cylinder(0.62, 0.62, 1.6, 14, 0x80878f, 0, 0, 0), 0, 0, 0.62, -1.45, Math.PI / 2),
  ]);
}

/** The stranded car, in `hex`, standing on the ground with +z its front. */
function paintedCar(hex: number): BufferGeometry {
  return paintedVehicle(STRANDED_CAR, hex);
}

/** A traffic body of `type` in `hex`, only its position, normal and colour kept. */
function paintedVehicle(type: TrafficVehicleDefinition, hex: number): BufferGeometry {
  const body = vehicleGeometry(type);
  const painted = body.getAttribute('paint');
  const colors = body.getAttribute('color');
  const color = new Color(hex);
  for (let i = 0; i < colors.count; i++) {
    if (painted !== undefined && painted.getX(i) > 0.5) {
      colors.setXYZ(i, color.r, color.g, color.b);
    }
  }
  for (const name of Object.keys(body.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'color') {
      body.deleteAttribute(name);
    }
  }
  if (body.index === null) {
    return body;
  }
  const flat = body.toNonIndexed();
  body.dispose();
  return flat;
}

/** Its hazard lights, at its four corners. */
function hazardLamps(): BufferGeometry {
  return merge(HAZARD_CORNERS.map(([across, along]) => box(0.22, 0.12, 0.08, across, 0.78, along + Math.sign(along) * 0.05, AMBER)));
}

/** A warning triangle standing on the road, facing +z. */
function warningTriangle(): BufferGeometry {
  return merge([
    turned(cylinder(0.36, 0.36, 0.03, 3, 0xd5281b, 0, 0, 0), Math.PI / 2, 0, 0.3, 0),
    turned(cylinder(0.24, 0.24, 0.035, 3, 0xf4f6f2, 0, 0, 0), Math.PI / 2, 0, 0.29, 0.01),
    box(0.5, 0.02, 0.2, 0, 0.01, -0.06, 0x16181b),
  ]);
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, hex: number): BufferGeometry {
  const geometry = new BoxGeometry(w, h, d).translate(x, y, z);
  geometry.deleteAttribute('uv');
  return paint(geometry.toNonIndexed(), hex, geometry);
}

function cylinder(radiusTop: number, radiusBottom: number, length: number, segments: number, hex: number, x: number, y: number, z: number): BufferGeometry {
  const geometry = new CylinderGeometry(radiusTop, radiusBottom, length, segments).translate(x, y, z);
  geometry.deleteAttribute('uv');
  return paint(geometry.toNonIndexed(), hex, geometry);
}

/** `geometry` turned about x (`aboutX`) then z (`aboutZ`), then moved to (x, y, z). */
function turned(geometry: BufferGeometry, aboutX: number, x: number, y: number, z: number, aboutZ = 0): BufferGeometry {
  return geometry.rotateX(aboutX).rotateZ(aboutZ).translate(x, y, z);
}

/** Colours every vertex of `geometry` `hex`; disposes `source`, the indexed shape it came from. */
function paint(geometry: BufferGeometry, hex: number, source: BufferGeometry): BufferGeometry {
  source.dispose();
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

/** Pieces merged into one, the pieces disposed. */
function merge(parts: readonly BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts as BufferGeometry[]);
  for (const part of parts) {
    part.dispose();
  }
  if (merged === null) {
    throw new Error('Road event pieces do not merge.');
  }
  return merged;
}

/** `geometry` (made round the origin, its front +z) turned to `heading` and stood at (x, 0, z). */
function placed(geometry: BufferGeometry, x: number, z: number, heading: number): BufferGeometry {
  return geometry.rotateY(heading).translate(x, 0, z);
}
