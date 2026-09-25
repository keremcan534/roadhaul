import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
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
  TorusGeometry,
  ShaderMaterial,
  Vector3,
  type Material,
  type Scene,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, dampFactor } from '../../core/math/scalar';
import type { UpgradeLook } from '../../data/definitions/UpgradeDefinition';
import type { VehicleDefinition } from '../../data/definitions/VehicleDefinition';
import type { TruckLooks } from '../../domain/vehicles/upgradeBonuses';
import type { VehicleRuntimeState } from '../../domain/vehicles/VehicleRuntimeState';
import type { VehiclePose } from '../../systems/driving/DrivingService';
import type { Rgb } from '../textures/pixelImage';
import { grilleImage, liveryImage, rearDoorsImage, rimImage, softBoxShadowImage } from '../textures/proceduralImages';
import { toTexture } from '../textures/toTexture';
import type { SkyUniforms } from '../world/EnvironmentView';
import { reflectSky, type SkyReflectionOptions } from '../world/skyReflection';
import { cabGeometry } from './cabGeometry';
import { LampGlows } from './LampGlows';

/** Cab paint and livery accent per truck class: original colours, no real-world liveries. */
/** The cab's inside is drawn unlit, in these colours (the sun would leave it black), and dimmer at night. */
const DASHBOARD_COLOR = 0x4a525b;
const BINNACLE_COLOR = 0x353b42;
const PILLAR_COLOR = 0x2f353c;
const SILL_COLOR = 0x3d444c;
const GAUGE_COLOR = 0xcfd6dc;
const STEERING_WHEEL_COLOR = 0x23282d;
const ACCENT_COLOR = 0xf2b233;
/** At night (setLamps(1)) the cab's inside keeps this share of its daytime brightness. */
const CABIN_NIGHT_LEVEL = 0.45;
/** The steering wheel turns this many times as far as the front wheels (about 1¼ turns to full lock). */
const STEERING_RATIO = 12;
/** The steering wheel leans back toward the driver this far from upright, radians. */
const STEERING_WHEEL_TILT = 0.83;
const TIRE_WIDTH = 0.36;
/** A heavy truck's two rear axles stand this far either side of the rear axle the physics uses. */
const TANDEM_HALF_SPACING = 0.68;
/** The exhaust stack behind the cab on the right: its radius, and how far its top stands over the cab roof. */
const STACK_RADIUS = 0.075;
const STACK_OVER_ROOF = 0.42;
/** Colours of the flatbed's load: pallets, bricks and ratchet straps. */
const PALLET_COLOR = 0x9c7a4f;
const BRICK_COLOR = 0xa94f35;
const STRAP_COLOR = 0xffa21c;

/** Body lean per m/s² of acceleration (radians), capped, and how fast the lean follows. */
const PITCH_PER_ACCELERATION = 0.008;
const ROLL_PER_ACCELERATION = 0.012;
const MAX_LEAN = 0.07;
const LEAN_RESPONSE_RATE = 5;

/** The lamps shine this much brighter at night (setLamps(1)) than by day. */
const LAMP_NIGHT_BOOST = 1.5;
const HEADLIGHT_GLOW = 0xfff1cf;
const TAIL_LIGHT_GLOW = 0xff2a1a;
const GLOW_SIZE_METERS = 1.8;
/** The headlights' pool of light on the road: its extent ahead of the bumper and across, and its colour. */
const POOL_LENGTH_METERS = 40;
const POOL_WIDTH_METERS = 20;
/** Above the road's markings and the GPS line, so it lights them too. */
const POOL_Y = 0.11;
const POOL_COLOR = 0xffe7b8;
const POOL_STRENGTH = 0.5;
/**
 * The headlights' beams in the night air (with the lamp glows): a cone from
 * each lamp this long, this wide at its far end, flattened to this share of
 * that in height and aimed this far down (radians), this bright.
 */
const BEAM_LENGTH_METERS = 22;
const BEAM_RADIUS_METERS = 3.4;
const BEAM_FLATTEN = 0.5;
const BEAM_DIP = 0.05;
const BEAM_STRENGTH = 0.14;
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
}

/**
 * A cab-over truck built from a VehicleDefinition's body dimensions and body
 * type: original designs, no real-world models. The cab has windows, grille,
 * headlights and mirrors. A box body carries the RoadHaul livery on its sides
 * and doors; a refrigerated one adds a cooling unit over the cab; a flatbed
 * has a deck, headboard and stakes, and shows its load of bricks while loaded.
 * Heavy trucks stand on two rear axles. Upgrades show (options.looks): taller
 * chrome stacks, twin at level 2, with a roof light bar at 3; a longer tank,
 * chrome, then a second one; polished, chrome or gold rims; yellow, orange
 * or red brake calipers; and a body sitting lower on mudflaps, with a
 * chrome bumper and grille bars. Parts that share a material are merged, so
 * a truck costs about 15 draw calls (two more at night, when its lamps glow
 * and the headlights light the road: setLamps(); one for the calipers). Its
 * origin is the rear axle, like VehicleRuntimeState. Front wheels steer, all
 * wheels roll, and the body pitches and rolls with acceleration.
 *
 * update() runs every frame and allocates nothing.
 */
export class TruckView {
  private readonly root = new Group();
  private readonly body = new Group();
  private readonly windshield: Mesh;
  /** The cab's inside: only shown from the driver's seat. */
  private readonly cabin = new Group();
  /** Turns with the front wheels. */
  private readonly steeringWheel: Mesh;
  private readonly cabinMaterial: MeshBasicMaterial;
  /** The colour it is painted in, 0xRRGGBB. */
  readonly paint: number;
  /** The flatbed's visible load; null for closed bodies, whose load is out of sight. */
  private readonly load: Mesh | null = null;
  private readonly wheels: InstancedMesh;
  /** Brake calipers on the wheels' outer faces (a brakes upgrade); they steer but do not spin. */
  private readonly calipers: InstancedMesh | null = null;
  /** Night: brighter lamps, their glows, and the headlights' light on the road ahead. */
  private readonly lampMaterial: MeshBasicMaterial;
  private readonly glows: LampGlows;
  private readonly headlightPool: Mesh;
  private readonly poolIntensity = { value: 0 };
  private readonly headlightBeams: Mesh;
  private readonly beamIntensity = { value: 0 };
  private lamps = 0;
  private readonly resources: { dispose(): void }[] = [];
  private readonly wheelPositions: readonly (readonly [number, number, number])[];
  /** In the model: the exhaust stack's outlet, and just behind the last rear wheel on the left (+x) side. */
  private readonly exhaustAt: readonly [number, number, number];
  private readonly behindRearWheelAt: readonly [number, number, number];
  private wheelSpin = 0;
  private pitch = 0;
  private roll = 0;
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
    // Front: grille, bumper, headlights and indicators, and the mirrors.
    add('grille', frontQuad(W * 0.6, beltY - 0.2 - (bumperTop + 0.2), frontZ + 0.012, bumperTop + 0.2));
    box(stance >= 2 ? 'chrome' : 'dark', [W + 0.06, 0.32, 0.24], [0, bumperTop - 0.16, frontZ + 0.02]);
    if (stance === 3) {
      // Chrome bars across the grille.
      const grilleBottom = bumperTop + 0.2;
      const grilleHeight = beltY - 0.2 - grilleBottom;
      for (let i = 1; i <= 3; i++) {
        box('chrome', [W * 0.62, 0.035, 0.04], [0, grilleBottom + (grilleHeight * i) / 4, frontZ + 0.03]);
      }
    }
    for (const side of [1, -1] as const) {
      lamp(0xfff4d6, [0.42, 0.18, 0.05], [side * (halfW - 0.32), bumperTop + 0.2, frontZ + 0.015]);
      lamp(0xffa21c, [0.14, 0.12, 0.05], [side * (halfW - 0.06), bumperTop + 0.2, frontZ + 0.015]);
      // Mirror on an arm near the front pillar, its glass facing back (the driver sees it from the cab).
      const mirrorY = beltY + (cabTop - beltY) * 0.3;
      box('dark', [0.36, 0.04, 0.04], [side * (halfW + 0.16), mirrorY + 0.2, frontZ - 0.32]);
      box('dark', [0.2, 0.36, 0.07], [side * (halfW + 0.33), mirrorY, frontZ - 0.32]);
      add('glass', new PlaneGeometry(0.16, 0.31).rotateY(Math.PI).translate(side * (halfW + 0.33), mirrorY, frontZ - 0.32 - 0.036));
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
    // The exhaust stack stands at the cab's rear corner on the right, up past the roof: chrome and taller on an
    // upgraded engine, and from level 2 a twin on the left.
    const stackTop = cabTop + STACK_OVER_ROOF + STACK_EXTRA_HEIGHT[exhaust];
    const stackRadius = STACK_RADIUS + (exhaust === 3 ? 0.02 : exhaust > 0 ? 0.01 : 0);
    const stackX = -(halfW + stackRadius + 0.02);
    const stackZ = cabRear + 0.15;
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
      glass: this.track(shiny(new MeshPhongMaterial({ color: 0x1b2733, shininess: 140, specular: 0x9aa7b3 }), { facing: 0.07 })),
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

    // The cab's inside, seen only from the driver's seat (cabGeometry's eye): a low dashboard along the
    // windscreen with two gauges, the pillars and roof edge that frame the view, and a steering wheel that
    // turns with the front wheels. It does not lean with the body: neither does the driver's eye, and it
    // would bob up and down the screen.
    const { eyeX, eyeY, eyeZ } = cab;
    // The gauges sit in a hood on the dashboard, seen through the top of the steering wheel.
    const gauge = (x: number): BufferGeometry =>
      colored(new CircleGeometry(0.055, 18).rotateY(Math.PI).translate(eyeX + x, eyeY - 0.27, eyeZ + 0.725), GAUGE_COLOR);
    const pillar = (side: 1 | -1): BufferGeometry =>
      colored(new BoxGeometry(0.08, cabTop - beltY, 0.1).translate(side * (halfW - 0.07), (beltY + cabTop) / 2, frontZ - 0.1), PILLAR_COLOR);
    const interior = [
      colored(new BoxGeometry(W * 0.9, 0.22, 0.6).translate(0, eyeY - 0.6, frontZ - 0.42), DASHBOARD_COLOR),
      colored(new BoxGeometry(W * 0.9, 0.04, 0.12).translate(0, eyeY - 0.48, frontZ - 0.16), DASHBOARD_COLOR),
      colored(new BoxGeometry(0.5, 0.29, 0.14).translate(eyeX, eyeY - 0.345, eyeZ + 0.8), BINNACLE_COLOR),
      gauge(0.11),
      gauge(-0.11),
      pillar(1),
      pillar(-1),
      colored(new BoxGeometry(W, 0.07, 0.12).translate(0, cabTop - 0.035, frontZ - 0.1), PILLAR_COLOR),
      // Ceiling and door sills: from inside, the cab's painted walls face away and are not drawn, so these
      // keep the roof's gear and the paint's top edge out of sight.
      colored(new BoxGeometry(W - 0.08, 0.02, cabLength - 0.2).translate(0, cabTop - 0.03, frontZ - 0.1 - (cabLength - 0.2) / 2), PILLAR_COLOR),
      colored(new BoxGeometry(W - 0.08, 0.02, cabLength - 0.3).translate(0, beltY + 0.012, frontZ - 0.2 - (cabLength - 0.3) / 2), SILL_COLOR),
    ];
    this.cabinMaterial = this.track(new MeshBasicMaterial({ vertexColors: true }));
    const interiorMaterial = this.cabinMaterial;
    const interiorMesh = new Mesh(this.track(mergeGeometries(interior)), interiorMaterial);
    interiorMesh.name = 'cab-interior';
    this.cabin.add(interiorMesh);
    for (const part of interior) {
      part.dispose();
    }
    // Rim, hub and three spokes, with a mark at the top like the on-screen wheel's.
    const wheelParts = [
      colored(new TorusGeometry(0.2, 0.024, 8, 28), STEERING_WHEEL_COLOR),
      colored(new CylinderGeometry(0.055, 0.055, 0.05, 14).rotateX(Math.PI / 2), STEERING_WHEEL_COLOR),
      colored(new BoxGeometry(0.17, 0.035, 0.018).translate(0.1, 0, 0), STEERING_WHEEL_COLOR),
      colored(new BoxGeometry(0.17, 0.035, 0.018).translate(-0.1, 0, 0), STEERING_WHEEL_COLOR),
      colored(new BoxGeometry(0.035, 0.17, 0.018).translate(0, -0.1, 0), STEERING_WHEEL_COLOR),
      colored(new BoxGeometry(0.035, 0.03, 0.05).translate(0, 0.2, 0), ACCENT_COLOR),
    ];
    this.steeringWheel = new Mesh(this.track(mergeGeometries(wheelParts)), interiorMaterial);
    this.steeringWheel.name = 'steering-wheel';
    for (const part of wheelParts) {
      part.dispose();
    }
    // Its column rises toward the driver: the rim's top leans forward.
    const column = new Group();
    column.position.set(eyeX, eyeY - 0.36, eyeZ + 0.56);
    column.rotation.x = STEERING_WHEEL_TILT;
    column.add(this.steeringWheel);
    this.cabin.add(column);
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

    // At night: a glow on each headlight and tail light (they lean with the body), and light on the road ahead.
    const headlightX = halfW - 0.32;
    this.glows = this.track(new LampGlows(4, GLOW_SIZE_METERS));
    for (const side of [1, -1] as const) {
      const index = side === 1 ? 0 : 1;
      this.glows.setPosition(index, side * headlightX, bumperTop + 0.2, frontZ + 0.12);
      this.glows.setColor(index, HEADLIGHT_GLOW);
      this.glows.setPosition(index + 2, side * (halfW - 0.3), R + 0.26, rearZ - 0.12);
      this.glows.setColor(index + 2, TAIL_LIGHT_GLOW);
    }
    this.glows.setCount(4);
    this.body.add(this.glows.points);
    this.headlightPool = this.createHeadlightPool(frontZ, headlightX);
    // The beams lean with the body, like the lamps.
    this.headlightBeams = this.createHeadlightBeams(frontZ + 0.12, headlightX, bumperTop + 0.2);
    this.body.add(this.headlightBeams);

    // An upgraded suspension sets the body lower over its wheels.
    this.body.position.y = -drop;
    this.cabin.position.y = -drop;
    this.root.add(shadow, this.headlightPool, this.body, this.cabin, this.wheels);
    if (this.calipers !== null) {
      this.root.add(this.calipers);
    }
    if (options.castShadows === true) {
      // The truck itself, not its soft shadow, the light on the road or the glows.
      for (const part of [this.body, this.cabin, this.wheels]) {
        part.traverse((object) => {
          if (object instanceof Mesh && object !== this.headlightBeams) {
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
    // Clockwise, as the driver sees it, for a right turn.
    this.steeringWheel.rotation.z = state.steerAngle * STEERING_RATIO;

    // Nose dips when braking and lifts when accelerating; the body leans out of turns.
    const response = dampFactor(LEAN_RESPONSE_RATE, deltaSeconds);
    const targetPitch = clamp(-state.longitudinalAcceleration * PITCH_PER_ACCELERATION, -MAX_LEAN, MAX_LEAN);
    const targetRoll = clamp(state.lateralAcceleration * ROLL_PER_ACCELERATION, -MAX_LEAN, MAX_LEAN);
    this.pitch += (targetPitch - this.pitch) * response;
    this.roll += (targetRoll - this.roll) * response;
    this.body.rotation.set(this.pitch, 0, this.roll);
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
   * brighter lamps, a glow round them, and the headlights' pool of light on
   * the road ahead. Cheap to call every frame.
   */
  setLamps(level: number): void {
    if (level === this.lamps) {
      return;
    }
    this.lamps = level;
    this.lampMaterial.color.setScalar(1 + level * LAMP_NIGHT_BOOST);
    this.cabinMaterial.color.setScalar(1 - level * (1 - CABIN_NIGHT_LEVEL));
    this.glows.setLevel(this.options.lampGlows === false ? 0 : level);
    this.poolIntensity.value = level * POOL_STRENGTH;
    this.headlightPool.visible = level > 0.01;
    this.beamIntensity.value = level * BEAM_STRENGTH;
    this.headlightBeams.visible = this.options.lampGlows !== false && level > 0.01;
  }

  /** From the driver's seat the windshield would block the view: swap it for the cab's inside. */
  setCabinView(enabled: boolean): void {
    this.windshield.visible = !enabled;
    this.cabin.visible = enabled;
  }

  dispose(): void {
    this.scene.remove(this.root);
    for (const resource of this.resources) {
      resource.dispose();
    }
  }

  /**
   * The headlights' light on the road: two beams from the lamps `lampX` either
   * side of the middle, widening ahead of the bumper at `frontZ` and fading
   * out with distance. Added onto the road, so it lights whatever lies there.
   */
  private createHeadlightPool(frontZ: number, lampX: number): Mesh {
    const geometry = new PlaneGeometry(POOL_WIDTH_METERS, POOL_LENGTH_METERS)
      .rotateX(-Math.PI / 2)
      .translate(0, POOL_Y, frontZ + POOL_LENGTH_METERS / 2);
    const material = new ShaderMaterial({
      uniforms: { intensity: this.poolIntensity, color: { value: new Color(POOL_COLOR) } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      // The road's layers are pulled toward the camera (TrackView): pull the light further, or far off, where
      // the road is seen at a grazing angle, the road would cover it.
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -12,
      vertexShader: /* glsl */ `
        varying vec2 vPlace;
        void main() {
          // Across the truck, and ahead of its front bumper, in meters.
          vPlace = vec2(position.x, position.z - ${frontZ.toFixed(3)});
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        #define LAMP_X ${lampX.toFixed(3)}
        #define LENGTH ${POOL_LENGTH_METERS.toFixed(1)}
        #define HALF_WIDTH ${(POOL_WIDTH_METERS / 2).toFixed(1)}
        uniform float intensity;
        uniform vec3 color;
        varying vec2 vPlace;
        float beam(float x, float ahead, float lampX) {
          float across = (x - lampX) / (0.35 + ahead * 0.18);
          return exp(-across * across * 1.5);
        }
        void main() {
          float ahead = vPlace.y;
          float light = min(beam(vPlace.x, ahead, -LAMP_X) + beam(vPlace.x, ahead, LAMP_X), 1.3);
          float distance = ahead / 16.0;
          light *= smoothstep(0.3, 4.0, ahead) * (1.0 - smoothstep(LENGTH * 0.5, LENGTH - 1.0, ahead)) / (1.0 + distance * distance);
          light *= 1.0 - smoothstep(0.7, 1.0, abs(vPlace.x) / HALF_WIDTH);
          gl_FragColor = vec4(color * light * intensity, 1.0);
        }
      `,
    });
    const pool = new Mesh(this.track(geometry), this.track(material));
    pool.name = 'headlight-pool';
    pool.visible = false;
    return pool;
  }

  /**
   * The headlights' beams in the air: a cone from each lamp at (±`lampX`,
   * `lampY`, `frontZ`), flattened and dipped a little, added onto the
   * picture. Seen through its middle a beam is deepest, so it is brightest
   * where it faces the eye, fading at its rim and with distance: light in
   * the air, not a solid cone. One draw call for both, both faces.
   */
  private createHeadlightBeams(frontZ: number, lampX: number, lampY: number): Mesh {
    const cones = ([1, -1] as const).map((side) =>
      new ConeGeometry(BEAM_RADIUS_METERS, BEAM_LENGTH_METERS, 20, 1, true)
        // The apex at the lamp, the open end ahead (+z), dipped toward the road.
        .translate(0, -BEAM_LENGTH_METERS / 2, 0)
        .rotateX(-Math.PI / 2 + BEAM_DIP)
        .scale(1, BEAM_FLATTEN, 1)
        .translate(side * lampX, lampY, frontZ),
    );
    const geometry = mergeGeometries(cones);
    for (const cone of cones) {
      cone.dispose();
    }
    const material = new ShaderMaterial({
      uniforms: { intensity: this.beamIntensity, color: { value: new Color(HEADLIGHT_GLOW) } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      // Additive: the order of its faces does not matter, so one pass (ARCHITECTURE.md: translucent two-sided).
      forceSinglePass: true,
      vertexShader: /* glsl */ `
        varying float vAlong;
        varying vec3 vNormalView;
        varying vec3 vToEye;
        void main() {
          // How far along the beam, 0 at the lamp and 1 at its far end.
          vAlong = (position.z - ${frontZ.toFixed(3)}) / ${BEAM_LENGTH_METERS.toFixed(1)};
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vToEye = -mvPosition.xyz;
          vNormalView = normalMatrix * normal;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float intensity;
        uniform vec3 color;
        varying float vAlong;
        varying vec3 vNormalView;
        varying vec3 vToEye;
        void main() {
          float facing = abs(dot(normalize(vNormalView), normalize(vToEye)));
          float fade = smoothstep(0.0, 0.06, vAlong) * (1.0 - smoothstep(0.4, 1.0, vAlong)) / (1.0 + vAlong * vAlong * 6.0);
          gl_FragColor = vec4(color * intensity * facing * facing * fade, 1.0);
        }
      `,
    });
    const beams = new Mesh(this.track(geometry), this.track(material));
    beams.name = 'headlight-beams';
    beams.visible = false;
    return beams;
  }

  /** Tyres with a rim on each face, the rims in the finish of the tyres upgrade's `level`: two draw calls for all the wheels. */
  private createWheels(radius: number, count: number, level: 0 | 1 | 2 | 3): InstancedMesh {
    const tire = new CylinderGeometry(radius, radius, TIRE_WIDTH, 22).rotateZ(Math.PI / 2);
    const outer = new CircleGeometry(radius * 0.72, 22).rotateY(Math.PI / 2).translate(TIRE_WIDTH / 2 + 0.002, 0, 0);
    const inner = new CircleGeometry(radius * 0.72, 22).rotateY(-Math.PI / 2).translate(-TIRE_WIDTH / 2 - 0.002, 0, 0);
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
