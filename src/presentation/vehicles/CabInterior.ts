import {
  BoxGeometry,
  BufferAttribute,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Group,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, dampFactor, degreesToRadians, smoothstep } from '../../core/math/scalar';
import { SeededRandom } from '../../core/random/SeededRandom';
import type { VehicleDefinition } from '../../data/definitions/VehicleDefinition';
import type { VehicleRuntimeState } from '../../domain/vehicles/VehicleRuntimeState';
import {
  CAB_ATLAS,
  CAB_ATLAS_HEIGHT,
  CAB_ATLAS_WIDTH,
  CLUSTER_DIALS,
  cabAtlasImage,
  dialAngle,
  type AtlasRect,
  type DialLayout,
} from '../textures/cabImages';
import { toTexture } from '../textures/toTexture';
import type { SceneLight, SkyUniforms } from '../world/EnvironmentView';
import type { CabGeometry } from './cabGeometry';
import { createCabinLight, lightCabin, shadeCabin, type CabinLightUniforms } from './cabinShading';

/** The steering wheel turns this many times as far as the front wheels: about 1¼ turns to full lock. */
export const STEERING_RATIO = 12;
/** The steering column leans back toward the driver this far from upright, radians: a truck's wheel lies flat. */
const STEERING_TILT = 0.9;
/** The wheel's middle from the driver's eye, meters ahead and below; its rim's radius and thickness. */
const WHEEL_AHEAD = 0.5;
const WHEEL_BELOW = 0.48;
const WHEEL_RADIUS = 0.225;
const RIM_TUBE = 0.017;
/**
 * The instrument cluster: its size (meters), and where the driver sees its
 * middle: this far away, this far below straight ahead, over the wheel's rim.
 */
const CLUSTER_WIDTH = 0.54;
const CLUSTER_HEIGHT = 0.18;
const CLUSTER_DISTANCE = 0.82;
const CLUSTER_DOWN = degreesToRadians(23);
/** Meters per pixel of the cluster picture (square pixels: 768 × 256 over 0.54 × 0.18 m). */
const CLUSTER_METERS_PER_PIXEL = CLUSTER_WIDTH / CAB_ATLAS.cluster.width;
/** The navigation screen's size, meters. */
const SCREEN_WIDTH = 0.25;
const SCREEN_HEIGHT = 0.14;
/** The screen is a display: this bright by day, dimmed at night so it does not dazzle. */
const SCREEN_DAY = 0.95;
const SCREEN_NIGHT = 0.55;
/** The needles follow what they show like a gauge's stepper motor: this fast (1/s). */
const NEEDLE_RATE = 9;
/** The brakes' air: governed between these pressures (bar), used while braking, pumped back by the engine. */
const AIR_CUT_IN_BAR = 7.6;
const AIR_CUT_OUT_BAR = 8.9;
const AIR_USE_BAR_PER_SECOND = 0.55;
const AIR_PUMP_BAR_PER_SECOND = 0.22;
/** The second air circuit reads this much lower than the first. */
const AIR_SECOND_CIRCUIT_BAR = 0.25;
/** The coolant: at its working temperature (a fraction of the gauge), a little warmer under load, slowly. */
const COOLANT_WORKING = 0.52;
const COOLANT_UNDER_LOAD = 0.08;
const COOLANT_RATE = 0.05;
/** The display: amber segments lit, dark ones only just showing; the colon blinks each second. */
const SEGMENT_LIT = new Color(1, 0.5, 0.1);
const SEGMENT_DARK = new Color(0.035, 0.03, 0.025);
/** The charm under the roof console: its string's length (m) and how its swing dies away (1/s). */
const CHARM_STRING = 0.16;
const CHARM_DAMPING = 1.1;
/** The road shakes the charm: random pushes (rad/s² per m/s of speed). */
const CHARM_SHAKE = 0.9;
const GRAVITY = 9.81;
/** The road's dashed line in the mirrors repeats every this many meters (the travel is kept below it). */
const MIRROR_DASH_REPEAT = 12;

// The cab's colours, as painted on the atlas's white (its textured parts are painted white).
const DASH_TOP = 0x3b3f45;
const DASH = 0x6d737b;
const DASH_TRIM = 0x878d95;
const HEADLINING = 0xa9adb2;
const PILLAR = 0x8e939a;
const DOOR = 0x6f747b;
const DOOR_TOP = 0x8a8f96;
const BOLSTER = 0x4a4e55;
const FRAME = 0x2e3136;
const RIM = 0x26292e;
const SPOKE = 0x50555c;
const BUTTON = 0x15171a;
const ACCENT = 0xf2b233;
const CHROME = 0xc3c9d0;
const VISOR = 0xa9adb3;
const WHITE = 0xffffff;
const DIE = 0xf1efe8;
const PIP = 0x121316;
const CHARM_STRING_COLOR = 0x2b2d31;
/** The charm's two dice: each this big (m), their pips this far off a face's middle and this big across. */
const DIE_SIZE = 0.028;
const PIP_OFFSET = 0.0078;
const PIP_RADIUS = 0.0028;
/** Where a face's pips sit for each number, in steps of PIP_OFFSET across and up the face. */
const PIPS: Readonly<Record<number, readonly (readonly [number, number])[]>> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
  5: [[-1, -1], [-1, 1], [0, 0], [1, -1], [1, 1]],
  6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
};

/**
 * The lit segments of each figure 0–9: a (top), b, c (right, top and
 * bottom), d (bottom), e, f (left, bottom and top), g (middle); and of the
 * reverse and neutral gears' r and n.
 */
const DIGITS: readonly string[] = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];
const REVERSE = 'eg';
const NEUTRAL = 'ceg';
const SEGMENTS = 'abcdefg';

/** What the cab is built with beyond the truck's model and its geometry. */
export interface CabInteriorOptions {
  /** The sky the side mirrors show (EnvironmentView.sky); a fixed daylight without it. */
  readonly sky?: SkyUniforms;
}

/** The instruments' readings that the truck's motion does not give (DrivingService, the fuel, the time). */
export interface DashboardReadings {
  /** Fuel left, 0..1. */
  readonly fuelFraction: number;
  /** The time of day, minutes after midnight. */
  readonly clockMinutes: number;
  /** How far the driver presses to drive and to brake, 0..1 (the engine warms, the brakes use air). */
  readonly drivePedal: number;
  readonly brakePedal: number;
}

/** A needle on the cluster: its dial, and its place and length in the cluster's own frame. */
interface Needle {
  readonly dial: DialLayout;
  /** The cluster frame times the needle's pivot: the needle turns about z after it. */
  readonly base: Matrix4;
  readonly length: number;
  angle: number;
}

/**
 * The cab's inside, as the driver sees it from the seat (cabGeometry's
 * eye): a wrap-round dashboard with the instrument cluster in a hood behind
 * the steering wheel (rev counter, speedometer, air pressure, fuel,
 * temperature and oil gauges, and a display with the clock and the gear);
 * the navigation screen and switches on a centre stack turned toward the
 * driver; the steering wheel on its column with its stalks; the pillars, the
 * roof console with its radio and lids, sun visors, the doors with their
 * armrests, handles, speakers and pockets, both seats, the floor mat and
 * pedals, the sleeper's curtain; and a pair of dice hanging from the roof
 * console, swinging as the truck brakes, turns and shakes.
 *
 * All of it is one material and an atlas (cabImages.ts), lit as under a roof
 * (cabinShading.ts): the sun only where it shines in, the instruments
 * glowing at night. The side mirrors show a painted view back (the sky, the
 * road running away, the truck's side), not a second render. Eight draw
 * calls: the cab, the wheel, the needles, the display's segments, the charm,
 * the screen and the two mirrors.
 *
 * update() runs every frame the cab is shown and allocates nothing.
 */
export class CabInterior {
  readonly root = new Group();
  private readonly material: MeshBasicMaterial;
  private readonly uniforms = createCabinLight();
  private readonly steeringWheel: Mesh;
  private readonly needles: InstancedMesh;
  private readonly needleList: readonly Needle[];
  private readonly segments: InstancedMesh;
  /** Per segment of the display: which figure (0–3 the clock's, 4 the gear) and which of its segments ('abcdefg'), or the colon. */
  private readonly segmentOf: readonly { readonly figure: number; readonly segment: string }[];
  private readonly charm = new Group();
  private readonly screenMaterial: MeshBasicMaterial;
  private readonly screenTexture = new Texture<object | null>(null);
  /** The side mirrors' picture: how far the truck has come, so the road's lines run away behind it. */
  private readonly mirrorTravel = { value: 0 };
  private readonly resources: { dispose(): void }[] = [];
  private readonly random = new SeededRandom(4127);
  /** What each needle shows now, in its dial's units (update()). */
  private readonly readings = new Float64Array(7);
  // What the instruments show.
  private fuel = 1;
  private clockMinute = -1;
  private gear = Number.NaN;
  private drivePedal = 0;
  private brakePedal = 0;
  private air = AIR_CUT_OUT_BAR;
  private pumping = false;
  private coolant = COOLANT_WORKING;
  private colonSeconds = 0;
  private colonLit = true;
  private lamps = 0;
  private screenVersion = -1;
  private screenWidth = 0;
  private screenHeight = 0;
  // The charm's swing, radians to the left and forward, and how fast.
  private swingLeft = 0;
  private swingAhead = 0;
  private swingLeftRate = 0;
  private swingAheadRate = 0;
  // Scratch objects reused every frame.
  private readonly matrix = new Matrix4();
  private readonly turn = new Matrix4();
  private readonly scale = new Matrix4();

  constructor(definition: VehicleDefinition, cab: CabGeometry, options: CabInteriorOptions = {}) {
    const { widthMeters: W, wheelRadiusMeters: R } = definition.body;
    const { frontZ, cabTop, beltY, cabLength, eyeX, eyeY, eyeZ } = cab;
    const eye = new Vector3(eyeX, eyeY, eyeZ);
    const halfW = W / 2;
    const glassBottom = beltY + (cabTop - beltY) * 0.1;
    const glassZ = frontZ - 0.038;
    /** Just inside the windscreen; the side walls' and the roof's inner faces; the floor; the back wall. */
    const inner = glassZ - 0.012;
    const wall = halfW - 0.07;
    const roof = cabTop - 0.035;
    const floor = Math.max(2 * R + 0.16, eyeY - 1.3);
    const back = frontZ - cabLength + 0.1;
    /** The dashboard's top, just over the foot of the glass, and its face, past the driver's knees. */
    const dashTop = glassBottom + 0.07;
    const dashFace = eyeZ + 0.56;
    /** The side windows (as TruckView cuts them): along the cab, and from sill to header. */
    const windowFront = frontZ - 0.25;
    const windowRear = windowFront - cabLength * 0.5;
    const windowBottom = beltY + (cabTop - beltY) * 0.18;
    const windowTop = windowBottom + (cabTop - beltY) * 0.7;
    /** The seats: the cushion's top, and the driver's hip a little ahead of the eye. */
    const seatTop = eyeY - 0.8;
    const hipZ = eyeZ + 0.1;

    this.material = this.track(new MeshBasicMaterial({ map: this.track(toTexture(cabAtlasImage(definition.powertrain.maxRpm, definition.maxSpeedKmh))), vertexColors: true }));
    shadeCabin(this.material, this.uniforms);

    const parts: BufferGeometry[] = [];
    const add = (geometry: BufferGeometry, color: number, rect: AtlasRect = CAB_ATLAS.plain): void => {
      parts.push(dress(geometry, color, rect));
    };
    const block = (size: readonly [number, number, number], at: readonly [number, number, number], color: number, turn?: Euler): void => {
      add(place(new BoxGeometry(size[0], size[1], size[2]), at, turn), color);
    };
    const panel = (width: number, height: number, at: readonly [number, number, number], turn: Euler, rect: AtlasRect, color = WHITE): void => {
      add(place(new PlaneGeometry(width, height), at, turn), color, rect);
    };
    const facingDriver = new Euler(0, Math.PI, 0, 'YXZ');
    const facingUp = new Euler(-Math.PI / 2, 0, 0, 'YXZ');

    // The dashboard: a dark top along the glass, the face below it, a lip between, the glovebox's lid, vents,
    // the demister's grille along the glass and a speaker at each end.
    block([2 * wall, 0.12, inner - dashFace], [0, dashTop - 0.06, (inner + dashFace) / 2], DASH_TOP);
    block([2 * wall, dashTop - 0.12 - (floor + 0.45), inner - 0.15 - (dashFace + 0.04)], [0, (dashTop - 0.12 + floor + 0.45) / 2, (inner - 0.15 + dashFace + 0.04) / 2], DASH);
    block([2 * wall, 0.025, 0.05], [0, dashTop - 0.125, dashFace + 0.02], DASH_TRIM);
    block([0.46, 0.2, 0.012], [-eyeX, dashTop - 0.3, dashFace + 0.036], DASH_TRIM);
    block([0.1, 0.02, 0.01], [-eyeX, dashTop - 0.22, dashFace + 0.03], CHROME);
    for (const x of [wall - 0.13, 0.28, -0.28, -(wall - 0.13)]) {
      panel(0.13, 0.09, [x, dashTop - 0.06, dashFace - 0.002], facingDriver, CAB_ATLAS.vent);
    }
    for (let i = 0; i < 4; i++) {
      panel(0.5, 0.035, [-0.84 + i * 0.56, dashTop + 0.002, inner - 0.035], facingUp, CAB_ATLAS.slots);
    }
    for (const side of [1, -1] as const) {
      panel(0.15, 0.15, [side * (wall - 0.15), dashTop + 0.002, inner - 0.15], facingUp, CAB_ATLAS.speaker);
    }
    // The delivery papers on a clipboard, on the passenger's side of the dashboard.
    const papers = new Euler(0, 0.35, 0);
    block([0.24, 0.006, 0.32], [-0.62, dashTop + 0.003, inner - 0.22], FRAME, papers);
    block([0.21, 0.004, 0.28], [-0.62, dashTop + 0.008, inner - 0.225], 0xeeede6, papers);
    block([0.08, 0.014, 0.03], [-0.62 + 0.047, dashTop + 0.013, inner - 0.22 + 0.13], CHROME, papers);

    // The instrument cluster in its hood, facing the driver's eye through the top of the steering wheel.
    const clusterAt = new Vector3(eyeX, eyeY - CLUSTER_DISTANCE * Math.sin(CLUSTER_DOWN), eyeZ + CLUSTER_DISTANCE * Math.cos(CLUSTER_DOWN));
    const clusterTurn = facing(clusterAt, eye);
    const clusterFrame = new Matrix4().makeRotationFromEuler(clusterTurn).setPosition(clusterAt);
    const clusterUp = new Vector3(0, 1, 0).applyEuler(clusterTurn);
    const clusterNormal = new Vector3(0, 0, 1).applyEuler(clusterTurn);
    panel(CLUSTER_WIDTH, CLUSTER_HEIGHT, [clusterAt.x, clusterAt.y, clusterAt.z], clusterTurn, CAB_ATLAS.cluster);
    const behindCluster = clusterAt.clone().addScaledVector(clusterNormal, -0.052);
    block([CLUSTER_WIDTH + 0.05, CLUSTER_HEIGHT + 0.05, 0.1], behindCluster.toArray(), DASH_TOP, clusterTurn);
    const hood = clusterAt.clone().addScaledVector(clusterUp, CLUSTER_HEIGHT / 2 + 0.024).addScaledVector(clusterNormal, 0.03);
    block([CLUSTER_WIDTH + 0.08, 0.022, 0.15], hood.toArray(), DASH_TOP, clusterTurn);
    const clusterFoot = clusterAt.y - (CLUSTER_HEIGHT / 2 + 0.025) * clusterUp.y;
    const clusterBase = [clusterAt.z - 0.04, inner - 0.02] as const;
    block(
      [CLUSTER_WIDTH + 0.05, clusterFoot - dashTop + 0.06, clusterBase[1] - clusterBase[0]],
      [clusterAt.x, (clusterFoot + dashTop) / 2 - 0.02, (clusterBase[0] + clusterBase[1]) / 2],
      DASH_TOP,
    );

    // The centre stack: the navigation screen (its own mesh, below) over a row of switches, turned to the driver.
    const stackAt = new Vector3(-0.1, dashTop + 0.12, eyeZ + 0.83);
    const stackTurn = facing(stackAt, eye);
    const stackUp = new Vector3(0, 1, 0).applyEuler(stackTurn);
    const stackNormal = new Vector3(0, 0, 1).applyEuler(stackTurn);
    block([SCREEN_WIDTH + 0.09, 0.27, 0.1], stackAt.clone().addScaledVector(stackNormal, -0.05).toArray(), DASH_TOP, stackTurn);
    const switchesAt = stackAt.clone().addScaledVector(stackUp, -0.088).addScaledVector(stackNormal, 0.002);
    panel(SCREEN_WIDTH + 0.02, 0.066, switchesAt.toArray(), stackTurn, CAB_ATLAS.switches);
    const stackFoot = stackAt.y - 0.135 * stackUp.y;
    const stackBase = [stackAt.z - 0.03, inner - 0.02] as const;
    block(
      [SCREEN_WIDTH + 0.08, stackFoot - dashTop + 0.05, stackBase[1] - stackBase[0]],
      [stackAt.x, (stackFoot + dashTop) / 2 - 0.02, (stackBase[0] + stackBase[1]) / 2],
      DASH_TOP,
    );

    // The steering column: its shroud and the stalks either side, fixed; the wheel turns on it (below).
    const wheelAt = new Vector3(eyeX, eyeY - WHEEL_BELOW, eyeZ + WHEEL_AHEAD);
    const column = new Matrix4().makeRotationFromEuler(new Euler(STEERING_TILT, 0, 0)).setPosition(wheelAt);
    const onColumn = (geometry: BufferGeometry, color: number): void => {
      add(geometry.applyMatrix4(column), color);
    };
    onColumn(new BoxGeometry(0.1, 0.09, 0.36).translate(0, 0, 0.24), FRAME);
    for (const side of [1, -1] as const) {
      onColumn(new BoxGeometry(0.15, 0.013, 0.013).rotateZ(side * 0.12).translate(side * 0.12, 0.012, 0.1), FRAME);
      onColumn(new BoxGeometry(0.035, 0.022, 0.022).translate(side * 0.2, 0.021, 0.1), side === 1 ? FRAME : DASH_TRIM);
    }

    // The windscreen's pillars, turned toward the middle of the cab, with a grab handle on each.
    for (const side of [1, -1] as const) {
      block([0.1, roof - dashTop, 0.08], [side * (halfW - 0.09), (roof + dashTop) / 2, inner - 0.03], PILLAR, new Euler(0, side * 0.35, 0));
      block([0.025, 0.3, 0.03], [side * (wall - 0.075), beltY + 0.35, windowFront + 0.06], DASH_TRIM);
    }

    // The roof: its lining; the console over the windscreen with the radio between two pairs of lids; the sun
    // visors under it, the driver's a little lowered.
    block([2 * wall, 0.02, inner - back], [0, roof + 0.01, (inner + back) / 2], HEADLINING);
    const consoleDepth = 0.24;
    const consoleBottom = roof - 0.085;
    block([2 * wall - 0.04, roof - consoleBottom, consoleDepth], [0, (roof + consoleBottom) / 2, inner - consoleDepth / 2], HEADLINING);
    const consoleFace = inner - consoleDepth - 0.002;
    panel(0.17, 0.075, [0, (roof + consoleBottom) / 2, consoleFace], facingDriver, CAB_ATLAS.radio);
    for (const side of [1, -1] as const) {
      for (const at of [0.32, 0.76]) {
        panel(0.4, 0.075, [side * at, (roof + consoleBottom) / 2, consoleFace], facingDriver, CAB_ATLAS.lids);
      }
    }
    const visorHinge = consoleFace - 0.01;
    for (const [x, lowered] of [
      [eyeX, degreesToRadians(14)],
      [-eyeX, degreesToRadians(6)],
    ] as const) {
      const reach = 0.1;
      block([0.5, 0.014, 0.2], [x, consoleBottom - 0.005 - reach * Math.sin(lowered), visorHinge - reach * Math.cos(lowered)], VISOR, new Euler(-lowered, 0, 0));
    }

    // The walls: each door's card under its window, its armrest, handle, speaker and pocket; the frames round
    // the windows; the walls behind the doors.
    for (const side of [1, -1] as const) {
      const x = side * wall;
      const doorRear = windowRear - 0.05;
      const doorFront = inner - 0.12;
      block([0.05, beltY - floor, doorFront - doorRear], [x - side * 0.025, (beltY + floor) / 2, (doorFront + doorRear) / 2], DOOR);
      block([0.07, windowBottom - beltY + 0.02, doorFront - doorRear], [x - side * 0.035, (windowBottom + beltY) / 2, (doorFront + doorRear) / 2], DOOR_TOP);
      block([0.08, 0.05, 0.38], [x - side * 0.09, beltY - 0.12, eyeZ + 0.12], DOOR_TOP);
      block([0.025, 0.03, 0.12], [x - side * 0.065, beltY - 0.03, eyeZ + 0.36], CHROME);
      panel(0.16, 0.16, [x - side * 0.0515, floor + 0.24, eyeZ + 0.46], new Euler(0, -side * (Math.PI / 2), 0, 'YXZ'), CAB_ATLAS.speaker);
      block([0.03, 0.12, 0.44], [x - side * 0.065, floor + 0.14, eyeZ + 0.02], DOOR_TOP);
      // The door's frame in front of its window is slim: past it, a glimpse of the road ahead.
      block([0.04, roof - beltY, 0.05], [x - side * 0.02, (roof + beltY) / 2, windowFront + 0.025], PILLAR);
      block([0.04, roof - windowTop, windowFront - windowRear], [x - side * 0.02, (roof + windowTop) / 2, (windowFront + windowRear) / 2], HEADLINING);
      block([0.04, roof - floor, windowRear - back], [x - side * 0.02, (roof + floor) / 2, (windowRear + back) / 2], DOOR);
    }

    // The back: the wall, the bunk and its curtain, drawn most of the way across.
    block([2 * wall, roof - floor, 0.04], [0, (roof + floor) / 2, back - 0.02], DOOR);
    block([2 * wall, 0.16, 0.62], [0, floor + 0.52, back + 0.31], BOLSTER);
    const curtainHeight = roof - 0.06 - (floor + 0.62);
    const curtainMiddle = (roof - 0.06 + floor + 0.62) / 2;
    panel(1.5, curtainHeight, [-(wall - 0.75), curtainMiddle, back + 0.64], new Euler(), CAB_ATLAS.curtain);
    // The rest of it gathered at its edge.
    block([0.12, curtainHeight, 0.08], [-wall + 1.56, curtainMiddle, back + 0.64], 0x4e5362);

    // The floor: the mat, the engine's hump between the seats with a console on it, and the pedals.
    block([2 * wall, 0.04, inner - 0.15 - back], [0, floor - 0.02, (inner - 0.15 + back) / 2], FRAME);
    panel(2 * wall - 0.02, inner - 0.16 - back, [0, floor + 0.002, (inner - 0.16 + back) / 2], facingUp, CAB_ATLAS.mat);
    block([0.5, 0.22, dashFace + 0.1 - (back + 0.3)], [0, floor + 0.11, (dashFace + 0.1 + back + 0.3) / 2], DASH);
    block([0.3, 0.28, 0.62], [0, floor + 0.36, eyeZ - 0.02], DASH);
    for (const z of [eyeZ + 0.16, eyeZ + 0.04]) {
      add(place(new CircleGeometry(0.035, 16), [0, floor + 0.501, z], facingUp), BUTTON);
    }
    block([0.07, 0.2, 0.015], [eyeX - 0.15, floor + 0.14, eyeZ + 0.86], FRAME, new Euler(-0.5, 0, 0));
    block([0.14, 0.1, 0.015], [eyeX + 0.04, floor + 0.2, eyeZ + 0.8], FRAME, new Euler(-0.4, 0, 0));
    block([2 * wall, floor + 0.45 - floor, 0.02], [0, floor + 0.225, inner - 0.14], DASH);

    // The seats: the driver's (seen when looking round) and the passenger's.
    for (const x of [eyeX, -eyeX]) {
      addSeat(add, block, x, floor, seatTop, hipZ);
    }

    const interior = this.track(mergeGeometries(parts));
    for (const part of parts) {
      part.dispose();
    }
    shadeByPlace(interior, floor, beltY, back);
    const interiorMesh = new Mesh(interior, this.material);
    interiorMesh.name = 'cab-interior';
    this.root.add(interiorMesh);

    // The steering wheel: a thick rim with grips at a quarter to three, three spokes with their buttons, and a hub
    // with the badge. It turns about its column (rotation.z); a mark at the top shows straight ahead.
    this.steeringWheel = new Mesh(this.track(steeringWheelGeometry()), this.material);
    this.steeringWheel.name = 'steering-wheel';
    const columnGroup = new Group();
    columnGroup.position.copy(wheelAt);
    columnGroup.rotation.x = STEERING_TILT;
    columnGroup.add(this.steeringWheel);
    this.root.add(columnGroup);

    // The needles, turning over the cluster's dials.
    const dials = CLUSTER_DIALS;
    const needleDials: readonly DialLayout[] = [dials.tachometer, dials.speedometer, dials.air, dials.air, dials.fuel, dials.temperature, dials.oil];
    this.needleList = needleDials.map((dial) => {
      const x = (dial.x - CAB_ATLAS.cluster.width / 2) * CLUSTER_METERS_PER_PIXEL;
      const y = (dial.y - CAB_ATLAS.cluster.height / 2) * CLUSTER_METERS_PER_PIXEL;
      return {
        dial,
        base: clusterFrame.clone().multiply(new Matrix4().makeTranslation(x, y, 0.004)),
        length: dial.radius * CLUSTER_METERS_PER_PIXEL * 0.9,
        angle: dialAngle(dial, dial.min),
      };
    });
    this.needles = new InstancedMesh(this.track(needleGeometry()), this.material, this.needleList.length);
    this.needles.name = 'cab-needles';
    this.track(this.needles);
    this.placeNeedles();
    this.root.add(this.needles);

    // The display's segments: the clock (four figures and a colon) at the top, the gear (one large figure) under it.
    const segmentOf: { figure: number; segment: string }[] = [];
    const segmentMatrices: Matrix4[] = [];
    const figureSlots: readonly (readonly [x: number, y: number, height: number])[] = [
      [350, 188, 26],
      [368, 188, 26],
      [400, 188, 26],
      [418, 188, 26],
      [384, 128, 58],
    ];
    figureSlots.forEach(([px, py, heightPixels], figure) => {
      for (const segment of SEGMENTS) {
        segmentOf.push({ figure, segment });
        segmentMatrices.push(segmentMatrix(clusterFrame, px, py, heightPixels, segment));
      }
    });
    for (const py of [194, 182]) {
      segmentOf.push({ figure: -1, segment: ':' });
      segmentMatrices.push(segmentMatrix(clusterFrame, 384, py, 26, ':'));
    }
    this.segmentOf = segmentOf;
    this.segments = new InstancedMesh(this.track(segmentGeometry()), this.material, segmentOf.length);
    this.segments.name = 'cab-display';
    this.track(this.segments);
    segmentMatrices.forEach((matrix, i) => {
      this.segments.setMatrixAt(i, matrix);
      this.segments.setColorAt(i, SEGMENT_DARK);
    });
    this.root.add(this.segments);
    this.showDisplay(0, 1);

    // The navigation screen: the minimap's picture (setNavigation), dark until it comes.
    this.screenTexture.colorSpace = SRGBColorSpace;
    this.screenTexture.minFilter = LinearFilter;
    this.screenTexture.generateMipmaps = false;
    this.track(this.screenTexture);
    this.screenMaterial = this.track(new MeshBasicMaterial({ map: this.screenTexture, color: new Color().setScalar(SCREEN_DAY) }));
    const screenGeometry = new PlaneGeometry(SCREEN_WIDTH, SCREEN_HEIGHT);
    // The square map, its middle band across the wide screen.
    const screenUv = screenGeometry.getAttribute('uv');
    for (let i = 0; i < screenUv.count; i++) {
      screenUv.setY(i, 0.5 + (screenUv.getY(i) - 0.5) * (SCREEN_HEIGHT / SCREEN_WIDTH));
    }
    const screen = new Mesh(this.track(place(screenGeometry, stackAt.clone().addScaledVector(stackUp, 0.035).addScaledVector(stackNormal, 0.002).toArray(), stackTurn)), this.screenMaterial);
    screen.name = 'cab-navigation';
    this.root.add(screen);

    // The side mirrors' pictures, over their glass: the road running away behind, the truck's own side along the
    // inner edge, the sky. Only the driver sees them.
    const mirrorMaterial = this.track(mirrorPicture(options.sky, definition.bodyType === 'flatbed' ? 0x6e5238 : 0xe6e7e3, this.mirrorTravel));
    for (const side of [1, -1] as const) {
      const { mirror } = cab;
      const geometry = this.track(new PlaneGeometry(mirror.width, mirror.height).rotateY(Math.PI).translate(side * mirror.x, mirror.y, mirror.z - 0.002));
      // Which way is outward across the glass as the driver sees it: the right edge on the left mirror.
      const outward = new Float32Array(geometry.getAttribute('position').count).fill(side);
      geometry.setAttribute('outward', new BufferAttribute(outward, 1));
      const picture = new Mesh(geometry, mirrorMaterial);
      picture.name = 'cab-mirror';
      this.root.add(picture);
    }

    // The charm: a pair of dice on a dark cord, hanging from the roof console's edge between the driver and the
    // middle of the glass.
    this.charm.position.set(Math.min(0.12, eyeX * 0.3), consoleBottom, consoleFace - 0.02);
    const charm = new Mesh(this.track(charmGeometry()), this.material);
    charm.name = 'cab-charm';
    this.charm.add(charm);
    this.root.add(this.charm);
  }

  /**
   * Moves what moves in the cab by the truck's `state` over `deltaSeconds`:
   * the steering wheel with the front wheels, the needles to the speed, the
   * revs, the fuel, the air and the temperatures, the display, the charm's
   * swing; and lights it all as the scene is lit (`light`, when given) for a
   * truck heading `heading`. Allocation-free.
   */
  update(state: Readonly<VehicleRuntimeState>, deltaSeconds: number, heading: number, light?: SceneLight): void {
    // Clockwise, as the driver sees it, for a right turn.
    this.steeringWheel.rotation.z = state.steerAngle * STEERING_RATIO;
    this.mirrorTravel.value = state.odometerMeters % MIRROR_DASH_REPEAT;
    if (light !== undefined) {
      lightCabin(this.uniforms, light, heading, this.lamps);
    }

    // The brakes use air, the engine's compressor pumps it back between its cut-in and cut-out pressures.
    const running = state.engineRpm > 100;
    if (this.air < AIR_CUT_IN_BAR) {
      this.pumping = true;
    } else if (this.air >= AIR_CUT_OUT_BAR) {
      this.pumping = false;
    }
    this.air += (-this.brakePedal * AIR_USE_BAR_PER_SECOND * Math.min(1, Math.abs(state.speed) + 0.2) + (this.pumping && running ? AIR_PUMP_BAR_PER_SECOND : 0)) * deltaSeconds;
    this.air = clamp(this.air, 0, AIR_CUT_OUT_BAR + 0.1);
    this.coolant += (COOLANT_WORKING + COOLANT_UNDER_LOAD * this.drivePedal - this.coolant) * Math.min(1, COOLANT_RATE * deltaSeconds);

    const readings = this.readings;
    readings[0] = state.engineRpm;
    readings[1] = Math.abs(state.speed) * 3.6;
    readings[2] = this.air;
    readings[3] = this.air - AIR_SECOND_CIRCUIT_BAR;
    readings[4] = this.fuel;
    readings[5] = this.coolant;
    readings[6] = running ? clamp(1.2 + state.engineRpm / 900, 0, 4.2) : 0;
    const follow = dampFactor(NEEDLE_RATE, deltaSeconds);
    for (let i = 0; i < this.needleList.length; i++) {
      const needle = this.needleList[i]!;
      needle.angle += (dialAngle(needle.dial, readings[i]!) - needle.angle) * follow;
    }
    this.placeNeedles();

    this.colonSeconds += deltaSeconds;
    if (this.colonSeconds >= 0.5) {
      this.colonSeconds -= Math.floor(this.colonSeconds / 0.5) * 0.5;
      this.colonLit = !this.colonLit;
      this.showColon();
    }
    if (state.gear !== this.gear) {
      this.gear = state.gear;
      this.showDisplay(this.clockMinute < 0 ? 0 : this.clockMinute, state.gear);
    }
    this.swing(state, deltaSeconds);
  }

  /** The readings the truck's motion does not give: the fuel, the time, the pedals. Cheap every frame. */
  setDashboard(readings: DashboardReadings): void {
    this.fuel = clamp(readings.fuelFraction, 0, 1);
    this.drivePedal = clamp(readings.drivePedal, 0, 1);
    this.brakePedal = clamp(readings.brakePedal, 0, 1);
    const minute = Math.floor(readings.clockMinutes);
    if (minute !== this.clockMinute) {
      this.clockMinute = minute;
      this.showDisplay(minute, Number.isNaN(this.gear) ? 1 : this.gear);
    }
  }

  /** The lamps' level (0 by day, 1 at night): the instruments glow brighter and the screen dims with them. */
  setLamps(level: number): void {
    this.lamps = clamp(level, 0, 1);
    this.screenMaterial.color.setScalar(SCREEN_DAY + (SCREEN_NIGHT - SCREEN_DAY) * this.lamps);
  }

  /**
   * Shows `picture` (a canvas, as the minimap paints it) on the navigation
   * screen when `version` (its paint count) is new: an upload only then.
   */
  setNavigation(picture: { readonly width: number; readonly height: number }, version: number): void {
    if (version === this.screenVersion || picture.width <= 0 || picture.height <= 0) {
      return;
    }
    this.screenVersion = version;
    if (picture.width !== this.screenWidth || picture.height !== this.screenHeight) {
      // A picture of another size needs the texture made anew (its storage keeps its first size).
      this.screenTexture.dispose();
      this.screenWidth = picture.width;
      this.screenHeight = picture.height;
    }
    this.screenTexture.image = picture;
    this.screenTexture.needsUpdate = true;
  }

  /** What the cab's light is now (for tests): the uniforms its shader reads. */
  get light(): Readonly<CabinLightUniforms> {
    return this.uniforms;
  }

  /** The needles' angles now, radians counter-clockwise from the dials' +x: rev counter, speed, air (2), fuel, coolant, oil. */
  get needleAngles(): readonly number[] {
    return this.needleList.map((needle) => needle.angle);
  }

  /** Which of the display's segments are lit: the clock's four figures, then the gear's, 'abcdefg' each; then the colon. */
  get litSegments(): string {
    const color = new Color();
    let lit = '';
    for (let i = 0; i < this.segmentOf.length; i++) {
      this.segments.getColorAt(i, color);
      lit += color.r > 0.5 ? '1' : '0';
    }
    return lit;
  }

  /** The charm's swing, radians to the left and forward. */
  get charmSwing(): { readonly left: number; readonly ahead: number } {
    return { left: this.swingLeft, ahead: this.swingAhead };
  }

  dispose(): void {
    for (const resource of this.resources) {
      resource.dispose();
    }
  }

  private placeNeedles(): void {
    for (let i = 0; i < this.needleList.length; i++) {
      const needle = this.needleList[i]!;
      this.turn.makeRotationZ(needle.angle);
      this.scale.makeScale(needle.length, needle.length, 1);
      this.matrix.copy(needle.base).multiply(this.turn).multiply(this.scale);
      this.needles.setMatrixAt(i, this.matrix);
    }
    this.needles.instanceMatrix.needsUpdate = true;
  }

  /** Lights the clock's figures for `minutes` and the gear's for `gear` (r in reverse, n in neutral). Allocation-free. */
  private showDisplay(minutes: number, gear: number): void {
    // The clock as four figures: hours and minutes, HHMM.
    const clock = (Math.floor(minutes / 60) % 24) * 100 + (Math.floor(minutes) % 60);
    const gearShows = gear < 0 ? REVERSE : gear === 0 ? NEUTRAL : DIGITS[Math.min(9, Math.round(gear))]!;
    for (let i = 0; i < this.segmentOf.length; i++) {
      const { figure, segment } = this.segmentOf[i]!;
      if (figure < 0) {
        continue;
      }
      const shows = figure < 4 ? DIGITS[Math.floor(clock / 10 ** (3 - figure)) % 10]! : gearShows;
      this.segments.setColorAt(i, shows.includes(segment) ? SEGMENT_LIT : SEGMENT_DARK);
    }
    this.showColon();
  }

  private showColon(): void {
    for (let i = 0; i < this.segmentOf.length; i++) {
      if (this.segmentOf[i]!.figure < 0) {
        this.segments.setColorAt(i, this.colonLit ? SEGMENT_LIT : SEGMENT_DARK);
      }
    }
    if (this.segments.instanceColor !== null) {
      this.segments.instanceColor.needsUpdate = true;
    }
  }

  /**
   * The charm swings as a pendulum in the cab: pushed back as the truck
   * speeds up, forward as it brakes, out of turns, and shaken by the road.
   */
  private swing(state: Readonly<VehicleRuntimeState>, deltaSeconds: number): void {
    const dt = Math.min(deltaSeconds, 1 / 30);
    if (dt <= 0) {
      return;
    }
    const stiffness = GRAVITY / CHARM_STRING;
    const shake = CHARM_SHAKE * Math.min(Math.abs(state.speed), 25);
    const leftPush = (this.random.next() - 0.5) * shake;
    const aheadPush = (this.random.next() - 0.5) * shake;
    this.swingLeftRate +=
      (-stiffness * Math.sin(this.swingLeft) - (state.lateralAcceleration / CHARM_STRING) * Math.cos(this.swingLeft) - CHARM_DAMPING * this.swingLeftRate + leftPush) * dt;
    this.swingAheadRate +=
      (-stiffness * Math.sin(this.swingAhead) - (state.longitudinalAcceleration / CHARM_STRING) * Math.cos(this.swingAhead) - CHARM_DAMPING * this.swingAheadRate + aheadPush) * dt;
    this.swingLeft = clamp(this.swingLeft + this.swingLeftRate * dt, -1.2, 1.2);
    this.swingAhead = clamp(this.swingAhead + this.swingAheadRate * dt, -1.2, 1.2);
    // Toward the left is a turn about +z; forward, a negative turn about +x.
    this.charm.rotation.set(-this.swingAhead, 0, this.swingLeft);
  }

  private track<T extends { dispose(): void }>(resource: T): T {
    this.resources.push(resource);
    return resource;
  }
}

/** Paints every vertex of `geometry` `hex`, and maps its uv into `rect` of the atlas (a swatch's middle for a plain colour). */
function dress(geometry: BufferGeometry, hex: number, rect: AtlasRect): BufferGeometry {
  const color = new Color(hex);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  const uv = geometry.getAttribute('uv');
  const swatch = rect.width <= 32;
  for (let i = 0; i < uv.count; i++) {
    // Half a pixel in from the edges, so the neighbouring pictures do not bleed in.
    const u = swatch ? 0.5 : uv.getX(i);
    const v = swatch ? 0.5 : uv.getY(i);
    uv.setXY(i, (rect.x + 0.5 + u * (rect.width - 1)) / CAB_ATLAS_WIDTH, (rect.y + 0.5 + v * (rect.height - 1)) / CAB_ATLAS_HEIGHT);
  }
  return geometry;
}

/** Turns `geometry` by `turn` (if any), then moves it to `at`. */
function place(geometry: BufferGeometry, at: readonly number[], turn?: Euler): BufferGeometry {
  if (turn !== undefined) {
    geometry.applyMatrix4(new Matrix4().makeRotationFromEuler(turn));
  }
  return geometry.translate(at[0] ?? 0, at[1] ?? 0, at[2] ?? 0);
}

/** The turn (YXZ) that faces a panel's front (+z) at `at` toward `target`, its top up. */
function facing(at: Vector3, target: Vector3): Euler {
  const toward = target.clone().sub(at).normalize();
  return new Euler(-Math.asin(toward.y), Math.atan2(toward.x, toward.z), 0, 'YXZ');
}

/**
 * Darkens the cab's inside where less light reaches: low down (the footwells,
 * under the seats) and toward the back wall. Baked into the vertex colours.
 */
function shadeByPlace(geometry: BufferGeometry, floor: number, beltY: number, back: number): void {
  const position = geometry.getAttribute('position');
  const color = geometry.getAttribute('color');
  for (let i = 0; i < position.count; i++) {
    const low = 1 - smoothstep(floor, beltY + 0.15, position.getY(i));
    const rear = 1 - smoothstep(back, back + 0.9, position.getZ(i));
    const f = (1 - 0.5 * low) * (1 - 0.3 * rear);
    color.setXYZ(i, color.getX(i) * f, color.getY(i) * f, color.getZ(i) * f);
  }
}

/** A seat at `x`: its frame, cushion and backrest (fabric in the middle, bolsters either side), headrest and armrest. */
function addSeat(
  add: (geometry: BufferGeometry, color: number, rect?: AtlasRect) => void,
  block: (size: readonly [number, number, number], at: readonly [number, number, number], color: number, turn?: Euler) => void,
  x: number,
  floor: number,
  seatTop: number,
  hipZ: number,
): void {
  const cushionRear = hipZ - 0.15;
  block([0.34, seatTop - 0.12 - floor, 0.4], [x, (seatTop - 0.12 + floor) / 2, cushionRear + 0.24], FRAME);
  block([0.52, 0.12, 0.52], [x, seatTop - 0.06, cushionRear + 0.26], BOLSTER);
  add(place(new PlaneGeometry(0.34, 0.46), [x, seatTop + 0.002, cushionRear + 0.26], new Euler(-Math.PI / 2, 0, 0, 'YXZ')), WHITE, CAB_ATLAS.fabric);
  // The backrest, its fabric and the headrest, leaning back from a hinge at the cushion's rear edge.
  const hinge = new Matrix4().makeRotationFromEuler(new Euler(-degreesToRadians(16), 0, 0)).setPosition(x, seatTop, cushionRear - 0.07);
  add(new BoxGeometry(0.52, 0.68, 0.13).translate(0, 0.36, 0).applyMatrix4(hinge), BOLSTER);
  add(new PlaneGeometry(0.34, 0.6).translate(0, 0.36, 0.068).applyMatrix4(hinge), WHITE, CAB_ATLAS.fabric);
  add(new BoxGeometry(0.28, 0.2, 0.1).translate(0, 0.82, -0.01).applyMatrix4(hinge), BOLSTER);
  block([0.06, 0.05, 0.3], [x - Math.sign(x) * 0.29, seatTop + 0.2, cushionRear + 0.2], BOLSTER);
}

/** The steering wheel, its middle at the origin, the rim in the xy plane, the driver on the −z side. */
function steeringWheelGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const add = (geometry: BufferGeometry, color: number, rect: AtlasRect = CAB_ATLAS.plain): void => {
    parts.push(dress(geometry, color, rect));
  };
  add(new TorusGeometry(WHEEL_RADIUS, RIM_TUBE, 10, 56), RIM);
  // Thicker, softer grips where the hands hold it, at a quarter to three.
  const grip = degreesToRadians(56);
  for (const middle of [0, Math.PI]) {
    add(new TorusGeometry(WHEEL_RADIUS, RIM_TUBE * 1.28, 10, 14, grip).rotateZ(middle - grip / 2), SPOKE);
  }
  // The mark at the top, as on the on-screen wheel: a stripe round the rim.
  const mark = 0.07;
  add(new TorusGeometry(WHEEL_RADIUS, RIM_TUBE * 1.12, 10, 3, mark).rotateZ(Math.PI / 2 - mark / 2), ACCENT);
  // Spokes: left and right a little below level, and a broad one down; buttons on the side spokes.
  for (const side of [1, -1] as const) {
    const angle = side === 1 ? degreesToRadians(-8) : Math.PI + degreesToRadians(8);
    const reach = WHEEL_RADIUS - 0.06;
    add(new BoxGeometry(reach, 0.052, 0.022).translate(0.06 + reach / 2, 0, 0.012).rotateZ(angle), SPOKE);
    for (const along of [0.1, 0.14]) {
      for (const across of [-0.012, 0.012]) {
        add(new BoxGeometry(0.018, 0.016, 0.01).translate(along, across, -0.002).rotateZ(angle), BUTTON);
      }
    }
  }
  add(new BoxGeometry(0.075, WHEEL_RADIUS - 0.05, 0.022).translate(0, -(0.05 + (WHEEL_RADIUS - 0.05) / 2), 0.014), SPOKE);
  // The hub: a round pad with the badge, turned toward the driver.
  add(new CylinderGeometry(0.078, 0.07, 0.05, 24).rotateX(Math.PI / 2).translate(0, 0, 0.012), SPOKE);
  add(new SphereGeometry(0.075, 20, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.32, 1).rotateX(-Math.PI / 2).translate(0, 0, -0.012), RIM);
  add(new CircleGeometry(0.028, 24).rotateY(Math.PI).translate(0, 0, -0.037), WHITE, CAB_ATLAS.emblem);
  const wheel = mergeGeometries(parts);
  for (const part of parts) {
    part.dispose();
  }
  return wheel;
}

/** A needle of unit length along +x from its pivot, a short tail behind, and a dark cap over the pivot. */
function needleGeometry(): BufferGeometry {
  const needle = new PlaneGeometry(1, 1);
  const position = needle.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    // Plane corners: x ±0.5, y ±0.5. The tip narrows; the tail is broad.
    const tip = position.getX(i) > 0;
    position.setXY(i, tip ? 1 : -0.2, Math.sign(position.getY(i)) * (tip ? 0.022 : 0.06));
  }
  const cap = new CircleGeometry(0.12, 16).translate(0, 0, 0.002);
  const parts = [dress(needle, WHITE, CAB_ATLAS.needle), dress(cap, 0x2b2e33, CAB_ATLAS.plain)];
  const geometry = mergeGeometries(parts);
  for (const part of parts) {
    part.dispose();
  }
  return geometry;
}

/** A display segment: a unit square, lit by its instance colour through the atlas's glowing white. */
function segmentGeometry(): BufferGeometry {
  return dress(new PlaneGeometry(1, 1), WHITE, CAB_ATLAS.glow);
}

/** Where a segment of the figure at (px, py) (cluster pixels, its middle; `heightPixels` tall) goes: over the cluster. */
function segmentMatrix(clusterFrame: Matrix4, px: number, py: number, heightPixels: number, segment: string): Matrix4 {
  const m = CLUSTER_METERS_PER_PIXEL;
  const height = heightPixels * m;
  const width = height * 0.5;
  const thick = height * 0.13;
  const x = (px - CAB_ATLAS.cluster.width / 2) * m;
  const y = (py - CAB_ATLAS.cluster.height / 2) * m;
  let dx = 0;
  let dy = 0;
  let across = false;
  let length = width * 0.84;
  switch (segment) {
    case 'a':
      dy = height / 2;
      break;
    case 'g':
      break;
    case 'd':
      dy = -height / 2;
      break;
    case 'b':
    case 'c':
    case 'e':
    case 'f':
      across = true;
      length = height * 0.42;
      dx = segment === 'b' || segment === 'c' ? width / 2 : -width / 2;
      dy = segment === 'b' || segment === 'f' ? height / 4 : -height / 4;
      break;
    default:
      // The colon's dot.
      length = thick;
      break;
  }
  const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), across ? Math.PI / 2 : 0);
  const local = new Matrix4().compose(new Vector3(x + dx, y + dy, 0.003), turn, new Vector3(length, thick, 1));
  return clusterFrame.clone().multiply(local);
}

/** The charm: its cord from the origin down, and two dice hanging from its end, a little apart and turned. */
function charmGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [
    dress(new BoxGeometry(0.003, CHARM_STRING, 0.003).translate(0, -CHARM_STRING / 2, 0), CHARM_STRING_COLOR, CAB_ATLAS.plain),
  ];
  // Each die: where it hangs (x, the cord's length down to it), how it is turned (radians about y and z), and the
  // number on each face: +x, -x, +y, -y, +z, -z (opposite faces make seven).
  const dice = [
    { x: -0.017, drop: 0.012, turn: [0.35, 0.12], faces: [2, 5, 1, 6, 3, 4] },
    { x: 0.017, drop: 0.024, turn: [-0.5, -0.1], faces: [4, 3, 6, 1, 5, 2] },
  ] as const;
  for (const { x, drop, turn, faces } of dice) {
    const middle = -(CHARM_STRING + drop + DIE_SIZE / 2);
    const place = new Matrix4()
      .makeRotationFromEuler(new Euler(0, turn[0], turn[1]))
      .setPosition(x, middle, 0);
    // The cord's end down to the die's top.
    parts.push(
      dress(new BoxGeometry(0.002, drop, 0.002).translate(x, -(CHARM_STRING + drop / 2), 0), CHARM_STRING_COLOR, CAB_ATLAS.plain),
    );
    parts.push(dress(new BoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE).applyMatrix4(place), DIE, CAB_ATLAS.plain));
    faces.forEach((number, face) => {
      for (const [across, up] of PIPS[number]!) {
        parts.push(dress(pipOnFace(face, across * PIP_OFFSET, up * PIP_OFFSET).applyMatrix4(place), PIP, CAB_ATLAS.plain));
      }
    });
  }
  const geometry = mergeGeometries(parts);
  for (const part of parts) {
    part.dispose();
  }
  return geometry;
}

/** A die's pip on face `face` (+x, -x, +y, -y, +z, -z), `across` and `up` from the face's middle, just off it. */
function pipOnFace(face: number, across: number, up: number): BufferGeometry {
  const out = DIE_SIZE / 2 + 0.0004;
  const pip = new CircleGeometry(PIP_RADIUS, 8);
  switch (face) {
    case 0:
      return pip.rotateY(Math.PI / 2).translate(out, up, across);
    case 1:
      return pip.rotateY(-Math.PI / 2).translate(-out, up, across);
    case 2:
      return pip.rotateX(-Math.PI / 2).translate(across, out, up);
    case 3:
      return pip.rotateX(Math.PI / 2).translate(across, -out, up);
    case 4:
      return pip.translate(across, up, out);
    default:
      return pip.rotateY(Math.PI).translate(across, up, -out);
  }
}

/**
 * What the side mirrors show, painted: the sky (its colours, as the weather
 * and the time of day set them) over the road running away behind, with the
 * middle line's dashes (left) or the edge line (right) streaming off as the
 * truck drives (`travel`), the verge beyond, and the truck's own side in
 * `body` colour along the inner edge. Not a second view of the scene: cheap.
 */
function mirrorPicture(sky: SkyUniforms | undefined, body: number, travel: { value: number }): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      zenith: sky?.zenith ?? { value: new Color(0x3f7fc7) },
      horizon: sky?.horizon ?? { value: new Color(0xc4dcef) },
      body: { value: new Color(body) },
      travel,
    },
    vertexShader: /* glsl */ `
      attribute float outward;
      varying vec2 vUv;
      varying float vOutward;
      void main() {
        vUv = uv;
        vOutward = outward;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      uniform vec3 zenith;
      uniform vec3 horizon;
      uniform vec3 body;
      uniform float travel;
      varying vec2 vUv;
      varying float vOutward;
      const float HORIZON = 0.56;
      void main() {
        // Across the glass from the truck's side (0) outward, and up it.
        float across = vOutward > 0.0 ? 1.0 - vUv.x : vUv.x;
        float up = vUv.y;
        float light = dot(horizon, vec3(0.3, 0.5, 0.2));
        vec3 color;
        if (up > HORIZON) {
          color = mix(horizon, zenith, smoothstep(HORIZON, 1.0, up));
        } else {
          // The road behind in perspective: farther toward the horizon, and across from the truck's side.
          float depth = 0.35 / max(HORIZON - up, 0.003);
          float lateral = (across - 0.2) * depth * 1.6;
          bool left = vOutward > 0.0;
          color = lateral < (left ? 4.4 : 1.4) ? vec3(0.3, 0.31, 0.33) * light : vec3(0.2, 0.3, 0.14) * light;
          float line = left ? 2.8 : 1.2;
          float dash = left ? step(0.5, fract((depth - travel) / ${MIRROR_DASH_REPEAT.toFixed(1)})) : 1.0;
          color = mix(color, vec3(0.9) * light, dash * (1.0 - smoothstep(0.06, 0.12, abs(lateral - line))));
          color = mix(color, horizon, 0.6 * smoothstep(HORIZON - 0.14, HORIZON, up));
        }
        // The truck's side along the inner edge, narrowing away toward the horizon.
        color = mix(color, body * light * (0.65 + 0.35 * up), step(across, mix(0.36, 0.22, up)));
        // A mirror is a little darker than what it shows, darkest at its rim.
        float rim = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
        gl_FragColor = vec4(color * 0.85 * (0.75 + 0.25 * smoothstep(0.0, 0.06, rim)), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}
