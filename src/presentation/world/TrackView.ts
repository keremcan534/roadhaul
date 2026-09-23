import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Scene,
} from 'three';
import type { BuildingObstacle, DrivingWorld, TreeObstacle } from '../../domain/world/DrivingWorld';
import type { RoadPath } from '../../domain/world/RoadPath';

const SKY_COLOR = 0x9ec9e8;
const GROUND_COLOR = 0x6d8f4b;
const ROAD_COLOR = 0x3b3f45;
const MARKING_COLOR = 0xf2f2ee;
const TRUNK_COLOR = 0x6b4a2f;
const CANOPY_COLORS = [0x3f7a3a, 0x4d8a3f, 0x35683a] as const;
const BUILDING_COLORS = [0xd8d2c4, 0xb9c3cc, 0xc9b8a0, 0xe3ddd0] as const;

/** Heights above the ground; the road and markings also use polygon offset against z-fighting. */
const ROAD_Y = 0.02;
const MARKING_Y = 0.04;
const EDGE_LINE_WIDTH = 0.2;
const EDGE_LINE_INSET = 0.6;
const DASH_LENGTH = 3;
const DASH_SPACING = 12;

const UP = new Vector3(0, 1, 0);

/**
 * Draws a DrivingWorld: ground, road surface, edge lines, centre dashes,
 * trees and buildings. Everything repeated is instanced; the whole track
 * costs about ten draw calls. It reads the same geometry the simulation
 * collides with, so visuals and physics cannot drift apart.
 */
export class TrackView {
  private readonly root = new Group();
  private readonly resources: { dispose(): void }[] = [];

  constructor(
    private readonly scene: Scene,
    world: DrivingWorld,
  ) {
    scene.background = new Color(SKY_COLOR);
    scene.fog = new Fog(SKY_COLOR, 120, 420);

    const sun = new DirectionalLight(0xfff4e0, 2.2);
    sun.position.set(120, 200, 80);
    this.root.add(new HemisphereLight(0xdcecff, 0x55643c, 1.5), sun, this.createGround(world.halfSizeMeters));
    for (const road of world.roads) {
      this.root.add(this.createRoadSurface(road), this.createEdgeLines(road), this.createCentreDashes(road));
    }
    if (world.trees.length > 0) {
      this.root.add(...this.createTrees(world.trees));
    }
    if (world.buildings.length > 0) {
      this.root.add(this.createBuildings(world.buildings));
    }
    scene.add(this.root);
  }

  dispose(): void {
    this.scene.remove(this.root);
    this.scene.background = null;
    this.scene.fog = null;
    for (const resource of this.resources) {
      resource.dispose();
    }
  }

  private createGround(halfSize: number): Mesh {
    // Larger than the playable area, so its edge hides in the fog.
    const size = (halfSize + 300) * 2;
    const ground = new Mesh(this.track(new PlaneGeometry(size, size)), this.material(GROUND_COLOR));
    ground.rotation.x = -Math.PI / 2;
    return ground;
  }

  private createRoadSurface(road: RoadPath): Mesh {
    const geometry = this.track(stripGeometry(road, [{ offset: 0, width: road.widthMeters }], ROAD_Y));
    return new Mesh(geometry, this.material(ROAD_COLOR, true));
  }

  private createEdgeLines(road: RoadPath): Mesh {
    const edge = road.widthMeters / 2 - EDGE_LINE_INSET;
    const geometry = this.track(
      stripGeometry(
        road,
        [
          { offset: -edge, width: EDGE_LINE_WIDTH },
          { offset: edge, width: EDGE_LINE_WIDTH },
        ],
        MARKING_Y,
      ),
    );
    return new Mesh(geometry, this.material(MARKING_COLOR, true));
  }

  private createCentreDashes(road: RoadPath): InstancedMesh {
    const count = Math.max(1, Math.floor(road.lengthMeters / DASH_SPACING));
    const dashes = this.track(
      new InstancedMesh(this.track(new BoxGeometry(0.18, 0.01, DASH_LENGTH)), this.material(MARKING_COLOR, true), count),
    );
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3(1, 1, 1);
    const matrix = new Matrix4();
    for (let i = 0; i < count; i++) {
      const heading = pointAlong(road, (i + 0.5) * DASH_SPACING, position);
      position.y = MARKING_Y;
      rotation.setFromAxisAngle(UP, heading);
      dashes.setMatrixAt(i, matrix.compose(position, rotation, scale));
    }
    dashes.instanceMatrix.needsUpdate = true;
    return dashes;
  }

  private createTrees(trees: readonly TreeObstacle[]): InstancedMesh[] {
    const trunkHeight = 2.4;
    const canopyHeight = 5;
    const trunks = this.track(
      new InstancedMesh(this.track(new CylinderGeometry(0.25, 0.35, trunkHeight, 6)), this.material(TRUNK_COLOR), trees.length),
    );
    const canopies = this.track(
      new InstancedMesh(this.track(new ConeGeometry(2, canopyHeight, 7)), this.material(0xffffff), trees.length),
    );
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    const matrix = new Matrix4();
    const color = new Color();
    trees.forEach((tree, index) => {
      rotation.setFromAxisAngle(UP, index * 2.399); // Golden-angle spin so neighbours differ.
      scale.setScalar(tree.scale);
      position.set(tree.x, (trunkHeight / 2) * tree.scale, tree.z);
      trunks.setMatrixAt(index, matrix.compose(position, rotation, scale));
      position.y = (trunkHeight + canopyHeight / 2 - 0.4) * tree.scale;
      canopies.setMatrixAt(index, matrix.compose(position, rotation, scale));
      canopies.setColorAt(index, color.setHex(CANOPY_COLORS[index % CANOPY_COLORS.length]!));
    });
    trunks.instanceMatrix.needsUpdate = true;
    canopies.instanceMatrix.needsUpdate = true;
    if (canopies.instanceColor !== null) {
      canopies.instanceColor.needsUpdate = true;
    }
    return [trunks, canopies];
  }

  private createBuildings(buildings: readonly BuildingObstacle[]): InstancedMesh {
    const blocks = this.track(
      new InstancedMesh(this.track(new BoxGeometry(1, 1, 1)), this.material(0xffffff), buildings.length),
    );
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    const matrix = new Matrix4();
    const color = new Color();
    buildings.forEach((box, index) => {
      const width = box.maxX - box.minX;
      const depth = box.maxZ - box.minZ;
      position.set(box.minX + width / 2, box.heightMeters / 2, box.minZ + depth / 2);
      scale.set(width, box.heightMeters, depth);
      blocks.setMatrixAt(index, matrix.compose(position, rotation, scale));
      blocks.setColorAt(index, color.setHex(BUILDING_COLORS[index % BUILDING_COLORS.length]!));
    });
    blocks.instanceMatrix.needsUpdate = true;
    if (blocks.instanceColor !== null) {
      blocks.instanceColor.needsUpdate = true;
    }
    return blocks;
  }

  private material(color: number, overlay = false): MeshLambertMaterial {
    return this.track(
      new MeshLambertMaterial({
        color,
        // Road layers lie flat on the ground: pull them toward the camera instead of relying on tiny height gaps.
        polygonOffset: overlay,
        polygonOffsetFactor: overlay ? -1 : 0,
        polygonOffsetUnits: overlay ? -2 : 0,
      }),
    );
  }

  /** Remembers a GPU resource so dispose() can release it. */
  private track<T extends { dispose(): void }>(resource: T): T {
    this.resources.push(resource);
    return resource;
  }
}

/**
 * Builds flat ribbons that follow the road, one per band. `offset` is the
 * band's centre measured sideways from the centreline (positive to the right
 * of the direction of travel).
 */
function stripGeometry(road: RoadPath, bands: readonly { offset: number; width: number }[], y: number): BufferGeometry {
  const count = road.pointCount;
  const segments = road.segmentCount;
  const positions = new Float32Array(bands.length * count * 2 * 3);
  const normals = new Float32Array(positions.length);
  const indices: number[] = [];
  bands.forEach((band, bandIndex) => {
    const base = bandIndex * count * 2;
    for (let i = 0; i < count; i++) {
      // Tangent from the neighbouring samples; "right" is the tangent turned 90° clockwise from above.
      const previous = road.closed ? (i - 1 + count) % count : Math.max(0, i - 1);
      const next = road.closed ? (i + 1) % count : Math.min(count - 1, i + 1);
      const tx = road.x(next) - road.x(previous);
      const tz = road.z(next) - road.z(previous);
      const length = Math.hypot(tx, tz) || 1;
      const rightX = -tz / length;
      const rightZ = tx / length;
      const inner = band.offset - band.width / 2;
      const outer = band.offset + band.width / 2;
      const vertex = (base + i * 2) * 3;
      positions.set([road.x(i) + rightX * inner, y, road.z(i) + rightZ * inner], vertex);
      positions.set([road.x(i) + rightX * outer, y, road.z(i) + rightZ * outer], vertex + 3);
      normals.set([0, 1, 0, 0, 1, 0], vertex);
    }
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % count;
      const leftI = base + i * 2;
      const rightI = leftI + 1;
      const leftJ = base + j * 2;
      const rightJ = leftJ + 1;
      // Wound so (right − left) × (next − this) points up: the ribbon's front face looks at the sky.
      indices.push(leftI, rightI, leftJ, rightI, rightJ, leftJ);
    }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}

/** Writes the centreline point `distance` meters along the road into `out`; returns the heading there. */
function pointAlong(road: RoadPath, distance: number, out: Vector3): number {
  const count = road.pointCount;
  let index = 0;
  while (index < count - 1 && (road.distances[index + 1] ?? Infinity) <= distance) {
    index++;
  }
  const next = road.closed ? (index + 1) % count : Math.min(count - 1, index + 1);
  const start = road.distances[index] ?? 0;
  const end = next === 0 ? road.lengthMeters : (road.distances[next] ?? start);
  const t = end > start ? Math.min(1, (distance - start) / (end - start)) : 0;
  const dx = road.x(next) - road.x(index);
  const dz = road.z(next) - road.z(index);
  out.set(road.x(index) + dx * t, 0, road.z(index) + dz * t);
  return Math.atan2(dx, dz);
}
