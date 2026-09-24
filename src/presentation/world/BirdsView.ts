import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
  type Scene,
} from 'three';
import { SeededRandom } from '../../core/random/SeededRandom';
import { shorelineXAt } from '../../data/definitions/MapDefinition';
import type { DrivingWorld } from '../../domain/world/DrivingWorld';
import type { PrelitMaterials } from './lighting';

/** Flocks over the fields: this many (every so many fields), of this many birds. */
const FIELD_FLOCKS = 4;
const FIELD_FLOCK_SIZE = 7;
const HARBOUR_FLOCK_SIZE = 8;
const CROW_COLOR = 0x26282b;
const GULL_COLOR = 0xf2f3f0;
/** How they fly: round their flock's middle this far out (meters) and this high, this fast (radians a second). */
const RADIUS = { min: 14, max: 42 } as const;
const HEIGHT = { min: 12, max: 26 } as const;
const TURN_RATE = { min: 0.12, max: 0.3 } as const;
/** Wingbeats a second, as they look from afar; gulls glide between bursts of beats. */
const FLAP_RATE = 1.4;
/** How far they lean into the turn, radians. */
const BANK = 0.3;
/** Birds fly only in fair daylight: hidden once the lamps are this bright or the rain this hard. */
const DARK_LAMPS = 0.5;
const HARD_RAIN = 0.3;

interface Bird {
  readonly centreX: number;
  readonly centreZ: number;
  readonly radius: number;
  readonly height: number;
  /** Radians a second round the middle; negative flies the other way round. */
  readonly turnRate: number;
  readonly phase: number;
  readonly span: number;
  readonly glides: boolean;
}

/**
 * Birds by day: flocks of crows circling over the fields and gulls over the
 * harbour, dark or white silhouettes whose wings beat (the gulls glide
 * between beats). One draw call for them all; none at night or in the
 * rain. update() runs every frame and allocates nothing.
 */
export class BirdsView {
  readonly mesh: InstancedMesh;
  private readonly birds: readonly Bird[];
  private readonly geometry: BufferGeometry;
  private readonly material: MeshBasicMaterial;
  private time = 0;
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly bank = new Quaternion();
  private readonly scale = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private readonly forward = new Vector3(0, 0, 1);

  /** `prelit` dims them with the light, like the ground. */
  constructor(
    private readonly scene: Scene,
    world: DrivingWorld,
    prelit?: PrelitMaterials,
    seed = 29,
  ) {
    const random = new SeededRandom(seed);
    const birds: Bird[] = [];
    const flock = (x: number, z: number, count: number, gulls: boolean): void => {
      const direction = random.next() < 0.5 ? -1 : 1;
      for (let i = 0; i < count; i++) {
        birds.push({
          centreX: x + random.range(-8, 8),
          centreZ: z + random.range(-8, 8),
          radius: random.range(RADIUS.min, RADIUS.max),
          height: random.range(HEIGHT.min, HEIGHT.max),
          turnRate: direction * random.range(TURN_RATE.min, TURN_RATE.max),
          phase: random.range(0, Math.PI * 2),
          span: gulls ? random.range(1.8, 2.2) : random.range(1.2, 1.5),
          glides: gulls,
        });
      }
    };
    const step = Math.max(1, Math.floor(world.fields.length / FIELD_FLOCKS));
    for (let i = 0; i < world.fields.length && birds.length < FIELD_FLOCKS * FIELD_FLOCK_SIZE; i += step) {
      const { area } = world.fields[i]!;
      flock(area.x, area.z, FIELD_FLOCK_SIZE, false);
    }
    const quay = world.sea?.quays[0];
    if (world.sea !== null && quay !== undefined) {
      // Over the water off the quay.
      const z = (quay.fromZ + quay.toZ) / 2;
      flock(shorelineXAt(world.sea.shoreline, z) - 30, z, HARBOUR_FLOCK_SIZE, true);
    }
    this.birds = birds;

    this.geometry = wingsGeometry();
    this.material = new MeshBasicMaterial({ side: DoubleSide });
    prelit?.add(this.material);
    this.mesh = new InstancedMesh(this.geometry, this.material, Math.max(1, birds.length));
    this.mesh.count = birds.length;
    const color = new Color();
    birds.forEach((bird, index) => this.mesh.setColorAt(index, color.setHex(bird.glides ? GULL_COLOR : CROW_COLOR)));
    // They fly about: bounds computed once would go stale.
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.name = 'birds';
    scene.add(this.mesh);
    this.update(0, 0, 0);
  }

  /**
   * Flies the birds `deltaSeconds` on, in the weather's light: `lamps` and
   * `rain` (0..1) send them to roost. Allocation-free.
   */
  update(deltaSeconds: number, lamps: number, rain: number): void {
    const flying = this.birds.length > 0 && lamps < DARK_LAMPS && rain < HARD_RAIN;
    this.mesh.visible = flying;
    if (!flying && deltaSeconds > 0) {
      return;
    }
    this.time = (this.time + deltaSeconds) % 3600;
    const t = this.time;
    for (let i = 0; i < this.birds.length; i++) {
      const bird = this.birds[i]!;
      const angle = bird.phase + t * bird.turnRate;
      this.position.set(
        bird.centreX + Math.cos(angle) * bird.radius,
        bird.height + Math.sin(t * 0.4 + bird.phase) * 2,
        bird.centreZ + Math.sin(angle) * bird.radius,
      );
      // Along the circle, leaning into the turn.
      const heading = Math.atan2(-Math.sin(angle) * bird.turnRate, Math.cos(angle) * bird.turnRate);
      this.rotation.setFromAxisAngle(this.up, heading);
      this.rotation.multiply(this.bank.setFromAxisAngle(this.forward, Math.sign(bird.turnRate) * BANK));
      // Wingbeats: the V flattens and flips; gliding gulls hold their wings still for a while.
      const beating = !bird.glides || Math.sin(t * 0.7 + bird.phase) > 0.2;
      const flap = beating ? Math.sin(t * FLAP_RATE * Math.PI * 2 + bird.phase * 3) : 0.35;
      this.scale.set(bird.span, bird.span * flap, bird.span);
      this.mesh.setMatrixAt(i, this.matrix.compose(this.position, this.rotation, this.scale));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}

/** A bird seen from afar: two wings in a shallow V, a span of 1 across x, flying toward +Z. */
function wingsGeometry(): BufferGeometry {
  const nose = [0, 0, 0.22];
  const tail = [0, 0, -0.18];
  const left = [-0.5, 0.18, -0.12];
  const right = [0.5, 0.18, -0.12];
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([...nose, ...tail, ...left, ...nose, ...right, ...tail]), 3));
  return geometry;
}
