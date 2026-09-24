import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { StreetLamp } from '../../domain/world/DrivingWorld';
import { lightPoolImage } from '../textures/proceduralImages';
import { toTexture } from '../textures/toTexture';
import { LampGlows } from '../vehicles/LampGlows';

/** The post's height and how far its arm reaches out over the road, meters. */
const POST_HEIGHT = 7.6;
export const STREET_LAMP_REACH_METERS = 1.9;
/** The lens, under the head at the arm's end. */
const LENS_Y = POST_HEIGHT - 0.14;
const POST_COLOR = 0x7d858d;
const HOUSING_COLOR = 0x3b4148;
/** The lens is grey by day and warm white when lit. */
const LENS_OFF = 0x9ea4a9;
const LENS_ON = 0xfff1cf;
const GLOW_COLOR = 0xffd79c;
const GLOW_SIZE_METERS = 2.8;
/**
 * The pool of light under each lamp: its size, height and colour, and how
 * strongly it lights the road with the lamps fully on. It lies over the road
 * and its markings, pulled toward the camera like the headlights' pool.
 */
const POOL_SIZE_METERS = 17;
const POOL_Y = 0.1;
const POOL_COLOR = 0xffc574;
const POOL_OPACITY = 0.6;

export interface StreetLampViewOptions {
  /** Whether lit lamps glow and light the road beneath them (off on the low preset). Default: true. */
  readonly lampGlows?: boolean;
}

/**
 * The street lamps along the city roads: a post with an arm and a head over
 * the road, all instanced (two draw calls for every lamp on the map). At
 * night (setLamps) the lenses light up and, unless the quality preset
 * leaves them out, glow and throw a warm pool of light on the road: two
 * more draw calls, only while the lamps are on.
 */
export class StreetLampView {
  private readonly root = new Group();
  private readonly resources: { dispose(): void }[] = [];
  private readonly lensMaterial: MeshBasicMaterial;
  private readonly lensOn = new Color(LENS_ON);
  private readonly pools: InstancedMesh | null = null;
  private readonly poolMaterial: MeshBasicMaterial | null = null;
  private readonly glows: LampGlows | null = null;
  private level = 0;

  constructor(
    private readonly scene: Scene,
    lamps: readonly StreetLamp[],
    options: StreetLampViewOptions = {},
  ) {
    this.root.name = 'street-lamps';
    this.lensMaterial = this.track(new MeshBasicMaterial({ color: LENS_OFF }));
    if (lamps.length === 0) {
      scene.add(this.root);
      return;
    }
    const posts = this.instanced(this.track(postGeometry()), this.track(new MeshLambertMaterial({ vertexColors: true })), lamps);
    const lenses = this.instanced(
      this.track(new BoxGeometry(0.26, 0.04, 0.6).translate(0, LENS_Y, STREET_LAMP_REACH_METERS)),
      this.lensMaterial,
      lamps,
    );
    this.root.add(posts, lenses);

    if (options.lampGlows !== false) {
      this.poolMaterial = this.track(
        new MeshBasicMaterial({
          map: this.track(toTexture(lightPoolImage(), { srgb: false })),
          color: POOL_COLOR,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: AdditiveBlending,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -12,
        }),
      );
      const pool = this.track(
        new PlaneGeometry(POOL_SIZE_METERS, POOL_SIZE_METERS)
          .rotateX(-Math.PI / 2)
          .translate(0, POOL_Y, STREET_LAMP_REACH_METERS),
      );
      this.pools = this.instanced(pool, this.poolMaterial, lamps);
      this.pools.name = 'street-lamp-pools';
      this.pools.visible = false;

      this.glows = new LampGlows(lamps.length, GLOW_SIZE_METERS);
      lamps.forEach((lamp, index) => {
        this.glows!.setPosition(
          index,
          lamp.x + Math.sin(lamp.heading) * STREET_LAMP_REACH_METERS,
          LENS_Y - 0.1,
          lamp.z + Math.cos(lamp.heading) * STREET_LAMP_REACH_METERS,
        );
        this.glows!.setColor(index, GLOW_COLOR);
      });
      this.glows.setCount(lamps.length);
      this.root.add(this.pools, this.glows.points);
    }
    scene.add(this.root);
  }

  /**
   * How brightly lamps shine, 0..1 (the weather: 0 by day, 1 at night): the
   * lenses light up, glow and light the road. Cheap to call every frame.
   */
  setLamps(level: number): void {
    if (level === this.level) {
      return;
    }
    this.level = level;
    this.lensMaterial.color.setHex(LENS_OFF).lerp(this.lensOn, level);
    if (this.pools !== null && this.poolMaterial !== null) {
      this.poolMaterial.opacity = level * POOL_OPACITY;
      this.pools.visible = level > 0.01;
    }
    this.glows?.setLevel(level);
  }

  dispose(): void {
    this.scene.remove(this.root);
    this.glows?.dispose();
    for (const resource of this.resources) {
      resource.dispose();
    }
  }

  /** One copy of `geometry` per lamp, at its foot, turned so the arm reaches over the road. */
  private instanced(
    geometry: BufferGeometry,
    material: MeshBasicMaterial | MeshLambertMaterial,
    lamps: readonly StreetLamp[],
  ): InstancedMesh {
    const mesh = this.track(new InstancedMesh(geometry, material, lamps.length));
    const matrix = new Matrix4();
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3(1, 1, 1);
    const up = new Vector3(0, 1, 0);
    lamps.forEach((lamp, index) => {
      rotation.setFromAxisAngle(up, lamp.heading);
      mesh.setMatrixAt(index, matrix.compose(position.set(lamp.x, 0, lamp.z), rotation, scale));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    return mesh;
  }

  /** Remembers a GPU resource so dispose() can release it. */
  private track<T extends { dispose(): void }>(resource: T): T {
    this.resources.push(resource);
    return resource;
  }
}

/**
 * A lamp without its lens, at the origin with its arm along +Z: a tapered
 * post on a plinth, an arm rising slightly as it reaches out, and the head's
 * dark housing. Coloured per vertex, so it is one geometry.
 */
function postGeometry(): BufferGeometry {
  const parts: [BufferGeometry, number][] = [
    [new CylinderGeometry(0.2, 0.24, 0.5, 8).translate(0, 0.25, 0), POST_COLOR],
    [new CylinderGeometry(0.075, 0.13, POST_HEIGHT, 8).translate(0, POST_HEIGHT / 2, 0), POST_COLOR],
    [
      new BoxGeometry(0.08, 0.08, STREET_LAMP_REACH_METERS)
        .rotateX(-0.08)
        .translate(0, POST_HEIGHT - 0.05, STREET_LAMP_REACH_METERS / 2 - 0.05),
      POST_COLOR,
    ],
    [new BoxGeometry(0.36, 0.16, 0.8).translate(0, LENS_Y + 0.1, STREET_LAMP_REACH_METERS), HOUSING_COLOR],
  ];
  const color = new Color();
  for (const [part, hex] of parts) {
    color.setHex(hex);
    const count = part.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors.set([color.r, color.g, color.b], i * 3);
    }
    part.setAttribute('color', new BufferAttribute(colors, 3));
  }
  const merged = mergeGeometries(parts.map(([part]) => part));
  for (const [part] of parts) {
    part.dispose();
  }
  return merged;
}
