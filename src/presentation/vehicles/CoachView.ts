import {
  BufferAttribute,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type BufferGeometry,
  type Scene,
} from 'three';
import type { TrafficVehicleDefinition } from '../../data/definitions/TrafficVehicleDefinition';
import type { VehicleBody } from '../../data/definitions/VehicleDefinition';
import { vehicleGeometry } from '../traffic/TrafficView';

/** The ring round the next stop: as wide as the room to stop in, meters, and this tall. */
const RING_HEIGHT = 3.5;
/** The light pillar over the next stop shows where it is from afar… */
const PILLAR_HEIGHT = 80;
const PILLAR_RADIUS = 0.9;
/** …and fades as the camera comes close (horizontal distance, meters), where the ring takes over. */
const PILLAR_FADE_START = 60;
const PILLAR_FADE_END = 25;
const BEACON_COLOR = 0x2bd9b0;

/** Where a run of a coach line is (CoachLineService): the next stop while driving to it. */
export interface CoachViewSource {
  readonly active: boolean;
  readonly navTarget: { readonly x: number; readonly z: number } | null;
}

/**
 * A run of a coach line (CoachLineService): the coach, in the coaches'
 * green, where the drive puts it, from the traffic's bus shape; and over the
 * next stop a glowing ring and a light pillar, as over a contract's bay.
 * One draw call for the coach and two for the beacon, none between runs.
 */
export class CoachView {
  private readonly root = new Group();
  private readonly material = new MeshLambertMaterial({ vertexColors: true });
  private readonly body: Mesh;
  private readonly beacon = new Group();
  private readonly ringMaterial: MeshBasicMaterial;
  private readonly pillarMaterial: MeshBasicMaterial;
  private readonly resources: { dispose(): void }[] = [];
  private pulse = 0;

  constructor(
    private readonly scene: Scene,
    body: VehicleBody,
    paint: number,
    stopRadiusMeters: number,
  ) {
    this.root.name = 'coach';
    const shape: TrafficVehicleDefinition = {
      id: 'coach',
      kind: 'bus',
      lengthMeters: body.lengthMeters,
      widthMeters: body.widthMeters,
      heightMeters: body.heightMeters,
      cruiseSpeedFactor: 1,
      accelerationMetersPerSecondSquared: 1,
      spawnWeight: 0,
      colors: [paint],
    };
    this.body = new Mesh(this.track(paintedBody(shape, paint)), this.material);
    this.body.name = 'coach:body';
    this.ringMaterial = this.track(beaconMaterial(true));
    this.pillarMaterial = this.track(beaconMaterial(false));
    const ring = new Mesh(this.track(fadingColumn(new CylinderGeometry(stopRadiusMeters, stopRadiusMeters, RING_HEIGHT, 28, 1, true), RING_HEIGHT)), this.ringMaterial);
    ring.position.y = RING_HEIGHT / 2;
    const pillar = new Mesh(this.track(fadingColumn(new CylinderGeometry(PILLAR_RADIUS, PILLAR_RADIUS, PILLAR_HEIGHT, 10, 1, true), PILLAR_HEIGHT)), this.pillarMaterial);
    pillar.position.y = PILLAR_HEIGHT / 2;
    this.beacon.name = 'coach:stop';
    this.beacon.add(ring, pillar);
    this.beacon.visible = false;
    this.root.add(this.body, this.beacon);
    this.root.visible = false;
    scene.add(this.root);
    this.track(this.material);
  }

  /**
   * Per frame: hidden between runs; in one, the coach at `pose` (its rear
   * axle, on the ground at `y`, pitched with `grade`) and the beacon over
   * the next stop on the ground `groundAt` gives, its pillar fading near
   * the camera at (cameraX, cameraZ). Allocation-free.
   */
  update(
    coach: CoachViewSource,
    pose: { readonly x: number; readonly z: number; readonly heading: number },
    body: { readonly y: number; readonly grade: number },
    wheelbaseMeters: number,
    groundAt: (x: number, z: number) => number,
    cameraX: number,
    cameraZ: number,
    deltaSeconds: number,
  ): void {
    if (this.root.visible !== coach.active) {
      this.root.visible = coach.active;
    }
    if (!coach.active) {
      return;
    }
    // The body's middle is half a wheelbase ahead of the rear axle.
    const ahead = wheelbaseMeters / 2;
    this.body.position.set(pose.x + Math.sin(pose.heading) * ahead, body.y, pose.z + Math.cos(pose.heading) * ahead);
    this.body.rotation.set(-Math.atan(body.grade), pose.heading, 0, 'YXZ');
    const stop = coach.navTarget;
    this.beacon.visible = stop !== null;
    if (stop === null) {
      return;
    }
    this.beacon.position.set(stop.x, groundAt(stop.x, stop.z), stop.z);
    this.pulse = (this.pulse + deltaSeconds) % 2;
    const glow = 0.5 + 0.5 * Math.sin(this.pulse * Math.PI);
    const distance = Math.hypot(stop.x - cameraX, stop.z - cameraZ);
    const far = Math.min(1, Math.max(0, (distance - PILLAR_FADE_END) / (PILLAR_FADE_START - PILLAR_FADE_END)));
    this.ringMaterial.opacity = 0.55 + 0.25 * glow;
    this.pillarMaterial.opacity = (0.45 + 0.2 * glow) * far;
    this.pillarMaterial.visible = far > 0;
  }

  dispose(): void {
    this.scene.remove(this.root);
    for (const resource of this.resources) {
      resource.dispose();
    }
  }

  private track<T extends { dispose(): void }>(resource: T): T {
    this.resources.push(resource);
    return resource;
  }
}

/** A body of `type` in `hex`: its painted parts recoloured. */
function paintedBody(type: TrafficVehicleDefinition, hex: number): BufferGeometry {
  const geometry = vehicleGeometry(type);
  const paint = geometry.getAttribute('paint');
  const colors = geometry.getAttribute('color');
  const color = new Color(hex);
  for (let i = 0; i < colors.count; i++) {
    if (paint !== undefined && paint.getX(i) > 0.5) {
      colors.setXYZ(i, color.r, color.g, color.b);
    }
  }
  return geometry;
}

/** White vertex colours on a column `height` tall, centred on the origin, fading out upward. */
function fadingColumn(geometry: BufferGeometry, height: number): BufferGeometry {
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 4);
  for (let i = 0; i < position.count; i++) {
    const up = position.getY(i) / height + 0.5;
    colors.set([1, 1, 1, 0.9 * (1 - up) ** 1.5], i * 4);
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 4));
  return geometry;
}

/** Translucent, unlit, in the beacon's colour; one pass for both sides (see DepotView's beacon). */
function beaconMaterial(fog: boolean): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color: BEACON_COLOR,
    vertexColors: true,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    side: DoubleSide,
    forceSinglePass: true,
    fog,
  });
}
