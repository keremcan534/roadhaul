import { BoxGeometry, BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, MeshLambertMaterial, type Scene } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { DrivingWorld } from '../../domain/world/DrivingWorld';
import type { RoadPath } from '../../domain/world/RoadPath';

/** The deck's depth under the road, its fascia's reach past the road's edge, meters. */
const DECK_DEPTH_METERS = 1.4;
const FASCIA_OUT_METERS = 0.7;
/** Its parapets: where they stand past the road's edge (DrivingWorld's deck walls), how tall and thick. */
const PARAPET_OUT_METERS = 0.4;
const PARAPET_HEIGHT_METERS = 1.05;
const PARAPET_THICKNESS_METERS = 0.3;
/** A pier every this far along a deck, this thick; a wide deck stands on two. */
const PIER_SPACING_METERS = 32;
const PIER_SIZE_METERS = 1.8;
const TWIN_PIERS_FROM_METERS = 12;
/** A pier keeps this far off the edge of a road passing under the deck. */
const PIER_ROAD_CLEARANCE_METERS = 1.5;
/** Under water the piers reach this far down (the riverbed is out of sight). */
const PIER_FOOT_UNDER_WATER_METERS = 8;
const CONCRETE = 0xb9b5ad;
const UNDERSIDE = 0x8f8b84;
const PARAPET = 0xd4d0c8;

/**
 * The decks the roads are carried on (RoadDefinition.elevated: an
 * overpass, a viaduct, a bridge's approach): a concrete deck under the
 * road with its fascia either side, parapets where DrivingWorld's deck
 * walls stand, and piers down to the ground (or into the water) every
 * PIER_SPACING_METERS. One mesh for all of them, one draw call; nothing on
 * a map without decks.
 */
export class DeckView {
  readonly mesh: Mesh | null = null;
  // Both faces lit as they face: the deck's parts are seen from above and below.
  private readonly material = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });

  constructor(
    private readonly scene: Scene,
    world: DrivingWorld,
  ) {
    const geometry = deckGeometry(world);
    if (geometry !== null) {
      this.mesh = new Mesh(geometry, this.material);
      this.mesh.name = 'decks';
      this.mesh.matrixAutoUpdate = false;
      scene.add(this.mesh);
    }
  }

  dispose(): void {
    if (this.mesh !== null) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    this.material.dispose();
  }
}

/** Every deck's parts, merged, painted per vertex; null when no road is carried on one. */
export function deckGeometry(world: DrivingWorld): BufferGeometry | null {
  const parts: BufferGeometry[] = [];
  world.roads.forEach((road, roadIndex) => {
    for (const [from, to] of deckRuns(road)) {
      parts.push(
        ...deckRun(
          road,
          from,
          to,
          (x, z) => (world.isWater(x, z) ? -PIER_FOOT_UNDER_WATER_METERS : world.terrain.heightAt(x, z)),
          // Never on a road passing under it.
          (x, z) => !world.nearOtherRoad(x, z, roadIndex, PIER_ROAD_CLEARANCE_METERS),
        ),
      );
    }
  });
  if (parts.length === 0) {
    return null;
  }
  const merged = mergeGeometries(parts);
  for (const part of parts) {
    part.dispose();
  }
  return merged;
}

/** The runs of samples on decks along `road`: from a sample to the last one of the run. */
function deckRuns(road: RoadPath): [number, number][] {
  const runs: [number, number][] = [];
  let start = -1;
  for (let i = 0; i < road.pointCount; i++) {
    if (road.elevated[i] === 1 && start < 0) {
      start = i;
    } else if (road.elevated[i] !== 1 && start >= 0) {
      runs.push([start, i - 1]);
      start = -1;
    }
  }
  if (start >= 0) {
    runs.push([start, road.pointCount - 1]);
  }
  return runs.filter(([from, to]) => to > from);
}

/** One run's deck: its fascia and underside, its parapets, and its piers standing on `foot`. */
function deckRun(
  road: RoadPath,
  from: number,
  to: number,
  foot: (x: number, z: number) => number,
  free: (x: number, z: number) => boolean,
): BufferGeometry[] {
  const half = road.widthMeters / 2;
  const fascia = half + FASCIA_OUT_METERS;
  const parapet = half + PARAPET_OUT_METERS;
  const positions: number[] = [];
  const colors: number[] = [];
  const concrete = new Color(CONCRETE);
  const underside = new Color(UNDERSIDE);
  const wall = new Color(PARAPET);
  const quad = (a: number[], b: number[], c: number[], d: number[], color: Color): void => {
    for (const vertex of [a, b, c, a, c, d]) {
      positions.push(vertex[0]!, vertex[1]!, vertex[2]!);
      colors.push(color.r, color.g, color.b);
    }
  };
  for (let i = from; i < to; i++) {
    const [ax, az, arx, arz] = frame(road, i);
    const [bx, bz, brx, brz] = frame(road, i + 1);
    const ah = road.heights[i]!;
    const bh = road.heights[i + 1]!;
    for (const side of [1, -1] as const) {
      const at = (x: number, z: number, rx: number, rz: number, out: number, y: number): number[] => [x + rx * out * side, y, z + rz * out * side];
      // The fascia, from just under the road's surface to the deck's foot, facing out.
      const top = (h: number): number => h - 0.05;
      const bottom = (h: number): number => h - DECK_DEPTH_METERS;
      const outward = [at(ax, az, arx, arz, fascia, bottom(ah)), at(bx, bz, brx, brz, fascia, bottom(bh)), at(bx, bz, brx, brz, fascia, top(bh)), at(ax, az, arx, arz, fascia, top(ah))];
      if (side === 1) {
        quad(outward[0]!, outward[1]!, outward[2]!, outward[3]!, concrete);
      } else {
        quad(outward[1]!, outward[0]!, outward[3]!, outward[2]!, concrete);
      }
      // The parapet: its outer and inner faces and its top.
      const inner = parapet - PARAPET_THICKNESS_METERS / 2;
      const outer = parapet + PARAPET_THICKNESS_METERS / 2;
      const high = (h: number): number => h + PARAPET_HEIGHT_METERS;
      const wallFace = (out: number, facingOut: boolean): void => {
        const corners = [at(ax, az, arx, arz, out, ah - 0.05), at(bx, bz, brx, brz, out, bh - 0.05), at(bx, bz, brx, brz, out, high(bh)), at(ax, az, arx, arz, out, high(ah))];
        if (facingOut === (side === 1)) {
          quad(corners[0]!, corners[1]!, corners[2]!, corners[3]!, wall);
        } else {
          quad(corners[1]!, corners[0]!, corners[3]!, corners[2]!, wall);
        }
      };
      wallFace(outer, true);
      wallFace(inner, false);
      const topCorners = [at(ax, az, arx, arz, inner, high(ah)), at(bx, bz, brx, brz, inner, high(bh)), at(bx, bz, brx, brz, outer, high(bh)), at(ax, az, arx, arz, outer, high(ah))];
      if (side === 1) {
        quad(topCorners[0]!, topCorners[3]!, topCorners[2]!, topCorners[1]!, wall);
      } else {
        quad(topCorners[0]!, topCorners[1]!, topCorners[2]!, topCorners[3]!, wall);
      }
    }
    // The underside, facing down.
    const under = (x: number, z: number, rx: number, rz: number, side: number, h: number): number[] => [x + rx * fascia * side, h - DECK_DEPTH_METERS, z + rz * fascia * side];
    quad(under(ax, az, arx, arz, -1, ah), under(bx, bz, brx, brz, -1, bh), under(bx, bz, brx, brz, 1, bh), under(ax, az, arx, arz, 1, ah), underside);
  }
  const deck = new BufferGeometry();
  deck.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  deck.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  deck.computeVertexNormals();
  const parts: BufferGeometry[] = [deck];
  // The piers, along the run's middle (twin piers under a wide deck), from the ground to the deck's foot.
  const start = road.distances[from]!;
  const end = road.distances[to]!;
  const count = Math.max(1, Math.ceil((end - start) / PIER_SPACING_METERS));
  for (let k = 0; k <= count; k++) {
    const along = start + ((end - start) * k) / count;
    let i = from;
    while (i + 1 < to && road.distances[i + 1]! < along) {
      i++;
    }
    const [x, z, rx, rz] = frame(road, i);
    const h = road.heightAtDistance(along) - DECK_DEPTH_METERS;
    const offsets = road.widthMeters >= TWIN_PIERS_FROM_METERS ? [-half * 0.55, half * 0.55] : [0];
    for (const offset of offsets) {
      const px = x + rx * offset;
      const pz = z + rz * offset;
      const ground = foot(px, pz);
      const height = h - ground;
      if (height < 1 || !free(px, pz)) {
        continue;
      }
      const pier = new BoxGeometry(PIER_SIZE_METERS, height, PIER_SIZE_METERS).translate(px, ground + height / 2, pz);
      pier.deleteAttribute('uv');
      const tint = new Float32Array(pier.getAttribute('position').count * 3);
      for (let v = 0; v < tint.length; v += 3) {
        tint[v] = concrete.r;
        tint[v + 1] = concrete.g;
        tint[v + 2] = concrete.b;
      }
      pier.setAttribute('color', new BufferAttribute(tint, 3));
      parts.push(pier.toNonIndexed());
      pier.dispose();
    }
  }
  return parts;
}

/** Sample `i`'s position and the unit vector to the right of the road's run there. */
function frame(road: RoadPath, i: number): [number, number, number, number] {
  const count = road.pointCount;
  const previous = road.closed ? (i - 1 + count) % count : Math.max(0, i - 1);
  const next = road.closed ? (i + 1) % count : Math.min(count - 1, i + 1);
  const tx = road.x(next) - road.x(previous);
  const tz = road.z(next) - road.z(previous);
  const length = Math.hypot(tx, tz) || 1;
  return [road.x(i), road.z(i), -tz / length, tx / length];
}
