import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Vector2,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  PARK_FOUNTAIN_RADIUS_METERS,
  PARK_PATH_WIDTH_METERS,
  PARK_PLAZA_RADIUS_METERS,
  type Park,
  type ParkLine,
} from '../../domain/world/parks';
import { gravelImage } from '../textures/proceduralImages';
import { toTexture } from '../textures/toTexture';
import type { SkyUniforms } from './EnvironmentView';
import { flatGroundLight, type PrelitMaterials } from './lighting';
import { groundTint } from './TrackView';
import { createWaterMaterial } from './waterMaterial';

/** The lawn is mown in stripes this wide along the park's length, alternately lighter and darker. */
const STRIPE_METERS = 3;
const STRIPE_SHADES = [1.07, 0.93] as const;
/** The lawn's grass: greener and more even than the fields'. */
const LAWN_TINT = new Color(0.86, 1.06, 0.8);
/** Layers flat on the ground, each a little higher: the lawn, then the gravel (roads' shoulders lie at 0.01). */
const LAWN_Y = 0.004;
const GRAVEL_Y = 0.007;
const GRAVEL_TILE_METERS = 2.5;
const GRAVEL_TINT = 0xd8cfbd;
/** The hedge: how thick and tall, meters, and its green. */
const HEDGE_THICKNESS_METERS = 0.9;
const HEDGE_HEIGHT_METERS = 1.1;
const HEDGE_GREEN = 0x3d6a35;
/** The fountain: its stone, and its water's own colour and height in the basin, meters. */
const STONE = 0xcfc8b8;
const FOUNTAIN_WATER = 0x2b6f7c;
const WATER_LEVEL_METERS = 0.42;
/** The basin's profile, from the ground out and over its rim to the water inside ([radius, height], meters). */
const BASIN_WALL = 0.28;
const BASIN_PROFILE: readonly (readonly [number, number])[] = [
  [PARK_FOUNTAIN_RADIUS_METERS, 0],
  [PARK_FOUNTAIN_RADIUS_METERS, 0.5],
  [PARK_FOUNTAIN_RADIUS_METERS - 0.05, 0.58],
  [PARK_FOUNTAIN_RADIUS_METERS - BASIN_WALL, 0.58],
  [PARK_FOUNTAIN_RADIUS_METERS - BASIN_WALL, WATER_LEVEL_METERS - 0.1],
];
/** Its middle: a column holding a bowl up, and a knob on top ([radius, height], meters, from the water). */
const COLUMN_PROFILE: readonly (readonly [number, number])[] = [
  [0.34, WATER_LEVEL_METERS - 0.1],
  [0.3, 0.9],
  [0.2, 1.15],
  [0.25, 1.22],
  [0.85, 1.32],
  [0.9, 1.42],
  [0.8, 1.44],
  [0.16, 1.44],
  [0.16, 1.62],
  [0.24, 1.72],
  [0.12, 1.86],
  [0, 1.9],
];

export interface ParkViewOptions {
  /** The sky the fountains' water mirrors (EnvironmentView.sky). */
  readonly sky: SkyUniforms;
  /**
   * A material like the ground's (TrackView.createGroundMaterial(), a new
   * one: it is lifted over the ground here), for the lawns: they follow the
   * seasons.
   */
  readonly lawnMaterial: MeshBasicMaterial;
  /** The ground plane's width (TrackView.groundSizeMeters), so the lawns' grass lines up with the fields'. */
  readonly groundSizeMeters: number;
  readonly anisotropy?: number;
  /** Where the pre-lit gravel registers, to follow the weather's light. */
  readonly prelit?: PrelitMaterials;
}

/**
 * The towns' parks (DrivingWorld.parks): lawns mown in stripes, gravel
 * paths meeting on a round plaza, a clipped hedge round each (open where
 * the paths come in), and a stone fountain in each plaza, its water
 * mirroring the sky like the sea's (waterMaterial). Their trees, benches,
 * bins and lamps are the world's, drawn with the others' (TrackView,
 * SceneryView, StreetLampView). Five draw calls for all the parks.
 * update() runs every frame and allocates nothing.
 */
export class ParkView {
  private readonly root = new Group();
  private readonly resources: { dispose(): void }[] = [];
  private readonly time = { value: 0 };

  constructor(
    private readonly scene: Scene,
    parks: readonly Park[],
    options: ParkViewOptions,
  ) {
    this.root.name = 'parks';
    if (parks.length > 0) {
      const lawnMaterial = options.lawnMaterial;
      // Over the ground plane it lies on, under the gravel.
      lawnMaterial.polygonOffset = true;
      lawnMaterial.polygonOffsetFactor = -1;
      lawnMaterial.polygonOffsetUnits = -2;
      const lawns = new Mesh(this.merged(parks.map((park) => lawnGeometry(park, options.groundSizeMeters))), lawnMaterial);
      lawns.name = 'park-lawns';

      const gravelMap = this.track(toTexture(gravelImage(), { repeat: true, anisotropy: options.anisotropy ?? 1 }));
      const gravelMaterial = this.track(
        new MeshBasicMaterial({
          map: gravelMap,
          color: new Color(GRAVEL_TINT).multiply(flatGroundLight()),
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -4,
        }),
      );
      options.prelit?.add(gravelMaterial);
      const gravel = new Mesh(this.merged(parks.flatMap(gravelGeometry)), gravelMaterial);
      gravel.name = 'park-paths';

      const hedges = new Mesh(
        this.merged(parks.flatMap((park) => park.hedges.map(hedgeGeometry))),
        this.track(new MeshLambertMaterial({ color: HEDGE_GREEN, flatShading: true })),
      );
      hedges.name = 'park-hedges';

      const stone = new Mesh(
        this.merged(parks.flatMap(fountainStoneGeometry)),
        this.track(new MeshLambertMaterial({ color: STONE, flatShading: true })),
      );
      stone.name = 'park-fountains';

      const water = new Mesh(
        this.merged(parks.map(fountainWaterGeometry)),
        this.track(createWaterMaterial({ sky: options.sky, time: this.time, deepColor: FOUNTAIN_WATER })),
      );
      water.name = 'park-fountain-water';
      this.root.add(lawns, gravel, hedges, stone, water);
    }
    scene.add(this.root);
  }

  /** Moves the fountains' ripples `deltaSeconds` on. Allocation-free. */
  update(deltaSeconds: number): void {
    // Wrapped so the ripples keep their precision; the jump every hour is lost in them.
    this.time.value = (this.time.value + deltaSeconds) % 3600;
  }

  dispose(): void {
    this.scene.remove(this.root);
    for (const resource of this.resources) {
      resource.dispose();
    }
  }

  private merged(parts: BufferGeometry[]): BufferGeometry {
    const geometry = this.track(mergeGeometries(parts));
    for (const part of parts) {
      part.dispose();
    }
    return geometry;
  }

  private track<T extends { dispose(): void }>(resource: T): T {
    this.resources.push(resource);
    return resource;
  }
}

/**
 * A park's lawn: its rectangle in strips along its length, each strip's
 * vertices shaded lighter or darker by turns (mown stripes), the ground's
 * grass mapped as the ground maps it, tinted greener.
 */
function lawnGeometry(park: Park, groundSize: number): BufferGeometry {
  const { area } = park;
  const strips = Math.max(1, Math.round(area.widthMeters / STRIPE_METERS));
  const heading = (area.headingDegrees * Math.PI) / 180;
  const alongX = Math.sin(heading);
  const alongZ = Math.cos(heading);
  const acrossX = Math.cos(heading);
  const acrossZ = -Math.sin(heading);
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const tint = new Color();
  for (let strip = 0; strip < strips; strip++) {
    const shade = STRIPE_SHADES[strip % 2]!;
    const start = positions.length / 3;
    for (const u of [strip / strips - 0.5, (strip + 1) / strips - 0.5]) {
      for (const v of [-0.5, 0.5]) {
        const x = area.x + acrossX * u * area.widthMeters + alongX * v * area.lengthMeters;
        const z = area.z + acrossZ * u * area.widthMeters + alongZ * v * area.lengthMeters;
        positions.push(x, LAWN_Y, z);
        uvs.push(0.5 + x / groundSize, 0.5 - z / groundSize);
        groundTint(x, z, tint).multiply(LAWN_TINT).multiplyScalar(shade);
        colors.push(tint.r, tint.g, tint.b);
      }
    }
    // Corners: 0 (left, back), 1 (left, front), 2 (right, back), 3 (right, front).
    indices.push(start, start + 2, start + 1, start + 1, start + 2, start + 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  geometry.setIndex(indices);
  return faceUp(geometry);
}

/** A park's paths and plaza, flat gravel, the texture in tiles of GRAVEL_TILE_METERS. */
function gravelGeometry(park: Park): BufferGeometry[] {
  const parts = park.paths.map(({ a, b }) => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const plane = new PlaneGeometry(PARK_PATH_WIDTH_METERS, length);
    tileUvs(plane, PARK_PATH_WIDTH_METERS, length);
    // Laid flat along a → b: its length (plane's +y) turned to the path's heading.
    plane.rotateX(-Math.PI / 2);
    plane.rotateY(Math.atan2(b[0] - a[0], b[1] - a[1]) + Math.PI);
    plane.translate((a[0] + b[0]) / 2, GRAVEL_Y, (a[1] + b[1]) / 2);
    return plane.toNonIndexed();
  });
  const plaza = new CircleGeometry(PARK_PLAZA_RADIUS_METERS, 28);
  tileUvs(plaza, PARK_PLAZA_RADIUS_METERS * 2, PARK_PLAZA_RADIUS_METERS * 2);
  plaza.rotateX(-Math.PI / 2);
  // A hair above the paths, so the two never fight where they overlap.
  plaza.translate(park.area.x, GRAVEL_Y + 0.001, park.area.z);
  parts.push(plaza.toNonIndexed());
  return parts;
}

/** A run of hedge: a box along a → b, its ends squared. */
function hedgeGeometry({ a, b }: ParkLine): BufferGeometry {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const geometry = boxGeometry(HEDGE_THICKNESS_METERS, HEDGE_HEIGHT_METERS, length + HEDGE_THICKNESS_METERS);
  geometry.rotateY(Math.atan2(b[0] - a[0], b[1] - a[1]));
  geometry.translate((a[0] + b[0]) / 2, HEDGE_HEIGHT_METERS / 2, (a[1] + b[1]) / 2);
  return geometry;
}

/** The fountain's stone: its basin, and the column and bowl in its middle. */
function fountainStoneGeometry(park: Park): BufferGeometry[] {
  const { x, z } = park.fountain;
  return [BASIN_PROFILE, COLUMN_PROFILE].map((profile) => {
    const lathe = new LatheGeometry(
      profile.map(([radius, height]) => new Vector2(radius, height)),
      20,
    );
    lathe.translate(x, 0, z);
    return lathe.toNonIndexed();
  });
}

/** The water in a fountain's basin: a disc, its foam (the `shore` attribute) lapping at the stone. */
function fountainWaterGeometry(park: Park): BufferGeometry {
  const radius = PARK_FOUNTAIN_RADIUS_METERS - BASIN_WALL;
  const disc = new CircleGeometry(radius, 24);
  disc.rotateX(-Math.PI / 2);
  disc.translate(park.fountain.x, WATER_LEVEL_METERS, park.fountain.z);
  const position = disc.getAttribute('position');
  const shore = new Float32Array(position.count);
  for (let i = 0; i < position.count; i++) {
    shore[i] = Math.max(0, radius - Math.hypot(position.getX(i) - park.fountain.x, position.getZ(i) - park.fountain.z)) * 2;
  }
  disc.setAttribute('shore', new BufferAttribute(shore, 1));
  disc.deleteAttribute('normal');
  disc.deleteAttribute('uv');
  return disc;
}

/** Rescales a flat geometry's 0..1 uvs to tiles of GRAVEL_TILE_METERS over `width` × `length` meters. */
function tileUvs(geometry: BufferGeometry, width: number, length: number): void {
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) * width) / GRAVEL_TILE_METERS, (uv.getY(i) * length) / GRAVEL_TILE_METERS);
  }
}

/** A box `width` (x) × `height` (y) × `depth` (z) centred on the origin, flat-shaded, without uvs. */
function boxGeometry(width: number, height: number, depth: number): BufferGeometry {
  const hx = width / 2;
  const hy = height / 2;
  const hz = depth / 2;
  const corners = [
    [-hx, -hy, -hz],
    [hx, -hy, -hz],
    [hx, hy, -hz],
    [-hx, hy, -hz],
    [-hx, -hy, hz],
    [hx, -hy, hz],
    [hx, hy, hz],
    [-hx, hy, hz],
  ] as const;
  // Each face's corners counter-clockwise seen from outside; no bottom, it stands on the ground.
  const faces = [
    [4, 5, 6, 7],
    [1, 0, 3, 2],
    [5, 1, 2, 6],
    [0, 4, 7, 3],
    [7, 6, 2, 3],
  ] as const;
  const positions: number[] = [];
  for (const [a, b, c, d] of faces) {
    for (const corner of [a, b, c, a, c, d]) {
      positions.push(...corners[corner]);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Makes sure a flat, indexed geometry's triangles face up (+y), flipping them if not. */
function faceUp(geometry: BufferGeometry): BufferGeometry {
  const index = geometry.getIndex()!;
  const position = geometry.getAttribute('position');
  const [a, b, c] = [index.getX(0), index.getX(1), index.getX(2)];
  const abx = position.getX(b) - position.getX(a);
  const abz = position.getZ(b) - position.getZ(a);
  const acx = position.getX(c) - position.getX(a);
  const acz = position.getZ(c) - position.getZ(a);
  // The cross product's y: positive when a → b → c turns counter-clockwise seen from above.
  if (abz * acx - abx * acz < 0) {
    for (let i = 0; i < index.count; i += 3) {
      const second = index.getX(i + 1);
      index.setX(i + 1, index.getX(i + 2));
      index.setX(i + 2, second);
    }
  }
  return geometry.toNonIndexed();
}
