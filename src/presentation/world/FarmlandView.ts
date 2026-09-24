import {
  BufferAttribute,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { FieldCrop } from '../../data/definitions/MapDefinition';
import type { Field, HayBale } from '../../domain/world/DrivingWorld';
import { fieldRowsImage } from '../textures/proceduralImages';
import { toTexture } from '../textures/toTexture';
import { placeFlat } from './groundDecals';
import { flatGroundLight, type PrelitMaterials } from './lighting';

/** Fields lie on the grass, under everything else on the ground (see TrackView's layers). */
const FIELD_Y = 0.006;
/** One tile of the rows texture (four rows) spans this many meters across the rows, and this many along them. */
const ROW_TILE_METERS = 3.2;
const ROW_TILE_LENGTH_METERS = 16;
/** Each crop's colour, multiplying the grey rows. */
const CROP_TINTS: Readonly<Record<FieldCrop, number>> = {
  wheat: 0xe9c35e,
  stubble: 0xd9c98e,
  green: 0x86b852,
  ploughed: 0x8f6a4c,
};
/** A round bale: its radius and width (along its axis), and the straw's colour. */
const BALE_RADIUS = 0.75;
const BALE_WIDTH = 1.3;
const BALE_COLOR = 0xd4b264;

export interface FarmlandViewOptions {
  /** Texture anisotropy for the fields (renderer capability): they are seen at grazing angles. */
  readonly anisotropy?: number;
  /** Where the pre-lit fields register, to follow the weather's light. */
  readonly prelit?: PrelitMaterials;
}

/**
 * The farm fields and the hay bales on the harvested ones. The fields are
 * flat, pre-lit like the grass: one texture of crop rows, tinted per field
 * by its crop, all in one draw call. The bales are instanced: one more.
 */
export class FarmlandView {
  private readonly root = new Group();
  private readonly resources: { dispose(): void }[] = [];

  constructor(
    private readonly scene: Scene,
    fields: readonly Field[],
    bales: readonly HayBale[],
    options: FarmlandViewOptions = {},
  ) {
    this.root.name = 'farmland';
    if (fields.length > 0) {
      const rows = this.track(toTexture(fieldRowsImage(), { repeat: true, anisotropy: options.anisotropy ?? 1 }));
      const material = this.track(
        new MeshBasicMaterial({
          map: rows,
          vertexColors: true,
          color: flatGroundLight(),
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        }),
      );
      options.prelit?.add(material);
      const parts = fields.map(fieldGeometry);
      const geometry = this.track(mergeGeometries(parts));
      for (const part of parts) {
        part.dispose();
      }
      this.root.add(new Mesh(geometry, material));
    }
    if (bales.length > 0) {
      this.root.add(this.createBales(bales));
    }
    scene.add(this.root);
  }

  dispose(): void {
    this.scene.remove(this.root);
    for (const resource of this.resources) {
      resource.dispose();
    }
  }

  /** Round bales lying on their side along their heading, each a slightly different shade. */
  private createBales(bales: readonly HayBale[]): InstancedMesh {
    const geometry = this.track(
      new CylinderGeometry(BALE_RADIUS, BALE_RADIUS, BALE_WIDTH, 12).rotateX(Math.PI / 2).translate(0, BALE_RADIUS, 0),
    );
    const mesh = this.track(
      new InstancedMesh(geometry, this.track(new MeshLambertMaterial({ color: 0xffffff })), bales.length),
    );
    mesh.name = 'hay-bales';
    const matrix = new Matrix4();
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3(1, 1, 1);
    const up = new Vector3(0, 1, 0);
    const color = new Color();
    bales.forEach((bale, index) => {
      rotation.setFromAxisAngle(up, bale.heading);
      mesh.setMatrixAt(index, matrix.compose(position.set(bale.x, 0, bale.z), rotation, scale));
      mesh.setColorAt(index, color.setHex(BALE_COLOR).multiplyScalar(0.88 + 0.24 * ((index * 0.618) % 1)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.needsUpdate = true;
    mesh.computeBoundingSphere();
    return mesh;
  }

  /** Remembers a GPU resource so dispose() can release it. */
  private track<T extends { dispose(): void }>(resource: T): T {
    this.resources.push(resource);
    return resource;
  }
}

/** A field flat on the ground, the rows running along its heading, tinted with its crop's colour. */
function fieldGeometry(field: Field): BufferGeometry {
  const { area } = field;
  const geometry = new PlaneGeometry(area.widthMeters, area.lengthMeters);
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(
      i,
      (uv.getX(i) * area.widthMeters) / ROW_TILE_METERS,
      (uv.getY(i) * area.lengthMeters) / ROW_TILE_LENGTH_METERS,
    );
  }
  const tint = new Color(CROP_TINTS[field.crop]);
  const colors = new Float32Array(uv.count * 3);
  for (let i = 0; i < uv.count; i++) {
    colors.set([tint.r, tint.g, tint.b], i * 3);
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return placeFlat(geometry, area, FIELD_Y);
}
