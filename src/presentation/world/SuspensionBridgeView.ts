import { BoxGeometry, BufferAttribute, BufferGeometry, Color, Mesh, MeshLambertMaterial, Vector3, type Scene } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { DrivingWorld } from '../../domain/world/DrivingWorld';
import { createRoadPoint, type RoadPath } from '../../domain/world/RoadPath';
import { LampGlows } from '../vehicles/LampGlows';

/** The towers' legs stand this far out past the road's edge, this thick; their beams this deep. */
const LEG_OUT_METERS = 2;
const LEG_SIZE_METERS = 3.2;
const BEAM_DEPTH_METERS = 3;
/** Under water, the legs reach this far down (out of sight). */
const FOOT_UNDER_WATER_METERS = 8;
/** The main cables' thickness, and how low they hang over the deck at the main span's middle. */
const CABLE_METERS = 0.8;
const CABLE_LOW_METERS = 3.5;
/** A hanger every this far along, from the cable down to the deck's edge. */
const HANGER_SPACING_METERS = 14;
const HANGER_METERS = 0.18;
/** The cables are drawn in pieces this long. */
const CABLE_PIECE_METERS = 12;
const TOWER_COLOR = 0xd6d9de;
const CABLE_COLOR = 0x7c8389;
/** The warning lamps on the towers' tops: red, and how big their glow is. */
const WARNING_GLOW = 0xff3020;
const WARNING_GLOW_METERS = 6;

/**
 * The suspension bridges the roads are carried on (RoadDefinition.suspension):
 * two towers each, legs either side of the deck joined by beams under it and
 * near their tops, a main cable either side hanging between the towers and
 * running down to anchorages beyond them, and hangers down to the deck.
 * One mesh for all of them (one draw call), and a red warning lamp on each
 * tower top glowing at night (setLamps). The deck itself is DeckView's.
 */
export class SuspensionBridgeView {
  readonly mesh: Mesh | null = null;
  private readonly material = new MeshLambertMaterial({ vertexColors: true });
  private readonly glows: LampGlows | null = null;

  constructor(
    private readonly scene: Scene,
    world: DrivingWorld,
    lampGlows = true,
  ) {
    const parts: BufferGeometry[] = [];
    const tops: Vector3[] = [];
    const foot = (x: number, z: number): number => (world.isWater(x, z) ? -FOOT_UNDER_WATER_METERS : world.terrain.heightAt(x, z));
    for (const road of world.roads) {
      if (road.suspension !== undefined) {
        parts.push(...bridgeParts(road, foot, tops));
      }
    }
    if (parts.length === 0) {
      return;
    }
    const geometry = mergeGeometries(parts);
    for (const part of parts) {
      part.dispose();
    }
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.name = 'suspension-bridges';
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);
    if (lampGlows && tops.length > 0) {
      this.glows = new LampGlows(tops.length, WARNING_GLOW_METERS);
      tops.forEach((top, index) => {
        this.glows!.setPosition(index, top.x, top.y + 1, top.z);
        this.glows!.setColor(index, WARNING_GLOW);
      });
      this.glows.setCount(tops.length);
      scene.add(this.glows.points);
    }
  }

  /** How brightly lamps shine, 0..1 (the weather's: 0 by day, 1 at night): the towers' warning lamps. */
  setLamps(level: number): void {
    this.glows?.setLevel(level);
  }

  dispose(): void {
    if (this.mesh !== null) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    if (this.glows !== null) {
      this.scene.remove(this.glows.points);
      this.glows.dispose();
    }
    this.material.dispose();
  }
}

/** One road's bridge: its towers (each leg's top into `tops`), cables and hangers, painted per vertex. */
function bridgeParts(road: RoadPath, foot: (x: number, z: number) => number, tops: Vector3[]): BufferGeometry[] {
  const suspension = road.suspension!;
  const [first, second] = suspension.towersAtMeters;
  const half = road.widthMeters / 2 + LEG_OUT_METERS;
  const parts: BufferGeometry[] = [];
  const point = createRoadPoint();
  const towerColor = new Color(TOWER_COLOR);
  const cableColor = new Color(CABLE_COLOR);
  const deckAt = (along: number): number => road.heightAtDistance(along);
  const towerTop = (along: number): number => deckAt(along) + suspension.towerHeightMeters;

  for (const along of [first, second]) {
    road.pointAt(along, point);
    const heading = Math.atan2(point.directionX, point.directionZ);
    const rightX = point.directionZ;
    const rightZ = -point.directionX;
    const deck = deckAt(along);
    const top = towerTop(along);
    for (const side of [1, -1] as const) {
      const x = point.x + rightX * half * side;
      const z = point.z + rightZ * half * side;
      const bottom = foot(x, z);
      // Each leg narrows a little toward its top.
      parts.push(painted(boxAt(LEG_SIZE_METERS, top - bottom, LEG_SIZE_METERS * 1.3, x, (top + bottom) / 2, z, heading), towerColor));
      tops.push(new Vector3(x, top, z));
    }
    // The beams across: under the deck, and two near the top.
    for (const y of [deck - 2.2, top - 6, top - suspension.towerHeightMeters * 0.45]) {
      parts.push(painted(boxAt(half * 2 + LEG_SIZE_METERS, BEAM_DEPTH_METERS, LEG_SIZE_METERS, point.x, y, point.z, heading), towerColor));
    }
  }

  // The main cables, either side: down from each tower to its anchorage, and hanging between the towers.
  const anchorBefore = Math.max(0, first - suspension.backSpanMeters);
  const anchorAfter = Math.min(road.lengthMeters, second + suspension.backSpanMeters);
  const cableAt = (along: number): number => {
    if (along <= first) {
      // From the anchorage at the deck up to the tower's top, a gentle curve.
      const t = (along - anchorBefore) / (first - anchorBefore);
      return deckAt(along) + 1 + (towerTop(first) - deckAt(first) - 1) * t * t;
    }
    if (along >= second) {
      const t = (anchorAfter - along) / (anchorAfter - second);
      return deckAt(along) + 1 + (towerTop(second) - deckAt(second) - 1) * t * t;
    }
    // A parabola between the tops, lowest at the middle, CABLE_LOW_METERS over the deck.
    const t = (along - first) / (second - first);
    const ends = towerTop(first) + (towerTop(second) - towerTop(first)) * t;
    const lowest = deckAt((first + second) / 2) + CABLE_LOW_METERS;
    const sag = (towerTop(first) + towerTop(second)) / 2 - lowest;
    return ends - 4 * t * (1 - t) * sag;
  };
  const a = createRoadPoint();
  const b = createRoadPoint();
  for (const side of [1, -1] as const) {
    for (let along = anchorBefore; along < anchorAfter - 1e-6; along += CABLE_PIECE_METERS) {
      const next = Math.min(anchorAfter, along + CABLE_PIECE_METERS);
      road.pointAt(along, a);
      road.pointAt(next, b);
      const ax = a.x + a.directionZ * half * side;
      const az = a.z - a.directionX * half * side;
      const bx = b.x + b.directionZ * half * side;
      const bz = b.z - b.directionX * half * side;
      parts.push(painted(segment(new Vector3(ax, cableAt(along), az), new Vector3(bx, cableAt(next), bz), CABLE_METERS), cableColor));
    }
    // The hangers, from the cable down to the deck's edge.
    for (let along = anchorBefore + HANGER_SPACING_METERS; along < anchorAfter; along += HANGER_SPACING_METERS) {
      if (Math.abs(along - first) < LEG_SIZE_METERS || Math.abs(along - second) < LEG_SIZE_METERS) {
        continue;
      }
      road.pointAt(along, a);
      const x = a.x + a.directionZ * half * side;
      const z = a.z - a.directionX * half * side;
      const deck = deckAt(along);
      const cable = cableAt(along);
      if (cable - deck > 1.5) {
        parts.push(painted(segment(new Vector3(x, deck, z), new Vector3(x, cable, z), HANGER_METERS), cableColor));
      }
    }
  }
  return parts;
}

/** A box `width` × `height` × `depth` standing at (x, y, z), turned to `heading`; non-indexed, no uv. */
function boxAt(width: number, height: number, depth: number, x: number, y: number, z: number, heading: number): BufferGeometry {
  const box = new BoxGeometry(width, height, depth).rotateY(heading).translate(x, y, z);
  box.deleteAttribute('uv');
  const flat = box.toNonIndexed();
  box.dispose();
  return flat;
}

/** A square beam `size` thick from `from` to `to`. */
function segment(from: Vector3, to: Vector3, size: number): BufferGeometry {
  const length = from.distanceTo(to);
  const beam = new BoxGeometry(size, size, length);
  beam.deleteAttribute('uv');
  const middle = from.clone().add(to).multiplyScalar(0.5);
  beam.lookAt(to.clone().sub(from));
  beam.translate(middle.x, middle.y, middle.z);
  const flat = beam.toNonIndexed();
  beam.dispose();
  return flat;
}

/** `geometry` in one colour, per vertex. */
function painted(geometry: BufferGeometry, color: Color): BufferGeometry {
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    color.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}
