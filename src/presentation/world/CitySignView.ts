import {
  BoxGeometry,
  BufferAttribute,
  Color,
  Group,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CITY_SIGN_POST_SPACING_METERS, type CitySign } from '../../domain/world/DrivingWorld';
import { citySignImage } from '../textures/proceduralImages';
import { toTexture } from '../textures/toTexture';

/** The board: its size, and the height of its lower edge above the ground, meters. */
const BOARD_WIDTH = 6;
const BOARD_HEIGHT = 1.9;
const BOARD_DEPTH = 0.1;
const BOARD_BOTTOM = 2.2;
const POST_SIZE = 0.16;
const POST_COLOR = 0x858c93;
const BACK_COLOR = 0xa3a9ae;
/**
 * Road signs are retroreflective: a board's face glows a little by day, so
 * one in the shade still reads, and as if in the headlights at night.
 */
const DAY_GLOW = 0.22;
const NIGHT_GLOW = 0.55;

export interface CitySignViewOptions {
  /** Texture anisotropy for the boards' faces (renderer capability). */
  readonly anisotropy?: number;
}

/**
 * The cities' name boards beside the roads into them: a white board with
 * the name in capitals, on two posts. All of them together are two draw
 * calls: the posts and backs, and the faces, which share one texture with a
 * row per name. `nameOf` gives a city's name (the entry point looks it up
 * in the string tables); the boards write it in Turkish capitals, as the
 * region's own signs would.
 */
export class CitySignView {
  private readonly root = new Group();
  private readonly resources: { dispose(): void }[] = [];
  private readonly faceMaterial: MeshLambertMaterial | null = null;
  private level = 0;

  constructor(
    private readonly scene: Scene,
    signs: readonly CitySign[],
    nameOf: (cityId: string) => string,
    options: CitySignViewOptions = {},
  ) {
    this.root.name = 'city-signs';
    scene.add(this.root);
    if (signs.length === 0) {
      return;
    }
    const names = [...new Set(signs.map((sign) => nameOf(sign.cityId).toLocaleUpperCase('tr')))];
    const texture = this.track(toTexture(citySignImage(names), { anisotropy: options.anisotropy ?? 1 }));
    this.faceMaterial = this.track(
      new MeshLambertMaterial({ map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: DAY_GLOW }),
    );

    const frames: BufferGeometry[] = [];
    const faces: BufferGeometry[] = [];
    const placement = new Matrix4();
    const rotation = new Quaternion();
    const up = new Vector3(0, 1, 0);
    for (const sign of signs) {
      placement.compose(new Vector3(sign.x, 0, sign.z), rotation.setFromAxisAngle(up, sign.heading), new Vector3(1, 1, 1));
      frames.push(frameGeometry().applyMatrix4(placement));
      const row = names.indexOf(nameOf(sign.cityId).toLocaleUpperCase('tr'));
      faces.push(faceGeometry(row, names.length).applyMatrix4(placement));
    }
    this.root.add(
      new Mesh(this.merged(frames), this.track(new MeshLambertMaterial({ vertexColors: true }))),
      new Mesh(this.merged(faces), this.faceMaterial),
    );
  }

  /** How brightly lamps shine, 0..1 (the weather): at night the boards glow as if in the headlights. */
  setLamps(level: number): void {
    if (level === this.level || this.faceMaterial === null) {
      return;
    }
    this.level = level;
    this.faceMaterial.emissiveIntensity = DAY_GLOW + level * (NIGHT_GLOW - DAY_GLOW);
  }

  dispose(): void {
    this.scene.remove(this.root);
    for (const resource of this.resources) {
      resource.dispose();
    }
  }

  /** Merges `parts` into one tracked geometry and releases the parts. */
  private merged(parts: BufferGeometry[]): BufferGeometry {
    const geometry = this.track(mergeGeometries(parts));
    for (const part of parts) {
      part.dispose();
    }
    return geometry;
  }

  /** Remembers a GPU resource so dispose() can release it. */
  private track<T extends { dispose(): void }>(resource: T): T {
    this.resources.push(resource);
    return resource;
  }
}

/** A board's back and posts, at the origin facing +Z: posts either side, behind the board. Coloured per vertex. */
function frameGeometry(): BufferGeometry {
  const postHeight = BOARD_BOTTOM + BOARD_HEIGHT;
  const parts: [BufferGeometry, number][] = [
    ...[-1, 1].map((side): [BufferGeometry, number] => [
      new BoxGeometry(POST_SIZE, postHeight, POST_SIZE).translate(
        (side * CITY_SIGN_POST_SPACING_METERS) / 2,
        postHeight / 2,
        -BOARD_DEPTH / 2 - POST_SIZE / 2,
      ),
      POST_COLOR,
    ]),
    [new BoxGeometry(BOARD_WIDTH, BOARD_HEIGHT, BOARD_DEPTH).translate(0, BOARD_BOTTOM + BOARD_HEIGHT / 2, 0), BACK_COLOR],
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
  const frame = mergeGeometries(parts.map(([part]) => part));
  for (const [part] of parts) {
    part.dispose();
  }
  return frame;
}

/** A board's face, just in front of its back, showing row `row` of `rows` of the names texture. */
function faceGeometry(row: number, rows: number): BufferGeometry {
  const face = new PlaneGeometry(BOARD_WIDTH - 0.02, BOARD_HEIGHT - 0.02).translate(
    0,
    BOARD_BOTTOM + BOARD_HEIGHT / 2,
    BOARD_DEPTH / 2 + 0.005,
  );
  const uvs = face.getAttribute('uv');
  for (let i = 0; i < uvs.count; i++) {
    uvs.setY(i, (row + uvs.getY(i)) / rows);
  }
  return face;
}
