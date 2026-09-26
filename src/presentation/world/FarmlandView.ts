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
import { SEASON_GLSL, type SeasonShading } from './SeasonShading';

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
  /** The seasons: young crops in spring, the harvest in autumn, snow over the ploughland in winter. */
  readonly seasons?: SeasonShading;
}

/**
 * The fields through the year, a field at a time (its seed, 0..1): in
 * spring most are young and green, the rest ploughed; in summer they grow
 * as the map sows them; in autumn most are stubble or ploughed after the
 * harvest; in winter all lie ploughed, under the snow that lies (in the
 * rows' furrows first). Linear colours of CROP_TINTS'.
 */
const FIELD_SEASONS_VERTEX = /* glsl */ `
#include <begin_vertex>
vFieldSeed = fieldSeed;
`;
const FIELD_SEASONS_FRAGMENT = /* glsl */ `
{
  const vec3 GREEN = vec3( 0.24, 0.48, 0.087 );
  const vec3 STUBBLE = vec3( 0.69, 0.58, 0.27 );
  const vec3 PLOUGHED = vec3( 0.27, 0.14, 0.07 );
  vec3 spring = vFieldSeed < 0.7 ? GREEN : PLOUGHED;
  vec3 autumn = vFieldSeed < 0.45 ? STUBBLE : vFieldSeed < 0.8 ? PLOUGHED : GREEN;
  vec3 crop = spring * seasonWeights.x + vColor.rgb * seasonWeights.y + autumn * seasonWeights.z + PLOUGHED * seasonWeights.w;
  diffuseColor.rgb *= crop;
  float furrow = 1.0 - texture2D( map, vMapUv ).r;
  float fieldSnow = smoothstep( 0.15, 0.55, snowCover + furrow * 0.35 - 0.15 ) * min( 1.0, snowCover * 10.0 );
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuse * SNOW, fieldSnow );
}
`;

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
      const seasons = options.seasons;
      if (seasons !== undefined) {
        material.onBeforeCompile = (shader) => {
          seasons.attach(shader);
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nattribute float fieldSeed;\nvarying float vFieldSeed;')
            .replace('#include <begin_vertex>', FIELD_SEASONS_VERTEX);
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>\n${SEASON_GLSL}\nvarying float vFieldSeed;`)
            .replace('#include <color_fragment>', FIELD_SEASONS_FRAGMENT);
        };
        material.customProgramCacheKey = () => 'fields|seasons';
      }
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
  // Which crops the field grows through the year (FIELD_SEASONS_FRAGMENT): the same for the field every time.
  const seed = hash(area.x, area.z);
  geometry.setAttribute('fieldSeed', new BufferAttribute(new Float32Array(uv.count).fill(seed), 1));
  return placeFlat(geometry, area, FIELD_Y);
}

/** A small, stable hash of two coordinates, 0..1. */
function hash(a: number, b: number): number {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return s - Math.floor(s);
}
