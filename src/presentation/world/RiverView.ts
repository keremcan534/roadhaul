import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  MeshLambertMaterial,
  type MeshBasicMaterial,
  type Scene,
} from 'three';
import type { Bridge } from '../../domain/world/bridges';
import type { DrivingWorld } from '../../domain/world/DrivingWorld';
import { createRoadPoint, type RoadPath } from '../../domain/world/RoadPath';
import { RIVER_BANK_METERS, RIVER_WATER_DEPTH_METERS, type RiverPath } from '../../domain/world/RiverPath';
import type { SkyUniforms } from './EnvironmentView';
import { riverCourse, type CoursePoint } from './riverChannel';
import { groundTint } from './TrackView';
import { createWaterMaterial } from './waterMaterial';
import { freezeTransforms } from './worldTiles';

/** The channel is cut into stretches of this many samples (about 600 m), so those out of view are not drawn. */
const STRETCH_SAMPLES = 100;
/** Each bank bends this far from the water (a share of its width) and this far down there (a share of the water's depth). */
const BANK_BEND = 0.45;
const BANK_BEND_DEPTH = 0.8;
/** The water reaches this far under each bank, meters, so no gap shows at the waterline. */
const WATER_UNDER_BANK_METERS = 0.5;
/** The banks darken toward the water, wet and muddy: their colour at the waterline, as a factor. */
const WET_BANK = new Color(0.6, 0.53, 0.42);
/** The river's own colour under the sky's reflection: greener and siltier than the sea's. */
const RIVER_WATER = 0x2e5b52;
/** A bridge's side under its deck reaches this far down, meters (no lower than the channel under it). */
const DECK_DEPTH_METERS = 0.8;
/** Its parapets: how tall, and how far inside and outside the deck's edge they stand, meters. */
const PARAPET_HEIGHT_METERS = 0.95;
const PARAPET_INSIDE_METERS = 0.2;
const PARAPET_OUTSIDE_METERS = 0.15;
/** The deck's top: the roads' own height (TrackView's ROAD_Y). */
const DECK_Y = 0.03;
const PARAPET_STEP_METERS = 2;
const CONCRETE = 0xb9b5ad;

export interface RiverViewOptions {
  /** The sky the water mirrors (EnvironmentView.sky). */
  readonly sky: SkyUniforms;
  /** The ground's material, for the banks (TrackView.createGroundMaterial()): they are the fields' grass, sloping down. */
  readonly bankMaterial: MeshBasicMaterial;
  /** The ground plane's width (TrackView.groundSizeMeters), so the banks' grass lines up with the fields'. */
  readonly groundSizeMeters: number;
}

/**
 * The rivers (DrivingWorld.rivers) and their bridges. Each river runs in a
 * channel below the fields: grassy banks that slope to its water, darkening
 * and muddy at the waterline, and the water between them, mirroring the sky
 * like the sea (waterMaterial) with its ripples riding the current
 * downstream. The ground plane is cut open over it (TrackView, with
 * createChannelMask), so the channel shows through, and the bridges' decks
 * (the roads) pass over. It flows in from beyond the map's edge and comes up
 * to the sea at its mouth. A bridge carries its road over on a deck with
 * concrete parapets, its side showing under the deck's edge. Two draw calls
 * per stretch of river in view, one for all the bridges. update() runs
 * every frame and allocates nothing.
 */
export class RiverView {
  private readonly root = new Group();
  private readonly resources: { dispose(): void }[] = [];
  private readonly time = { value: 0 };

  constructor(
    private readonly scene: Scene,
    world: DrivingWorld,
    options: RiverViewOptions,
  ) {
    this.root.name = 'rivers';
    const water = this.track(createWaterMaterial({ sky: options.sky, time: this.time, deepColor: RIVER_WATER, river: true }));
    for (const river of world.rivers) {
      const course = riverCourse(river);
      for (let first = 0; first < course.length - 1; first += STRETCH_SAMPLES) {
        const stretch = course.slice(first, Math.min(course.length, first + STRETCH_SAMPLES + 1));
        const banks = new Mesh(this.track(banksGeometry(river, stretch, options.groundSizeMeters)), options.bankMaterial);
        banks.name = 'river-banks';
        const surface = new Mesh(this.track(waterGeometry(river, stretch)), water);
        surface.name = 'river-water';
        this.root.add(banks, surface);
      }
    }
    if (world.bridges.length > 0) {
      this.root.add(this.createBridges(world));
    }
    freezeTransforms(this.root);
    scene.add(this.root);
  }

  /** Moves the ripples `deltaSeconds` on. Allocation-free. */
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

  /** The bridges' concrete: parapets along their decks' edges, and the decks' sides down into the channel. */
  private createBridges(world: DrivingWorld): Mesh {
    const concrete: number[] = [];
    for (const bridge of world.bridges) {
      const road = world.roads[bridge.roadIndex]!;
      const river = world.rivers[bridge.riverIndex]!;
      addBridge(bridge, road, river, concrete);
    }
    const mesh = new Mesh(this.track(flatShaded(concrete)), this.track(new MeshLambertMaterial({ color: CONCRETE })));
    mesh.name = 'bridges';
    return mesh;
  }

  private track<T extends { dispose(): void }>(resource: T): T {
    this.resources.push(resource);
    return resource;
  }
}

/**
 * Both banks along a stretch: from the rim (level with the fields) down a
 * bend to the waterline, three rows a bank, wound to face up into the
 * channel. The grass lines up with the ground's (uv from world position),
 * its colour the ground's (groundTint), wet and darker toward the water.
 */
function banksGeometry(river: RiverPath, stretch: readonly CoursePoint[], groundSize: number): BufferGeometry {
  const half = river.halfWidthMeters;
  const opening = river.openingHalfWidthMeters;
  // Across a bank from the rim: how far out from the middle, how deep (a share of the water's), how wet.
  const rows = [
    { out: opening, down: 0, wet: 0 },
    { out: half + RIVER_BANK_METERS * BANK_BEND, down: BANK_BEND_DEPTH, wet: 0.45 },
    { out: half, down: 1, wet: 1 },
  ];
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const tint = new Color();
  for (const side of [1, -1] as const) {
    const start = positions.length / 3;
    for (const point of stretch) {
      // (dz, -dx) is left of the flow.
      const nx = point.dz * side;
      const nz = -point.dx * side;
      for (const row of rows) {
        const x = point.x + nx * row.out;
        const z = point.z + nz * row.out;
        positions.push(x, -RIVER_WATER_DEPTH_METERS * point.depth * row.down, z);
        uvs.push(0.5 + x / groundSize, 0.5 - z / groundSize);
        groundTint(x, z, tint).lerp(tint.clone().multiply(WET_BANK), row.wet);
        colors.push(tint.r, tint.g, tint.b);
      }
    }
    for (let i = 0; i < stretch.length - 1; i++) {
      for (let row = 0; row < rows.length - 1; row++) {
        const a = start + i * rows.length + row; // Nearer the rim, here.
        const b = a + 1; // Nearer the water, here.
        const c = a + rows.length; // Nearer the rim, downstream.
        const d = b + rows.length;
        if (side === 1) {
          indices.push(a, b, c, b, d, c);
        } else {
          indices.push(a, c, b, b, c, d);
        }
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * The water along a stretch: three rows (both edges, under the banks, and
 * the middle), each vertex knowing how far it is from the nearer bank
 * (`shore`, for the foam) and where it lies across and along the river
 * (`flow`, for the current), wound to face up.
 */
function waterGeometry(river: RiverPath, stretch: readonly CoursePoint[]): BufferGeometry {
  const reach = river.halfWidthMeters + WATER_UNDER_BANK_METERS;
  const across = [reach, 0, -reach];
  const positions: number[] = [];
  const shore: number[] = [];
  const flow: number[] = [];
  const indices: number[] = [];
  for (const point of stretch) {
    for (const out of across) {
      positions.push(point.x + point.dz * out, -RIVER_WATER_DEPTH_METERS * point.depth, point.z - point.dx * out);
      shore.push(Math.max(0, river.halfWidthMeters - Math.abs(out)));
      flow.push(out, point.along);
    }
  }
  for (let i = 0; i < stretch.length - 1; i++) {
    const left = i * 3;
    const middle = left + 1;
    const right = left + 2;
    indices.push(left, middle, left + 3, middle, middle + 3, left + 3, middle, right, middle + 3, right, right + 3, middle + 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('shore', new BufferAttribute(new Float32Array(shore), 1));
  geometry.setAttribute('flow', new BufferAttribute(new Float32Array(flow), 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * One bridge's concrete: a parapet along each edge of its deck (inner face,
 * top, outer face, and its ends), and under the edges, where the channel
 * opens below, the deck's side, down no further than the channel's floor
 * there. Triangles, flat: three vertices each.
 */
function addBridge(bridge: Bridge, road: RoadPath, river: RiverPath, concrete: number[]): void {
  const point = createRoadPoint();
  const steps = Math.max(1, Math.ceil((bridge.toMeters - bridge.fromMeters) / PARAPET_STEP_METERS));
  const top = DECK_Y + PARAPET_HEIGHT_METERS;
  for (const side of [1, -1] as const) {
    const edges: { inX: number; inZ: number; outX: number; outZ: number }[] = [];
    for (let step = 0; step <= steps; step++) {
      road.pointAt(bridge.fromMeters + ((bridge.toMeters - bridge.fromMeters) * step) / steps, point);
      // (dz, -dx) is left of the road's direction.
      const nx = point.directionZ * side;
      const nz = -point.directionX * side;
      const inside = bridge.halfWidthMeters - PARAPET_INSIDE_METERS;
      const outside = bridge.halfWidthMeters + PARAPET_OUTSIDE_METERS;
      edges.push({ inX: point.x + nx * inside, inZ: point.z + nz * inside, outX: point.x + nx * outside, outZ: point.z + nz * outside });
    }
    for (let i = 0; i < edges.length - 1; i++) {
      const a = edges[i]!;
      const b = edges[i + 1]!;
      // Inner face (toward the road), top, outer face: each a quad from here to the next.
      quad(concrete, [a.inX, DECK_Y, a.inZ], [b.inX, DECK_Y, b.inZ], [b.inX, top, b.inZ], [a.inX, top, a.inZ], side);
      quad(concrete, [a.inX, top, a.inZ], [b.inX, top, b.inZ], [b.outX, top, b.outZ], [a.outX, top, a.outZ], side);
      quad(concrete, [a.outX, top, a.outZ], [b.outX, top, b.outZ], [b.outX, DECK_Y, b.outZ], [a.outX, DECK_Y, a.outZ], side);
      // The deck's side below its edge, where the channel opens under it.
      const bottomA = Math.max(-DECK_DEPTH_METERS, channelFloor(river, a.outX, a.outZ));
      const bottomB = Math.max(-DECK_DEPTH_METERS, channelFloor(river, b.outX, b.outZ));
      if (bottomA < -0.01 || bottomB < -0.01) {
        quad(concrete, [a.outX, 0, a.outZ], [b.outX, 0, b.outZ], [b.outX, bottomB, b.outZ], [a.outX, bottomA, a.outZ], side);
      }
    }
    // The parapet's ends.
    for (const edge of [edges[0]!, edges[edges.length - 1]!]) {
      const end = edge === edges[0] ? 1 : -1;
      quad(
        concrete,
        [edge.inX, DECK_Y, edge.inZ],
        [edge.inX, top, edge.inZ],
        [edge.outX, top, edge.outZ],
        [edge.outX, DECK_Y, edge.outZ],
        (side * end) as 1 | -1,
      );
    }
  }
}

/**
 * How far below the fields the channel's surface lies at (x, z), meters
 * (negative, or 0 outside the channel): its banks' slope, then the water.
 * Uses the depth at the river's sample nearest the point.
 */
function channelFloor(river: RiverPath, x: number, z: number): number {
  const distance = river.distanceTo(x, z);
  if (!(distance < river.openingHalfWidthMeters)) {
    return 0;
  }
  let nearest = 0;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < river.pointCount; i++) {
    const d = Math.hypot(river.x(i) - x, river.z(i) - z);
    if (d < best) {
      best = d;
      nearest = i;
    }
  }
  const water = -RIVER_WATER_DEPTH_METERS * river.depths[nearest]!;
  const bend = river.halfWidthMeters + RIVER_BANK_METERS * BANK_BEND;
  if (distance <= river.halfWidthMeters) {
    return water;
  }
  if (distance <= bend) {
    const t = (distance - river.halfWidthMeters) / (bend - river.halfWidthMeters);
    return water + (water * BANK_BEND_DEPTH - water) * t;
  }
  const t = (distance - bend) / (river.openingHalfWidthMeters - bend);
  return water * BANK_BEND_DEPTH * (1 - t);
}

/**
 * Two triangles a→b→c and a→c→d, wound (for `side` 1; reversed for -1) so
 * the face looks the way the caller built it to.
 */
function quad(
  out: number[],
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
  d: readonly [number, number, number],
  side: 1 | -1,
): void {
  if (side === 1) {
    out.push(...a, ...b, ...c, ...a, ...c, ...d);
  } else {
    out.push(...a, ...c, ...b, ...a, ...d, ...c);
  }
}

/** Unindexed triangles with their own flat normals. */
function flatShaded(positions: readonly number[]): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}
