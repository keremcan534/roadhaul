import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  DIRECTION_BOARD_LEG_RADIUS_METERS,
  DIRECTION_BOARD_WIDTH_METERS,
  directionBoardLegs,
  type BoardTone,
  type DirectionBoard,
  type DirectionRow,
} from '../../domain/world/roadSigns';
import type { PixelRect } from '../textures/drawing';
import {
  SIGN_BOARD_ROW_PIXELS,
  SIGN_DIGIT_PIXELS,
  SIGN_NAME_PIXELS,
  signBoardImage,
  signBoardSheet,
  type SignBoardSheet,
  type ToneCells,
} from '../textures/signBoardImages';
import { toTexture } from '../textures/toTexture';

/**
 * A board's rows are this tall, their lettering this many meters to the
 * sheet's pixel; round them, a white rim this wide and this much of the
 * board's colour above the first row and below the last. Along a row: a
 * little of the board's colour, the arrow (a square), a gap, the name, the
 * distance's two digits, and the rest of the board's colour.
 */
const ROW_HEIGHT = 0.34;
const METERS_PER_PIXEL = ROW_HEIGHT / SIGN_BOARD_ROW_PIXELS;
const RIM = 0.035;
const PAD = 0.07;
const LEAD = 0.06;
const GAP = 0.06;
const NAME_WIDTH = SIGN_NAME_PIXELS * METERS_PER_PIXEL;
const DIGIT_WIDTH = SIGN_DIGIT_PIXELS * METERS_PER_PIXEL;
const TAIL = DIRECTION_BOARD_WIDTH_METERS - 2 * RIM - LEAD - ROW_HEIGHT - GAP - NAME_WIDTH - 2 * DIGIT_WIDTH;
/** The board's lower edge stands this high on its legs; its back is this thick, the legs this square. */
const BOARD_BOTTOM = 1.4;
const BOARD_DEPTH = 0.05;
const LEG_SIZE = 2 * DIRECTION_BOARD_LEG_RADIUS_METERS;
const LEG_COLOR = 0x858c93;
const BACK_COLOR = 0x8f969c;
/** Road signs are retroreflective: a face glows a little by day, so one in the shade still reads, and as if in the headlights at night. */
const DAY_GLOW = 0.22;
const NIGHT_GLOW = 0.55;

export interface SignBoardViewOptions {
  /** Texture anisotropy for the faces (renderer capability). */
  readonly anisotropy?: number;
}

/**
 * The direction boards beside the country roads (DrivingWorld.directionBoards):
 * blue boards, green on the highway, on two grey legs, a row per place: its
 * arrow, its name in capitals and how many kilometres. `nameOf` names a row's
 * place (the entry point looks it up in the string tables). All of them are
 * two draw calls: the legs and backs, and the faces, laid out of the pieces of
 * one small sheet (signBoardImages.ts). They glow a little by day, more at
 * night (setLamps).
 */
export class SignBoardView {
  private readonly root = new Group();
  private readonly resources: { dispose(): void }[] = [];
  private readonly faceMaterial: MeshLambertMaterial | null = null;
  private level = 0;

  constructor(
    private readonly scene: Scene,
    boards: readonly DirectionBoard[],
    nameOf: (row: DirectionRow) => string,
    options: SignBoardViewOptions = {},
  ) {
    this.root.name = 'sign-boards';
    scene.add(this.root);
    if (boards.length === 0) {
      return;
    }
    const written = (row: DirectionRow): string => nameOf(row).toLocaleUpperCase('en');
    const namesByTone = new Map<BoardTone, string[]>();
    for (const board of boards) {
      const names = namesByTone.get(board.tone) ?? [];
      names.push(...board.rows.map(written));
      namesByTone.set(board.tone, names);
    }
    const sheet = signBoardSheet(namesByTone);
    const texture = this.track(toTexture(signBoardImage(sheet), { anisotropy: options.anisotropy ?? 1 }));
    this.faceMaterial = this.track(
      new MeshLambertMaterial({ map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: DAY_GLOW }),
    );

    const frames: BufferGeometry[] = [];
    const faces = new FaceBuilder(sheet);
    const placement = new Matrix4();
    const rotation = new Quaternion();
    const up = new Vector3(0, 1, 0);
    for (const board of boards) {
      placement.compose(new Vector3(board.x, 0, board.z), rotation.setFromAxisAngle(up, board.heading), new Vector3(1, 1, 1));
      frames.push(frameGeometry(board.rows.length).applyMatrix4(placement));
      faces.addBoard(board, board.rows.map(written), placement);
    }
    const frame = this.track(mergeGeometries(frames));
    for (const part of frames) {
      part.dispose();
    }
    const framesMesh = new Mesh(frame, this.track(new MeshLambertMaterial({ vertexColors: true })));
    framesMesh.name = 'sign-boards:frames';
    const facesMesh = new Mesh(this.track(faces.build()), this.faceMaterial);
    facesMesh.name = 'sign-boards:faces';
    this.root.add(framesMesh, facesMesh);
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

  /** Remembers a GPU resource so dispose() can release it. */
  private track<T extends { dispose(): void }>(resource: T): T {
    this.resources.push(resource);
    return resource;
  }
}

/** A board's height with `rows` rows. */
export function boardHeight(rows: number): number {
  return 2 * RIM + 2 * PAD + rows * ROW_HEIGHT;
}

/** A board's back and legs at the origin, facing +z: the legs either side (where directionBoardLegs puts them), behind the board. */
function frameGeometry(rows: number): BufferGeometry {
  const height = boardHeight(rows);
  const top = BOARD_BOTTOM + height;
  const [left, right] = directionBoardLegs({ x: 0, z: 0, heading: 0, tone: 'blue', rows: [] });
  const parts: [BufferGeometry, number][] = [
    ...[left!, right!].map((leg): [BufferGeometry, number] => [
      // Square and open at the ends: eight triangles, its foot in the ground and its top behind the board.
      new CylinderGeometry(LEG_SIZE / Math.SQRT2, LEG_SIZE / Math.SQRT2, top, 4, 1, true)
        .rotateY(Math.PI / 4)
        .translate(leg.x, top / 2, -BOARD_DEPTH - LEG_SIZE / 2),
      LEG_COLOR,
    ]),
    [new BoxGeometry(DIRECTION_BOARD_WIDTH_METERS, height, BOARD_DEPTH).translate(0, BOARD_BOTTOM + height / 2, -BOARD_DEPTH / 2), BACK_COLOR],
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

/**
 * The boards' faces, quad by quad, into one geometry: each quad a piece of
 * the sheet, just in front of the board's back. They tile the face, so none
 * lies over another.
 */
class FaceBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];
  private readonly indices: number[] = [];
  private readonly corner = new Vector3();
  private readonly normal = new Vector3();

  constructor(private readonly sheet: SignBoardSheet) {}

  /** `board`'s face, placed by `placement`, its rows' names written `names`. */
  addBoard(board: DirectionBoard, names: readonly string[], placement: Matrix4): void {
    const cells = this.sheet.tones.get(board.tone)!;
    const half = DIRECTION_BOARD_WIDTH_METERS / 2;
    const height = boardHeight(board.rows.length);
    const bottom = BOARD_BOTTOM;
    const top = bottom + height;
    const white = this.sheet.white;
    // The rim, then the board's colour above the first row and below the last.
    this.quad(-half, bottom, half, bottom + RIM, white, placement);
    this.quad(-half, top - RIM, half, top, white, placement);
    this.quad(-half, bottom + RIM, -half + RIM, top - RIM, white, placement);
    this.quad(half - RIM, bottom + RIM, half, top - RIM, white, placement);
    this.quad(-half + RIM, top - RIM - PAD, half - RIM, top - RIM, cells.plain, placement);
    this.quad(-half + RIM, bottom + RIM, half - RIM, bottom + RIM + PAD, cells.plain, placement);
    board.rows.forEach((row, index) => {
      const rowTop = top - RIM - PAD - index * ROW_HEIGHT;
      this.row(row, names[index]!, cells, -half + RIM, rowTop - ROW_HEIGHT, rowTop, placement);
    });
  }

  /** The finished geometry. */
  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(this.normals), 3));
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(this.uvs), 2));
    geometry.setIndex(this.indices);
    return geometry;
  }

  /** A row across from `left`, between `bottom` and `top`: the arrow, the name and the distance. */
  private row(row: DirectionRow, name: string, cells: ToneCells, left: number, bottom: number, top: number, placement: Matrix4): void {
    let x = left;
    const piece = (width: number, cell: PixelRect): void => {
      this.quad(x, bottom, x + width, top, cell, placement);
      x += width;
    };
    piece(LEAD, cells.plain);
    piece(ROW_HEIGHT, row.arrow === null ? cells.plain : cells.arrows[row.arrow]);
    piece(GAP, cells.plain);
    piece(NAME_WIDTH, cells.names.get(name)!);
    const kilometers = Math.min(99, row.kilometers);
    piece(DIGIT_WIDTH, kilometers >= 10 ? cells.digits[Math.floor(kilometers / 10)]! : cells.plain);
    piece(DIGIT_WIDTH, cells.digits[kilometers % 10]!);
    piece(TAIL, cells.plain);
  }

  /** A quad from (x0, y0) to (x1, y1) on the face (z just in front of the back), showing `cell`. */
  private quad(x0: number, y0: number, x1: number, y1: number, cell: PixelRect, placement: Matrix4): void {
    const { width, height } = this.sheet;
    // A narrow cell (a swatch) is sampled in its middle only.
    const swatch = cell.width <= 16;
    const u0 = swatch ? (cell.x + cell.width / 2) / width : (cell.x + 0.5) / width;
    const u1 = swatch ? u0 : (cell.x + cell.width - 0.5) / width;
    const v0 = (cell.y + 0.5) / height;
    const v1 = (cell.y + cell.height - 0.5) / height;
    const base = this.positions.length / 3;
    this.normal.set(0, 0, 1).transformDirection(placement);
    for (const [x, y, u, v] of [
      [x0, y0, u0, v0],
      [x1, y0, u1, v0],
      [x1, y1, u1, v1],
      [x0, y1, u0, v1],
    ] as const) {
      this.corner.set(x, y, 0.004).applyMatrix4(placement);
      this.positions.push(this.corner.x, this.corner.y, this.corner.z);
      this.normals.push(this.normal.x, this.normal.y, this.normal.z);
      this.uvs.push(u, v);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}
