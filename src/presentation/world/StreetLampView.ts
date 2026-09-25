import {
  BoxGeometry,
  BufferAttribute,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { StreetLamp } from '../../domain/world/DrivingWorld';
import { LampGlows } from '../vehicles/LampGlows';
import type { StreetLampLight } from './LampLighting';

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

export interface StreetLampViewOptions {
  /** Whether lit lamps glow (off on the low preset). Default: true. */
  readonly lampGlows?: boolean;
  /** The posts cast the sun's real-time shadows (the high preset's shadow map). Default: false. */
  readonly castShadows?: boolean;
}

/**
 * The street lamps along the city roads: a post with an arm and a head over
 * the road, all instanced (two draw calls for every lamp on the map). At
 * night (setLamps) the lenses light up and, unless the quality preset
 * leaves it out, glow: one more draw call, only while the lamps are on.
 * Their light on the world is LampLighting's, from lampLights().
 */
export class StreetLampView {
  private readonly root = new Group();
  private readonly resources: { dispose(): void }[] = [];
  private readonly lensMaterial: MeshBasicMaterial;
  private readonly lensOn = new Color(LENS_ON);
  private readonly glows: LampGlows | null = null;
  /** Where each lamp's light comes from (just under its lens, in the world), and the way its head faces. */
  private readonly lights: readonly StreetLampLight[];
  private level = 0;

  constructor(
    private readonly scene: Scene,
    lamps: readonly StreetLamp[],
    options: StreetLampViewOptions = {},
  ) {
    this.root.name = 'street-lamps';
    this.lensMaterial = this.track(new MeshBasicMaterial({ color: LENS_OFF }));
    this.lights = lamps.map((lamp) => {
      const facingX = Math.sin(lamp.heading);
      const facingZ = Math.cos(lamp.heading);
      return {
        x: lamp.x + facingX * STREET_LAMP_REACH_METERS,
        y: LENS_Y - 0.1,
        z: lamp.z + facingZ * STREET_LAMP_REACH_METERS,
        facingX,
        facingZ,
      };
    });
    if (lamps.length === 0) {
      scene.add(this.root);
      return;
    }
    const posts = this.instanced(this.track(postGeometry()), this.track(new MeshLambertMaterial({ vertexColors: true })), lamps);
    posts.castShadow = options.castShadows === true;
    const lenses = this.instanced(
      this.track(new BoxGeometry(0.26, 0.04, 0.6).translate(0, LENS_Y, STREET_LAMP_REACH_METERS)),
      this.lensMaterial,
      lamps,
    );
    this.root.add(posts, lenses);

    if (options.lampGlows !== false) {
      this.glows = new LampGlows(lamps.length, GLOW_SIZE_METERS);
      this.lights.forEach(({ x, y, z }, index) => {
        this.glows!.setPosition(index, x, y, z);
        this.glows!.setColor(index, GLOW_COLOR);
      });
      this.glows.setCount(lamps.length);
      this.root.add(this.glows.points);
    }
    scene.add(this.root);
  }

  /** Where each lamp's light comes from, in the world (just under its lens), and the way its head faces the road. */
  lampLights(): readonly StreetLampLight[] {
    return this.lights;
  }

  /**
   * How brightly lamps shine, 0..1 (the weather: 0 by day, 1 at night): the
   * lenses light up and glow. Cheap to call every frame.
   */
  setLamps(level: number): void {
    if (level === this.level) {
      return;
    }
    this.level = level;
    this.lensMaterial.color.setHex(LENS_OFF).lerp(this.lensOn, level);
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
