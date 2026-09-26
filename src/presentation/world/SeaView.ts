import {
  BufferAttribute,
  BufferGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
  type Scene,
} from 'three';
import { shorelineXAt, type Point2 } from '../../data/definitions/MapDefinition';
import type { Sea, ShoreRock } from '../../domain/world/DrivingWorld';
import type { RiverPath } from '../../domain/world/RiverPath';
import { sandImage } from '../textures/proceduralImages';
import { toTexture } from '../textures/toTexture';
import type { SkyUniforms } from './EnvironmentView';
import { flatGroundLight, type PrelitMaterials } from './lighting';
import { createWaterMaterial } from './waterMaterial';

/** The water reaches this far past the map edge, like the ground (TrackView), so it fades into the haze. */
const FAR_METERS = 1400;
/**
 * The water's mesh runs in rows parallel to the shore, this far out: close
 * together near it, where the foam is, then further apart.
 */
const ROW_OFFSETS_METERS = [0, 1.5, 4, 12, 40, 150] as const;
/** Just over the grass, under the roads (TrackView's layers). */
const WATER_Y = 0.015;
/** The water's own colour, deep blue-green, before the sky's reflection. */
const DEEP_WATER = 0x1a5566;
/** The beach along the natural shore: its width, and how big one texture tile of sand is. */
const BEACH_WIDTH_METERS = 9;
const SAND_TILE_METERS = 6;
const BEACH_Y = 0.008;
/** The beach stops this far short of a river's mouth either side, meters. */
const MOUTH_BEACH_GAP_METERS = 2;
/** Boulders at the waterline are cut into tiles this long along the shore, so those out of view are not drawn. */
const ROCK_TILE_METERS = 600;
const ROCK_COLOR = 0x817a70;

export interface SeaViewOptions {
  /** Texture anisotropy for the beach (renderer capability). */
  readonly anisotropy?: number;
  /** Where the pre-lit beach registers, to follow the weather's light. */
  readonly prelit?: PrelitMaterials;
  /** The rivers: where one flows into the sea the beach breaks for its mouth. */
  readonly rivers?: readonly RiverPath[];
}

/**
 * The sea along the map's west edge (DrivingWorld.sea): the water, a sandy
 * beach along the natural shore and boulders at the waterline. The water
 * mirrors the sky it is given (EnvironmentView.sky), so it follows the
 * weather and the time of day: small waves drift across it, the sky
 * shows in it more at grazing angles, the sun (at night the moon)
 * glitters on it, sparkling in a path toward it when it is low, and foam
 * breaks along the shore. It is fogged like the rest of the scene. The
 * quays, cranes and boats are HarbourView's. One draw call for the water,
 * one for the beach, one per stretch of boulders in view. update() runs
 * every frame and allocates nothing.
 */
export class SeaView {
  private readonly root = new Group();
  private readonly resources: { dispose(): void }[] = [];
  private readonly time = { value: 0 };

  constructor(
    private readonly scene: Scene,
    sea: Sea,
    halfSizeMeters: number,
    sky: SkyUniforms,
    options: SeaViewOptions = {},
  ) {
    this.root.name = 'sea';
    this.root.add(this.createWater(sea.shoreline, halfSizeMeters, sky));
    const beach = this.createBeach(sea, halfSizeMeters, options);
    if (beach !== null) {
      this.root.add(beach);
    }
    this.root.add(...this.createRocks(sea, halfSizeMeters));
    scene.add(this.root);
  }

  /** Moves the waves and the foam `deltaSeconds` on. Allocation-free. */
  update(deltaSeconds: number): void {
    // Wrapped so the waves keep their precision; the jump every hour is lost in the ripples.
    this.time.value = (this.time.value + deltaSeconds) % 3600;
  }

  dispose(): void {
    this.scene.remove(this.root);
    for (const resource of this.resources) {
      resource.dispose();
    }
  }

  /**
   * Rows of vertices along the shore, from the waterline out to past the map
   * edge; each knows how far out it is (`shore`, meters), for the foam.
   */
  private createWater(shoreline: readonly Point2[], halfSize: number, sky: SkyUniforms): Mesh {
    const far = halfSize + FAR_METERS;
    const first = shoreline[0]!;
    const last = shoreline[shoreline.length - 1]!;
    const line: Point2[] = [[first[0], -far], ...shoreline, [last[0], far]];
    const rows = [...ROW_OFFSETS_METERS, Number.POSITIVE_INFINITY];
    const positions = new Float32Array(rows.length * line.length * 3);
    const shore = new Float32Array(rows.length * line.length);
    rows.forEach((offset, row) => {
      line.forEach(([x, z], i) => {
        const v = row * line.length + i;
        positions.set([Math.max(-far, x - offset), 0, z], v * 3);
        shore[v] = Math.min(offset, far);
      });
    });
    const indices: number[] = [];
    for (let row = 0; row < rows.length - 1; row++) {
      for (let i = 0; i < line.length - 1; i++) {
        const a = row * line.length + i;
        const b = a + 1;
        const c = a + line.length;
        const d = c + 1;
        // Wound to face up: the next row lies west, the next point south.
        indices.push(a, c, b, b, c, d);
      }
    }
    const geometry = this.track(new BufferGeometry());
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('shore', new BufferAttribute(shore, 1));
    geometry.setIndex(indices);
    geometry.translate(0, WATER_Y, 0);
    const material = this.track(createWaterMaterial({ sky, time: this.time, deepColor: DEEP_WATER }));
    const water = new Mesh(geometry, material);
    water.name = 'water';
    return water;
  }

  /** A strip of sand along the natural shore, broken where the quays are. Pre-lit like the ground. */
  private createBeach(sea: Sea, halfSize: number, options: SeaViewOptions): Mesh | null {
    const stretches = openShore(sea, halfSize, riverMouths(options.rivers ?? []));
    if (stretches.length === 0) {
      return null;
    }
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (const [fromZ, toZ] of stretches) {
      const zs = [fromZ, ...sea.shoreline.map(([, z]) => z).filter((z) => z > fromZ && z < toZ), toZ];
      const start = positions.length / 3;
      for (const z of zs) {
        const x = shorelineXAt(sea.shoreline, z);
        for (const across of [0, BEACH_WIDTH_METERS]) {
          positions.push(x + across, BEACH_Y, z);
          uvs.push((x + across) / SAND_TILE_METERS, z / SAND_TILE_METERS);
        }
      }
      for (let i = 0; i < zs.length - 1; i++) {
        const a = start + i * 2;
        // a: the waterline, a + 1 inland; the next pair lies south. Wound to face up.
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geometry = this.track(new BufferGeometry());
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    geometry.setIndex(indices);
    const sand = this.track(toTexture(sandImage(), { repeat: true, anisotropy: options.anisotropy ?? 1 }));
    const material = this.track(
      new MeshBasicMaterial({
        map: sand,
        color: flatGroundLight(),
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
    options.prelit?.add(material);
    const beach = new Mesh(geometry, material);
    beach.name = 'beach';
    return beach;
  }

  /** The boulders at the waterline, instanced, one mesh per ROCK_TILE_METERS of shore. */
  private createRocks(sea: Sea, halfSize: number): InstancedMesh[] {
    const tiles = new Map<number, ShoreRock[]>();
    for (const rock of sea.rocks) {
      const tile = Math.floor((rock.z + halfSize) / ROCK_TILE_METERS);
      const rocks = tiles.get(tile);
      if (rocks === undefined) {
        tiles.set(tile, [rock]);
      } else {
        rocks.push(rock);
      }
    }
    if (tiles.size === 0) {
      return [];
    }
    const geometry = this.track(new IcosahedronGeometry(0.5, 0));
    const material = this.track(new MeshLambertMaterial({ color: ROCK_COLOR, flatShading: true }));
    const matrix = new Matrix4();
    const where = new Vector3();
    const turn = new Quaternion();
    const size = new Vector3();
    const up = new Vector3(0, 1, 0);
    return [...tiles.values()].map((rocks) => {
      const mesh = this.track(new InstancedMesh(geometry, material, rocks.length));
      rocks.forEach((rock, index) => {
        where.set(rock.x, rock.size * 0.12, rock.z);
        turn.setFromAxisAngle(up, rock.turn);
        size.set(rock.size, rock.size * 0.55, rock.size * 0.8);
        mesh.setMatrixAt(index, matrix.compose(where, turn, size));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      return mesh;
    });
  }

  private track<T extends { dispose(): void }>(resource: T): T {
    this.resources.push(resource);
    return resource;
  }
}

/** The stretches of shore between the quays, [fromZ, toZ], from the map's north edge to its south edge. */
/** Where each river that reaches the sea crosses the shore: the stretch of it (z) its opening takes, and a little more. */
function riverMouths(rivers: readonly RiverPath[]): { fromZ: number; toZ: number }[] {
  return rivers
    .filter((river) => river.mouthIndex < river.pointCount)
    .map((river) => {
      const mouth = river.mouthIndex;
      const reach = (river.openingHalfWidthMeters + MOUTH_BEACH_GAP_METERS) / Math.max(0.3, Math.abs(river.directionX(mouth)));
      return { fromZ: river.z(mouth) - reach, toZ: river.z(mouth) + reach };
    });
}

function openShore(sea: Sea, halfSize: number, mouths: readonly { fromZ: number; toZ: number }[]): [number, number][] {
  const quays = [...sea.quays, ...mouths].sort((a, b) => a.fromZ - b.fromZ);
  const stretches: [number, number][] = [];
  let from = -halfSize;
  for (const quay of quays) {
    if (quay.fromZ > from) {
      stretches.push([from, quay.fromZ]);
    }
    from = Math.max(from, quay.toZ);
  }
  if (from < halfSize) {
    stretches.push([from, halfSize]);
  }
  return stretches;
}
