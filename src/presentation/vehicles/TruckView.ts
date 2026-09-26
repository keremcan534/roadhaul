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
import { clamp } from '../../core/math/scalar';
import type { UpgradeLook } from '../../data/definitions/UpgradeDefinition';
import type { VehicleDefinition } from '../../data/definitions/VehicleDefinition';
import type { TruckLooks } from '../../domain/vehicles/upgradeBonuses';
import type { VehicleRuntimeState } from '../../domain/vehicles/VehicleRuntimeState';
import type { VehiclePose } from '../../systems/driving/DrivingService';
import type { Rgb } from '../textures/pixelImage';
import { grilleImage, liveryImage, rearDoorsImage, rimImage, softBoxShadowImage } from '../textures/proceduralImages';
import { toTexture } from '../textures/toTexture';
import type { SceneLight, SkyUniforms } from '../world/EnvironmentView';
import type { LampMirror } from '../world/WetReflections';
import { reflectSky, type SkyReflectionOptions } from '../world/skyReflection';
import { CabInterior, type DashboardReadings } from './CabInterior';
import { cabGeometry, type CabGeometry } from './cabGeometry';
import { LampGlows } from './LampGlows';
import {
  archedSkirt,
  archLiner,
  archTrim,
  extrudeAcross,
  flatPolygon,
  ledge,
  loft,
  roundedOutline,
  tyreGeometry,
  type Point2,
} from './truckShapes';
import { Wipers } from './Wipers';

const TIRE_WIDTH = 0.36;
/** The rims' face stands this far in from the tyre's sidewall, and reaches this share of the wheel's radius. */
const RIM_INSET = 0.03;
const RIM_SHARE = 0.72;
/** Sides round a wheel. */
const WHEEL_SEGMENTS = 24;
/**
 * The cab's shell: its front corners rounded this much (meters), its rear
 * ones this much, the roof's edge this much; the apron in front of the front
 * wheels this deep. The wheel arches stand this far off the tyres, their
 * black trim this wide. The sun visor reaches this far over the windscreen,
 * tipped down at the front this much (radians).
 */
const CAB_CORNER_RADIUS = 0.12;
const CAB_REAR_CORNER_RADIUS = 0.05;
const ROOF_BEVEL = 0.07;
const APRON_DEPTH = 0.36;
const ARCH_CLEARANCE = 0.025;
const ARCH_TRIM_WIDTH = 0.08;
const VISOR_DEPTH = 0.18;
const VISOR_TILT = 0.12;
/** A heavy truck's two rear axles stand this far either side of the rear axle the physics uses. */
const TANDEM_HALF_SPACING = 0.68;
/** The exhaust stack behind the cab on the right: its radius, and how far its top stands over the cab roof. */
const STACK_RADIUS = 0.075;
const STACK_OVER_ROOF = 0.42;
/** Colours of the flatbed's load: pallets, bricks and ratchet straps. */
const PALLET_COLOR = 0x9c7a4f;
const BRICK_COLOR = 0xa94f35;
const STRAP_COLOR = 0xffa21c;

/**
 * Body lean per m/s² of acceleration (radians), capped: about 3° in the
 * hardest turn, 2½° braking hard. The body rocks on its springs toward it,
 * this stiff (rad/s) and damped (a share of critical), so a stop nods it
 * once and it settles; stepped this often, whatever the frame rate.
 */
const PITCH_PER_ACCELERATION = 0.006;
const ROLL_PER_ACCELERATION = 0.009;
const MAX_LEAN = 0.06;
const BODY_SPRING_RATE = 7;
const BODY_DAMPING = 0.55;
const BODY_STEP_SECONDS = 1 / 60;
const MAX_BODY_CATCH_UP_SECONDS = 0.25;

/** The lamps shine this much brighter at night (setLamps(1)) than by day. */
const LAMP_NIGHT_BOOST = 1.5;
const HEADLIGHT_GLOW = 0xfff1cf;
const TAIL_LIGHT_GLOW = 0xff2a1a;
const GLOW_SIZE_METERS = 1.8;
/** Upgraded parts (TruckViewOptions.looks), by level 0..3: how much taller the stacks stand, meters. */
const STACK_EXTRA_HEIGHT = [0, 0.12, 0.22, 0.34] as const;
/** The fuel tank's length and radius, meters; at level 3 a second one hangs on the other side. */
const TANK_LENGTH = [1.1, 1.4, 1.7, 1.7] as const;
const TANK_RADIUS = [0.28, 0.3, 0.31, 0.31] as const;
/** Brake calipers on the wheels: none, yellow, orange, red (they stand out on the gold rims too). */
const CALIPER_COLORS = [0, 0xffd21f, 0xff7a1a, 0xe0281f] as const;
/** The rims: plain, polished, chrome, gold; `mirror` is how much of the sky they mirror head-on (skyReflection). */
const RIM_FINISHES = [
  { color: 0xffffff, shininess: 90, specular: 0x111111, mirror: 0.12 },
  { color: 0xe4ecf4, shininess: 120, specular: 0x555555, mirror: 0.35 },
  { color: 0xffffff, shininess: 200, specular: 0xffffff, mirror: 0.75 },
  { color: 0xf0c050, shininess: 160, specular: 0xfff0c0, mirror: 0.6 },
] as const;
/** How far the body sits lower on an upgraded suspension, meters. */
const STANCE_DROP = [0, 0.04, 0.07, 0.1] as const;
const CHROME_COLOR = 0xe9eef3;
const MUDFLAP_COLOR = 0x1e2023;

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
  | 'deck'
  | 'chrome'
  | 'mudflap';

/** How a truck is built beyond its model: its paint, and the parts its upgrades show. */
export interface TruckViewOptions {
  /** False leaves the lamps without their glow at night (weaker devices). */
  readonly lampGlows?: boolean;
  /** 0xRRGGBB for the cab and the livery's stripe and doors; the model's factory colour without it. */
  readonly paint?: number;
  /** Each upgraded part at its level (UpgradeDefinition.look); parts left out are as built. */
  readonly looks?: Partial<TruckLooks>;
  /** The truck casts the sun's real-time shadows (the high preset's shadow map). Default: false. */
  readonly castShadows?: boolean;
  /** The sky its paint, glass and chrome mirror (EnvironmentView.sky); without it they mirror nothing. */
  readonly sky?: SkyUniforms;
  /** The scene's light (EnvironmentView.light), which lights the cab's inside; without it, a fixed daylight. */
  readonly light?: SceneLight;
}

/**
 * A cab-over truck built from a VehicleDefinition's body dimensions and body
 * type: original designs, no real-world models. The cab's shell is rounded at
 * the front corners and along the roof (truckShapes), with skirts arched over
 * the front wheels (black trim, lined inside), a sun visor with marker lamps,
 * air horns, the door's seams and handles, steps and a grab handle; at the
 * front a chrome-framed grille under the maker's badge, headlamp clusters
 * (two lenses, a daytime running strip, the indicator) in a black apron, fog
 * lamps in the bumper, and mirrors with a wide-angle one under each. A box
 * body carries the RoadHaul livery on its sides and doors, rails, marker
 * lamps and hinges, behind a roof fairing and extenders; a refrigerated one
 * adds a cooling unit over the cab; a flatbed has a deck, headboard and
 * stakes, and shows its load of bricks while loaded. The chassis carries the
 * fuel tank, the battery box and the air tanks; the tyres have rounded
 * shoulders round rims set into them. Heavy trucks stand on two rear axles.
 * Upgrades show (options.looks): taller
 * chrome stacks, twin at level 2, with a roof light bar at 3; a longer tank,
 * chrome, then a second one; polished, chrome or gold rims; yellow, orange
 * or red brake calipers; and a body sitting lower on mudflaps, with a
 * chrome bumper and grille bars. Parts that share a material are merged, so
 * a truck costs about 17 draw calls (two more at night, when its lamps glow
 * and the headlights light the road: setLamps(); one for the calipers). Its
 * origin is the rear axle, like VehicleRuntimeState. Front wheels steer, all
 * wheels roll, and the body pitches and rolls with acceleration. Its wipers
 * sweep in the rain (setRain). From the driver's seat (setCabinView) the
 * windscreen gives way to the cab's inside (CabInterior: the instruments,
 * the steering wheel, the navigation screen) and the glass as seen from
 * within, with the rain's drops the wipers clear.
 *
 * update() runs every frame and allocates nothing.
 */
export class TruckView {
  private readonly root = new Group();
  private readonly body = new Group();
  private readonly windshield: Mesh;
  /** The cab's inside: only shown from the driver's seat. */
  private readonly cabin = new Group();
  /** Built the first time the cab is shown: most drives never look from inside. */
  private interior: CabInterior | null = null;
  private readonly cabGeometry: CabGeometry;
  private readonly wipers: Wipers;
  private rain = 0;
  /** The colour it is painted in, 0xRRGGBB. */
  readonly paint: number;
  /** The flatbed's visible load; null for closed bodies, whose load is out of sight. */
  private readonly load: Mesh | null = null;
  private readonly wheels: InstancedMesh;
  /** Brake calipers on the wheels' outer faces (a brakes upgrade); they steer but do not spin. */
  private readonly calipers: InstancedMesh | null = null;
  /** Night: brighter lamps and their glows (their light on the world is LampLighting's, from headlamps()). */
  private readonly lampMaterial: MeshBasicMaterial;
  private readonly glows: LampGlows;
  /** In the model: the left headlamp (the right one mirrors it across x = 0). */
  private readonly headlampAt: readonly [number, number, number];
  /** Where the left tail light shines from, on the body (the right one mirrors it): for a wet road to mirror. */
  private readonly taillampAt: readonly [number, number, number];
  /** The box that stands in the way of other lamps' light (mirrorLamps, bodyBox): its middle along the truck, half its length and width, its height. */
  private readonly shadeBox: readonly [number, number, number, number];
  /** Scratch for mirrorLamps(). */
  private readonly lampAt = new Vector3();
  private lamps = 0;
  private readonly resources: { dispose(): void }[] = [];
  private readonly wheelPositions: readonly (readonly [number, number, number])[];
  /** In the model: the exhaust stack's outlet, and just behind the last rear wheel on the left (+x) side. */
  private readonly exhaustAt: readonly [number, number, number];
  private readonly behindRearWheelAt: readonly [number, number, number];
  private wheelSpin = 0;
  private pitch = 0;
  private roll = 0;
  private pitchRate = 0;
  private rollRate = 0;
  // Scratch objects reused every frame.
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly euler = new Euler(0, 0, 0, 'YXZ');
  private readonly unitScale = new Vector3(1, 1, 1);

  /** What it was built from: equal keys make identical trucks (the entry point rebuilds a truck when its key changes). */
  readonly key: string;

  constructor(
    private readonly scene: Scene,
    readonly definition: VehicleDefinition,
    private readonly options: TruckViewOptions = {},
  ) {
    const { lengthMeters: L, widthMeters: W, heightMeters: H, wheelbaseMeters: B, wheelRadiusMeters: R } = definition.body;
    const paint = options.paint ?? definition.factoryColor;
    this.paint = paint;
    this.key = truckViewKey(definition, options);
    const level = (look: UpgradeLook): 0 | 1 | 2 | 3 => lookLevel(options.looks?.[look]);
    const exhaust = level('exhaust');
    const tank = level('fuelTank');
    const stance = level('stance');
    // Heights: the box floor clears the wheels; the cab sits on top of the front axle (cab-over). The cameras
    // share these (cabGeometry): the driver's eye sits behind the steering wheel, the hood camera on the roof.
    const cab = cabGeometry(definition.body);
    this.cabGeometry = cab;
    const { centreZ, frontZ, rearZ, deckY, cabTop, beltY, cabLength } = cab;
    const frameY = 2 * R - 0.12;
    const cabBottom = 2 * R + 0.04;
    const bumperTop = R + 0.16;
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

    // The cab: its shell rounded at the front corners and along the roof's edge. The lower part is open at the
    // top (its lid would be the cab's floor, seen from the driver's seat): a ledge round the glasshouse's foot
    // stands for it outside. Below it the apron in front of the front wheels, and skirts down the sides with
    // an arch over each front wheel.
    const lowerOutline = roundedOutline(halfW, cabRear, frontZ, CAB_CORNER_RADIUS, CAB_REAR_CORNER_RADIUS);
    add('paint', loft([{ outline: lowerOutline, y: cabBottom }, { outline: lowerOutline, y: beltY }]));
    add('dark', flatPolygon(lowerOutline, cabBottom, -1));
    const glassHalf = halfW - 0.03;
    const glassFront = frontZ - 0.05;
    const glasshouse = (inset: number): Point2[] =>
      roundedOutline(
        glassHalf - inset,
        cabRear + 0.05 + inset,
        glassFront - inset,
        Math.max(0.02, CAB_CORNER_RADIUS - inset),
        Math.max(0.01, CAB_REAR_CORNER_RADIUS - inset),
      );
    add('paint', ledge(lowerOutline, glasshouse(0), beltY));
    add(
      'paint',
      loft(
        [
          { outline: glasshouse(0), y: beltY },
          { outline: glasshouse(0), y: cabTop - ROOF_BEVEL - 0.04 },
          { outline: glasshouse(ROOF_BEVEL * 0.45), y: cabTop - ROOF_BEVEL * 0.3 },
          { outline: glasshouse(ROOF_BEVEL), y: cabTop },
        ],
        { top: true },
      ),
    );
    // The apron round the headlamps is black, like the bumper under it.
    const apronOutline = roundedOutline(halfW, frontZ - APRON_DEPTH, frontZ, CAB_CORNER_RADIUS, 0.01);
    add('dark', loft([{ outline: apronOutline, y: bumperTop - 0.01 }, { outline: apronOutline, y: cabBottom + 0.01 }]));
    const archRadius = R + ARCH_CLEARANCE;
    for (const side of [1, -1] as const) {
      add('paint', archedSkirt(side, halfW, cabRear + CAB_REAR_CORNER_RADIUS, frontZ - APRON_DEPTH, R, cabBottom, B, archRadius));
      // A black trim round the arch, and its lining over the wheel.
      add('dark', archTrim(side, halfW + 0.015, B, R, archRadius, archRadius + ARCH_TRIM_WIDTH));
      add('dark', archLiner(side * (halfW - 0.45), side * (halfW + 0.015), B, R, archRadius));
    }
    // The door, round the side window: its seams, a handle at the back and a grab handle behind it; two steps
    // up to it ahead of the front wheel.
    const doorFront = frontZ - 0.2;
    const doorRear = doorFront - Math.min(1.25, cabLength * 0.62);
    for (const side of [1, -1] as const) {
      const seam = (x: number, y0: number, height: number, z0: number, length: number): void =>
        add('dark', sideQuad(side, side * x, y0, height, z0, length));
      for (const z of [doorFront, doorRear]) {
        seam(halfW + 0.002, cabBottom + 0.03, beltY - cabBottom - 0.03, z - 0.009, 0.018);
        seam(glassHalf + 0.002, beltY, cabTop - 0.1 - beltY, z - 0.009, 0.018);
      }
      seam(halfW + 0.002, cabBottom + 0.03, 0.018, doorRear, doorFront - doorRear);
      seam(glassHalf + 0.002, cabTop - 0.118, 0.018, doorRear, doorFront - doorRear);
      box('chrome', [0.025, 0.045, 0.2], [side * (halfW + 0.012), beltY - 0.13, doorRear + 0.16]);
      add(
        'chrome',
        new CylinderGeometry(0.018, 0.018, 0.8, 8).translate(side * (halfW + 0.04), beltY + 0.05, doorRear - 0.07),
      );
      const stepsFront = frontZ - APRON_DEPTH - 0.04;
      const stepsRear = B + archRadius + ARCH_TRIM_WIDTH + 0.04;
      if (stepsFront - stepsRear > 0.3) {
        for (const y of [R + 0.1, (R + 0.1 + cabBottom) / 2]) {
          box('metal', [0.07, 0.035, stepsFront - stepsRear], [side * (halfW + 0.02), y, (stepsFront + stepsRear) / 2]);
        }
      }
    }
    // Over the windscreen a sun visor with the cab's marker lamps along it.
    add(
      'paint',
      new BoxGeometry(W - 0.34, 0.035, VISOR_DEPTH)
        .rotateX(VISOR_TILT)
        .translate(0, cabTop - 0.03, glassFront + VISOR_DEPTH / 2 - 0.01),
    );
    for (let i = 0; i < 5; i++) {
      lamp(0xffa21c, [0.09, 0.028, 0.02], [(i - 2) * (W - 0.6) * 0.2, cabTop - 0.06, glassFront + VISOR_DEPTH - 0.02]);
    }
    // A pair of chrome air horns on the roof behind it.
    for (const side of [1, -1] as const) {
      add(
        'chrome',
        new CylinderGeometry(0.045, 0.02, 0.3, 10).rotateX(Math.PI / 2).translate(side * 0.85, cabTop + 0.05, glassFront - 0.3),
      );
    }
    // On the roof: a fairing up to the box and extenders across the gap to it, the cooling unit of a refrigerated
    // body, or a flatbed's beacons.
    if (bodyType === 'box') {
      const fairingFront = cabRear + cabLength * 0.72;
      const rise = H - 0.06 - cabTop;
      const profile: Point2[] = [[fairingFront, cabTop]];
      for (let i = 1; i <= 6; i++) {
        const t = i / 6;
        profile.push([fairingFront - t * (fairingFront - cabRear), cabTop + rise * (1 - (1 - t) ** 2)]);
      }
      profile.push([cabRear, cabTop]);
      add('paint', extrudeAcross(profile, halfW - 0.08));
      for (const side of [1, -1] as const) {
        box('paint', [0.02, H - 0.1 - beltY, 0.37], [side * (halfW - 0.01), (beltY + H - 0.1) / 2, cabRear + 0.075]);
      }
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
    if (exhaust === 3) {
      // A light bar along the front of the roof.
      box('dark', [W * 0.62, 0.08, 0.16], [0, cabTop + 0.04, frontZ - 0.2]);
      for (let i = 0; i < 4; i++) {
        lamp(0xffb42e, [0.18, 0.1, 0.06], [(i - 1.5) * W * 0.15, cabTop + 0.11, frontZ - 0.13]);
      }
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
    // Front: the grille in a chrome surround under the maker's badge, the bumper with its fog lamps, the headlamp
    // clusters (two lenses over a daytime running strip, the indicator at the outer end, a repeater on the side),
    // and the mirrors, a wide-angle one under each.
    const grilleBottom = bumperTop + 0.35;
    const grilleTop = beltY - 0.2;
    const grilleWidth = W * 0.6;
    add('grille', frontQuad(grilleWidth, grilleTop - grilleBottom, frontZ + 0.012, grilleBottom));
    for (const y of [grilleBottom, grilleTop]) {
      box('chrome', [grilleWidth + 0.06, 0.03, 0.025], [0, y, frontZ + 0.016]);
    }
    for (const side of [1, -1] as const) {
      box('chrome', [0.03, grilleTop - grilleBottom + 0.03, 0.025], [side * (grilleWidth / 2 + 0.015), (grilleBottom + grilleTop) / 2, frontZ + 0.016]);
    }
    add('chrome', new BoxGeometry(0.12, 0.12, 0.02).rotateZ(Math.PI / 4).translate(0, grilleTop + 0.1, frontZ + 0.012));
    box(stance >= 2 ? 'chrome' : 'dark', [W + 0.06, 0.32, 0.24], [0, bumperTop - 0.16, frontZ + 0.02]);
    box('dark', [W - 0.1, 0.06, 0.2], [0, bumperTop - 0.34, frontZ + 0.01]);
    if (stance === 3) {
      // Chrome bars across the grille.
      for (let i = 1; i <= 3; i++) {
        box('chrome', [grilleWidth + 0.02, 0.035, 0.04], [0, grilleBottom + ((grilleTop - grilleBottom) * i) / 4, frontZ + 0.03]);
      }
    }
    const lampY = bumperTop + 0.2;
    for (const side of [1, -1] as const) {
      box('dark', [0.52, 0.24, 0.04], [side * (halfW - 0.34), lampY, frontZ + 0.006]);
      lamp(0xfff4d6, [0.2, 0.15, 0.02], [side * (halfW - 0.3), lampY + 0.02, frontZ + 0.032]);
      lamp(0xfff8e8, [0.16, 0.13, 0.02], [side * (halfW - 0.5), lampY + 0.02, frontZ + 0.032]);
      lamp(0xffffff, [0.38, 0.022, 0.02], [side * (halfW - 0.39), lampY - 0.085, frontZ + 0.034]);
      lamp(0xffa21c, [0.09, 0.15, 0.02], [side * (halfW - 0.14), lampY + 0.02, frontZ + 0.03]);
      lamp(0xffa21c, [0.02, 0.05, 0.12], [side * (halfW + 0.01), lampY + 0.04, frontZ - 0.24]);
      lamp(0xfff8e0, [0.16, 0.07, 0.008], [side * (halfW - 0.36), bumperTop - 0.19, frontZ + 0.143]);
      // Mirror on arms near the front pillar, its glass facing back (the driver sees it from the cab).
      const { mirror } = cab;
      box('dark', [0.36, 0.04, 0.04], [side * (halfW + 0.16), mirror.y + 0.2, mirror.z + 0.036]);
      box('dark', [0.2, 0.36, 0.07], [side * mirror.x, mirror.y, mirror.z + 0.036]);
      add('glass', new PlaneGeometry(mirror.width, mirror.height).rotateY(Math.PI).translate(side * mirror.x, mirror.y, mirror.z));
      box('dark', [0.3, 0.03, 0.03], [side * (halfW + 0.15), mirror.y - 0.3, mirror.z + 0.03]);
      box('dark', [0.16, 0.14, 0.06], [side * mirror.x, mirror.y - 0.3, mirror.z + 0.031]);
      add('glass', new PlaneGeometry(0.12, 0.1).rotateY(Math.PI).translate(side * mirror.x, mirror.y - 0.3, mirror.z));
    }

    // Chassis, fuel tank, battery box, rear mudguards, underrun bar and light bar.
    box('dark', [W * 0.7, 0.24, L * 0.9], [0, frameY, centreZ]);
    // The fuel tank on the left; at level 3 a second one takes the battery box's place on the right.
    const tankRadius = TANK_RADIUS[tank];
    const fuelTank = (side: 1 | -1): BufferGeometry =>
      new CylinderGeometry(tankRadius, tankRadius, TANK_LENGTH[tank], 16)
        .rotateX(Math.PI / 2)
        .translate(side * (halfW - 0.04 - tankRadius), frameY - 0.05, B * 0.45);
    add(tank >= 2 ? 'chrome' : 'metal', fuelTank(1));
    if (tank === 3) {
      add('chrome', fuelTank(-1));
    } else {
      box('dark', [0.5, 0.45, 0.7], [-(halfW - 0.3), frameY - 0.08, B * 0.45]);
    }
    // The brakes' air tanks between the rear wheels and the fuel tank, where there is room.
    const airTanksFrom = (tandem ? TANDEM_HALF_SPACING : 0) + R + 0.12;
    const airTanksTo = B * 0.45 - TANK_LENGTH[tank] / 2 - 0.08;
    if (airTanksTo - airTanksFrom > 0.5) {
      for (const side of [1, -1] as const) {
        add(
          'metal',
          new CylinderGeometry(0.12, 0.12, airTanksTo - airTanksFrom, 12)
            .rotateX(Math.PI / 2)
            .translate(side * (halfW - 0.36), frameY - 0.04, (airTanksFrom + airTanksTo) / 2),
        );
      }
    }
    // The exhaust stack stands at the cab's rear corner on the right (behind the front wheel's arch), up past the
    // roof: chrome and taller on an upgraded engine, and from level 2 a twin on the left.
    const stackTop = cabTop + STACK_OVER_ROOF + STACK_EXTRA_HEIGHT[exhaust];
    const stackRadius = STACK_RADIUS + (exhaust === 3 ? 0.02 : exhaust > 0 ? 0.01 : 0);
    const stackX = -(halfW + stackRadius + 0.02);
    const stackZ = Math.min(cabRear + 0.15, B - archRadius - ARCH_TRIM_WIDTH - stackRadius - 0.03);
    for (const side of exhaust >= 2 ? ([1, -1] as const) : ([-1] as const)) {
      add(
        exhaust > 0 ? 'chrome' : 'metal',
        new CylinderGeometry(stackRadius, stackRadius, stackTop - frameY, 10).translate(
          -side * stackX,
          (stackTop + frameY) / 2,
          stackZ,
        ),
      );
    }
    const drop = STANCE_DROP[stance];
    this.exhaustAt = [stackX, stackTop + 0.05 - drop, stackZ];
    const guardLength = 2 * R + 0.3 + (tandem ? 2 * TANDEM_HALF_SPACING : 0);
    for (const side of [1, -1] as const) {
      box('dark', [TIRE_WIDTH + 0.08, 0.05, guardLength], [side * (halfW - 0.2), 2 * R + 0.05, 0]);
    }
    if (stance > 0) {
      // Mudflaps behind the rear wheels, a stripe in the truck's colour near their foot.
      const flapZ = -(tandem ? TANDEM_HALF_SPACING : 0) - R - 0.12;
      for (const side of [1, -1] as const) {
        add('mudflap', new BoxGeometry(TIRE_WIDTH + 0.12, 2 * R - 0.16, 0.03).translate(side * (halfW - 0.2), R + 0.1, flapZ));
        box('paint', [TIRE_WIDTH + 0.13, 0.07, 0.035], [side * (halfW - 0.2), 0.32, flapZ]);
      }
    }
    box('dark', [W - 0.3, 0.12, 0.1], [0, R + 0.02, rearZ + 0.08]);
    box('dark', [W, 0.2, 0.08], [0, R + 0.26, rearZ + 0.02]);
    for (const side of [1, -1] as const) {
      lamp(0xd4261c, [0.34, 0.14, 0.05], [side * (halfW - 0.3), R + 0.26, rearZ - 0.03]);
      lamp(0xf2f2f2, [0.12, 0.1, 0.05], [side * (halfW - 0.56), R + 0.26, rearZ - 0.03]);
      lamp(0xffa21c, [0.12, 0.1, 0.05], [side * (halfW - 0.08), R + 0.26, rearZ - 0.03]);
    }

    const bodyLength = boxFront - rearZ;
    /** Amber marker lamps along the foot of the body on both sides, about every 1.8 m, at `x` either side and `y`. */
    const sideMarkers = (x: number, y: number): void => {
      const count = Math.max(2, Math.round(bodyLength / 1.8));
      for (const side of [1, -1] as const) {
        for (let i = 0; i < count; i++) {
          lamp(0xffa21c, [0.02, 0.05, 0.1], [side * x, y, rearZ + 0.3 + (i * (bodyLength - 0.6)) / (count - 1)]);
        }
      }
    };
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
      sideMarkers(halfW + 0.01, deckY - 0.1);
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
      // Rails along the top and the foot of each side, marker lamps along the foot and up at the back, and the
      // doors' hinges.
      for (const side of [1, -1] as const) {
        box('metal', [0.03, 0.07, bodyLength], [side * (halfW + 0.035), H - 0.035, rearZ + bodyLength / 2]);
        box('dark', [0.04, 0.12, bodyLength], [side * (halfW + 0.03), deckY + 0.06, rearZ + bodyLength / 2]);
        lamp(0xd4261c, [0.1, 0.05, 0.02], [side * (halfW - 0.12), H - 0.08, rearZ - 0.03]);
        for (let i = 0; i < 4; i++) {
          box('dark', [0.06, 0.1, 0.025], [side * (halfW - 0.04), deckY + 0.25 + (i * (boxHeight - 0.5)) / 3, rearZ - 0.025]);
        }
      }
      sideMarkers(halfW + 0.055, deckY + 0.06);
    }

    const accentRgb: Rgb = [(paint >> 16) & 255, (paint >> 8) & 255, paint & 255];
    this.lampMaterial = this.track(new MeshBasicMaterial({ vertexColors: true }));
    // Glossy paint and glass mirror the sky the flatter they are seen; chrome and metal mirror it in their colour.
    const shiny = (material: MeshPhongMaterial, reflection: SkyReflectionOptions): MeshPhongMaterial =>
      options.sky === undefined ? material : reflectSky(material, options.sky, reflection);
    const materials: Readonly<Record<PartMaterial, Material>> = {
      paint: this.track(shiny(new MeshPhongMaterial({ color: paint, shininess: 80, specular: 0x404040 }), { facing: 0.05 })),
      dark: this.track(new MeshLambertMaterial({ color: 0x2b2e33 })),
      metal: this.track(
        shiny(new MeshPhongMaterial({ color: 0xa9b0b8, shininess: 100, specular: 0xdddddd }), { facing: 0.5, metal: true }),
      ),
      glass: this.track(shiny(new MeshPhongMaterial({ color: 0x22323f, shininess: 140, specular: 0x9aa7b3 }), { facing: 0.14 })),
      lamps: this.lampMaterial,
      grille: this.track(new MeshLambertMaterial({ map: this.texture(toTexture(grilleImage())) })),
      panels: this.track(
        shiny(new MeshPhongMaterial({ color: 0xf2f2ee, shininess: 25, specular: 0x222222 }), { facing: 0.03, strength: 0.5 }),
      ),
      livery: this.track(
        shiny(
          new MeshPhongMaterial({ map: this.texture(toTexture(liveryImage(accentRgb))), shininess: 25, specular: 0x222222 }),
          { facing: 0.03, strength: 0.5 },
        ),
      ),
      doors: this.track(
        shiny(
          new MeshPhongMaterial({ map: this.texture(toTexture(rearDoorsImage(accentRgb))), shininess: 25, specular: 0x222222 }),
          { facing: 0.03, strength: 0.5 },
        ),
      ),
      deck: this.track(new MeshLambertMaterial({ color: 0x6e5238 })),
      chrome: this.track(
        shiny(new MeshPhongMaterial({ color: CHROME_COLOR, shininess: 160, specular: 0xffffff }), { facing: 0.85, metal: true }),
      ),
      mudflap: this.track(new MeshLambertMaterial({ color: MUDFLAP_COLOR })),
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

    // The wipers on the windscreen, and the glass as the driver sees it from inside (only in the cabin view).
    this.wipers = new Wipers(
      { width: W - 0.2, bottom: beltY + (cabTop - beltY) * 0.1, top: beltY + (cabTop - beltY) * 0.9, z: frontZ - 0.038 },
      options.sky?.horizon ?? { value: new Color(0xc4dcef) },
    );
    this.track(this.wipers);
    this.wipers.glass.visible = false;
    this.body.add(this.wipers.blades, this.wipers.glass);
    this.cabin.visible = false;

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
    this.behindRearWheelAt = [trackHalf, R * 0.5, Math.min(...rearAxles) - R * 1.05];
    this.wheelPositions = [
      [trackHalf, R, B],
      [-trackHalf, R, B],
      ...rearAxles.flatMap((z) => [
        [trackHalf, R, z] as const,
        [-trackHalf, R, z] as const,
      ]),
    ];
    this.wheels = this.createWheels(R, this.wheelPositions.length, level('wheels'));
    const brakes = level('brakes');
    if (brakes > 0) {
      this.calipers = this.createCalipers(R, this.wheelPositions.length, CALIPER_COLORS[brakes]);
    }
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

    // At night: a glow on each headlight and tail light (they lean with the body, and show only from in front of
    // them), and light on the road ahead.
    const headlightX = halfW - 0.32;
    this.glows = this.track(new LampGlows(4, GLOW_SIZE_METERS));
    for (const side of [1, -1] as const) {
      const index = side === 1 ? 0 : 1;
      this.glows.setPosition(index, side * headlightX, bumperTop + 0.2, frontZ + 0.12);
      this.glows.setColor(index, HEADLIGHT_GLOW);
      this.glows.setFacing(index, 0, 0, 1);
      this.glows.setPosition(index + 2, side * (halfW - 0.3), R + 0.26, rearZ - 0.12);
      this.glows.setColor(index + 2, TAIL_LIGHT_GLOW);
      this.glows.setFacing(index + 2, 0, 0, -1);
    }
    this.glows.setCount(4);
    this.body.add(this.glows.points);
    // Where the headlights light the world from (LampLighting): on the body, as low as the suspension sets it.
    this.headlampAt = [headlightX, bumperTop + 0.2 - drop, frontZ + 0.12];
    this.taillampAt = [halfW - 0.3, R + 0.26 - drop, rearZ - 0.12];
    this.shadeBox = [(frontZ + rearZ) / 2, (frontZ - rearZ) / 2, halfW, H];

    // An upgraded suspension sets the body lower over its wheels.
    this.body.position.y = -drop;
    this.cabin.position.y = -drop;
    this.body.name = 'truck-body';
    this.root.add(shadow, this.body, this.cabin, this.wheels);
    if (this.calipers !== null) {
      this.root.add(this.calipers);
    }
    if (options.castShadows === true) {
      // The truck itself, not its soft shadow, the light on the road, the glows, the glass seen from inside or the
      // cab's inside (which shades nothing outside).
      for (const part of [this.body, this.wheels]) {
        part.traverse((object) => {
          if (object instanceof Mesh && object !== this.wipers.glass) {
            object.castShadow = true;
          }
        });
      }
    }
    scene.add(this.root);
  }

  /** Places the truck at `pose` (interpolated between fixed steps) and animates wheels and body lean. */
  update(pose: Readonly<VehiclePose>, state: Readonly<VehicleRuntimeState>, deltaSeconds: number): void {
    this.root.position.set(pose.x, 0, pose.z);
    this.root.rotation.y = pose.heading;

    this.wheelSpin += (state.speed * deltaSeconds) / this.definition.body.wheelRadiusMeters;
    this.updateWheels(state.steerAngle);
    this.wipers.update(deltaSeconds, this.rain);

    // Nose dips when braking and lifts when accelerating; the body leans out of turns, rocking on its springs.
    // From the driver's seat it keeps still round the cab's inside and the eye, which do not lean (the head
    // sways instead: CameraRig).
    this.rockBody(
      clamp(-state.longitudinalAcceleration * PITCH_PER_ACCELERATION, -MAX_LEAN, MAX_LEAN),
      clamp(state.lateralAcceleration * ROLL_PER_ACCELERATION, -MAX_LEAN, MAX_LEAN),
      deltaSeconds,
    );
    if (this.interior !== null && this.cabin.visible) {
      this.body.rotation.set(0, 0, 0);
      this.interior.update(state, deltaSeconds, pose.heading, this.options.light);
    } else {
      this.body.rotation.set(this.pitch, 0, this.roll);
    }
  }

  /** Moves the body's pitch and roll toward the lean the truck's motion asks for, as a damped spring. Allocation-free. */
  private rockBody(targetPitch: number, targetRoll: number, deltaSeconds: number): void {
    const stiffness = BODY_SPRING_RATE * BODY_SPRING_RATE;
    const damping = 2 * BODY_DAMPING * BODY_SPRING_RATE;
    let remaining = Math.min(Math.max(deltaSeconds, 0), MAX_BODY_CATCH_UP_SECONDS);
    while (remaining > 1e-6) {
      const step = Math.min(remaining, BODY_STEP_SECONDS);
      this.pitchRate += (stiffness * (targetPitch - this.pitch) - damping * this.pitchRate) * step;
      this.rollRate += (stiffness * (targetRoll - this.roll) - damping * this.rollRate) * step;
      this.pitch = clamp(this.pitch + this.pitchRate * step, -MAX_LEAN, MAX_LEAN);
      this.roll = clamp(this.roll + this.rollRate * step, -MAX_LEAN, MAX_LEAN);
      remaining -= step;
    }
  }

  /** How hard it rains, 0..1 (the weather's): the wipers sweep, pausing in light rain. Cheap every frame. */
  setRain(level: number): void {
    this.rain = level;
  }

  /** What the cab's instruments show beyond the truck's motion: the fuel, the time, the pedals. Cheap every frame. */
  setDashboard(readings: DashboardReadings): void {
    this.interior?.setDashboard(readings);
  }

  /** The navigation screen in the cab shows `picture` (the minimap's canvas), uploaded when `version` changes. */
  setNavigation(picture: { readonly width: number; readonly height: number }, version: number): void {
    if (this.cabin.visible) {
      this.interior?.setNavigation(picture, version);
    }
  }

  /** Where the exhaust stack's outlet is in the world, as of the last update(). Writes into `out`. */
  exhaustOutlet(out: Vector3): Vector3 {
    const [x, y, z] = this.exhaustAt;
    return this.toWorld(x, y, z, out);
  }

  /**
   * Just behind the last rear wheel on `side` (1: left, -1: right), low down,
   * in the world as of the last update(): where it throws dust and spray.
   * Writes into `out`.
   */
  behindRearWheel(side: 1 | -1, out: Vector3): Vector3 {
    const [x, y, z] = this.behindRearWheelAt;
    return this.toWorld(x * side, y, z, out);
  }

  /** Shows or hides a flatbed's load. Closed bodies keep their load out of sight. */
  setLoaded(loaded: boolean): void {
    if (this.load !== null) {
      this.load.visible = loaded;
    }
  }

  /**
   * How brightly the lamps shine, 0..1 (the weather: 0 by day, 1 at night):
   * brighter lamps and a glow round them. Their light on the world is
   * LampLighting's, from headlamps(). Cheap to call every frame.
   */
  setLamps(level: number): void {
    if (level === this.lamps) {
      return;
    }
    this.lamps = level;
    this.lampMaterial.color.setScalar(1 + level * LAMP_NIGHT_BOOST);
    this.interior?.setLamps(level);
    this.glows.setLevel(this.options.lampGlows === false ? 0 : level);
  }

  /**
   * Where the headlamps are in the world, left and right, and the way the
   * truck faces (level), as of the last update(): what lights the road ahead.
   * Writes into the arguments; allocation-free.
   */
  headlamps(left: Vector3, right: Vector3, forward: Vector3): void {
    const [x, y, z] = this.headlampAt;
    this.toWorld(x, y, z, left);
    this.toWorld(-x, y, z, right);
    const heading = this.root.rotation.y;
    forward.set(Math.sin(heading), 0, Math.cos(heading));
  }

  /**
   * The box the truck's body fills in the world as of the last update(): its
   * middle, the way it faces (level) and half its size across, up and along
   * it; what keeps other vehicles' headlights off the road ahead of it
   * (LampLighting). Writes into the arguments; allocation-free.
   */
  bodyBox(middle: Vector3, forward: Vector3, halfSize: Vector3): void {
    const [centre, halfLength, halfWidth, height] = this.shadeBox;
    this.toWorld(0, height / 2, centre, middle);
    const heading = this.root.rotation.y;
    forward.set(Math.sin(heading), 0, Math.cos(heading));
    halfSize.set(halfWidth, height / 2, halfLength);
  }

  /**
   * The lamps a wet road mirrors (WetReflections): the headlights facing
   * ahead and the tail lights facing back, where they are in the world as
   * of the last update(); and the truck in the way of the other lamps'
   * light to the road behind it. Allocation-free.
   */
  mirrorLamps(into: LampMirror): void {
    const heading = this.root.rotation.y;
    const forwardX = Math.sin(heading);
    const forwardZ = Math.cos(heading);
    const [headX, headY, headZ] = this.headlampAt;
    const [tailX, tailY, tailZ] = this.taillampAt;
    const [middle, halfLength, halfWidth, height] = this.shadeBox;
    const at = this.lampAt;
    this.toWorld(0, 0, middle, at);
    into.shade(at.x, at.z, heading, halfLength, halfWidth, height);
    for (let side = 1; side >= -1; side -= 2) {
      this.toWorld(side * headX, headY, headZ, at);
      into.add('head', at.x, at.y, at.z, forwardX, forwardZ);
      this.toWorld(side * tailX, tailY, tailZ, at);
      into.add('tail', at.x, at.y, at.z, -forwardX, -forwardZ);
    }
  }

  /** From the driver's seat the windshield would block the view: swap it for the cab's inside and the glass seen from within. */
  setCabinView(enabled: boolean): void {
    if (enabled && this.interior === null) {
      // The cab's inside, seen only from the driver's seat (cabGeometry's eye). It does not lean with the body:
      // neither does the driver's eye, and it would bob up and down the screen.
      const sky = this.options.sky;
      this.interior = this.track(new CabInterior(this.definition, this.cabGeometry, sky === undefined ? {} : { sky }));
      this.interior.setLamps(this.lamps);
      this.cabin.add(this.interior.root);
    }
    this.windshield.visible = !enabled;
    this.cabin.visible = enabled;
    this.wipers.glass.visible = enabled;
  }

  dispose(): void {
    this.scene.remove(this.root);
    for (const resource of this.resources) {
      resource.dispose();
    }
  }

  /**
   * Tyres with rounded shoulders, a rim set into each face in the finish of
   * the tyres upgrade's `level`: two draw calls for all the wheels.
   */
  private createWheels(radius: number, count: number, level: 0 | 1 | 2 | 3): InstancedMesh {
    const rimRadius = radius * RIM_SHARE;
    const tire = tyreGeometry(radius, TIRE_WIDTH, rimRadius, RIM_INSET, WHEEL_SEGMENTS);
    // The rims reach under the tyre's inner lip, so no gap shows between them.
    const face = TIRE_WIDTH / 2 - RIM_INSET;
    const outer = new CircleGeometry(rimRadius, WHEEL_SEGMENTS).rotateY(Math.PI / 2).translate(face, 0, 0);
    const inner = new CircleGeometry(rimRadius, WHEEL_SEGMENTS).rotateY(-Math.PI / 2).translate(-face, 0, 0);
    const wheel = mergeGeometries([tire, outer, inner], true);
    for (const part of [tire, outer, inner]) {
      part.dispose();
    }
    const finish = RIM_FINISHES[level];
    const rim = this.track(
      new MeshPhongMaterial({
        map: this.texture(toTexture(rimImage())),
        color: finish.color,
        shininess: finish.shininess,
        specular: finish.specular,
      }),
    );
    if (this.options.sky !== undefined) {
      reflectSky(rim, this.options.sky, { facing: finish.mirror, metal: true });
    }
    return this.track(
      new InstancedMesh(this.track(wheel), [this.track(new MeshLambertMaterial({ color: 0x1d1d1f })), rim, rim], count),
    );
  }

  /** A caliper on each wheel's outer face, over the rim's upper rear: one draw call for them all. */
  private createCalipers(radius: number, count: number, color: number): InstancedMesh {
    const caliper = new BoxGeometry(0.03, radius * 0.34, radius * 0.5).translate(0, radius * 0.36, -radius * 0.22);
    const material = new MeshPhongMaterial({ color, shininess: 70 });
    if (this.options.sky !== undefined) {
      reflectSky(material, this.options.sky, { facing: 0.05 });
    }
    const mesh = new InstancedMesh(this.track(caliper), this.track(material), count);
    mesh.name = 'brake-calipers';
    return this.track(mesh);
  }

  private updateWheels(steerAngle: number): void {
    for (let i = 0; i < this.wheelPositions.length; i++) {
      const [x, y, z] = this.wheelPositions[i]!;
      // Positive steering turns right, which is a negative rotation about Y.
      const steer = i < 2 ? -steerAngle : 0;
      this.rotation.setFromEuler(this.euler.set(this.wheelSpin, steer, 0));
      this.position.set(x, y, z);
      this.wheels.setMatrixAt(i, this.matrix.compose(this.position, this.rotation, this.unitScale));
      if (this.calipers !== null) {
        // On the outer face; it turns with the steering, not with the wheel.
        this.rotation.setFromEuler(this.euler.set(0, steer, 0));
        this.position.set(x + Math.sign(x) * (TIRE_WIDTH / 2 + 0.02), y, z);
        this.calipers.setMatrixAt(i, this.matrix.compose(this.position, this.rotation, this.unitScale));
      }
    }
    this.wheels.instanceMatrix.needsUpdate = true;
    if (this.calipers !== null) {
      this.calipers.instanceMatrix.needsUpdate = true;
    }
  }

  private texture<T extends Texture>(texture: T): T {
    return this.track(texture);
  }

  /** A point in the model to the world, by the pose of the last update() (the body's lean left out). */
  private toWorld(x: number, y: number, z: number, out: Vector3): Vector3 {
    const heading = this.root.rotation.y;
    const cos = Math.cos(heading);
    const sin = Math.sin(heading);
    return out.set(this.root.position.x + x * cos + z * sin, y, this.root.position.z - x * sin + z * cos);
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

/** An upgrade level as the truck shows it: 0..3, anything else as 0 (or 3 above it). */
function lookLevel(level: number | undefined): 0 | 1 | 2 | 3 {
  if (level === undefined || !Number.isFinite(level) || level < 1) {
    return 0;
  }
  return level >= 3 ? 3 : level >= 2 ? 2 : 1;
}

/** A key naming everything a TruckView is built from: its model, paint and upgraded parts. */
export function truckViewKey(definition: VehicleDefinition, options: TruckViewOptions = {}): string {
  const paint = options.paint ?? definition.factoryColor;
  const looks = options.looks ?? {};
  const parts = (['exhaust', 'brakes', 'wheels', 'stance', 'fuelTank'] as const)
    .map((look) => lookLevel(looks[look]))
    .join('');
  return `${definition.id}:${paint.toString(16)}:${parts}:${options.lampGlows === false ? 0 : 1}`;
}
