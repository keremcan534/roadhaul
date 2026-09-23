import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  type Scene,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { DepotDefinition, RectangleDefinition } from '../../data/definitions/MapDefinition';
import { concreteImage } from '../textures/proceduralImages';
import { toTexture } from '../textures/toTexture';
import { flatGroundLight } from './lighting';

/** Yards lie over the grass and the road's gravel shoulders but under the asphalt (see TrackView's layers). */
const YARD_Y = 0.02;
const BAY_LINE_Y = 0.07;
const BAY_LINE_WIDTH = 0.2;
const BAY_LINE_COLOR = 0xf2c230;
/** One concrete texture tile (2 × 2 slabs) covers this many meters. */
const CONCRETE_TILE_METERS = 12;
/** Height of the glowing walls around the target bay. */
const BEACON_WALL_HEIGHT = 4;
/** The light pillar above the target bay shows where to go from far away… */
const BEACON_PILLAR_HEIGHT = 80;
const BEACON_PILLAR_RADIUS = 0.9;
/** …so it fades out as the camera comes close (horizontal distance, meters), where the walls take over. */
const PILLAR_FADE_START = 60;
const PILLAR_FADE_END = 25;

export type DepotTargetKind = 'pickup' | 'delivery';

/** Beacon colours: amber where the cargo waits, green where it goes. */
export const BEACON_COLORS: Readonly<Record<DepotTargetKind, number>> = { pickup: 0xffa726, delivery: 0x3ddc84 };

export interface DepotViewOptions {
  /** Texture anisotropy for the concrete (renderer capability). */
  readonly anisotropy?: number;
}

/**
 * Draws the depots (spec §12): concrete yards, yellow loading-bay lines and a
 * beacon over the bay the mission needs next: glowing walls around it and a
 * tall light pillar that shows the way from across the map. Yards and lines
 * are merged, so all depots cost two draw calls, plus two for the beacon.
 */
export class DepotView {
  private readonly root = new Group();
  private readonly resources: { dispose(): void }[] = [];
  private readonly beacons = new Map<string, Group>();
  private readonly wallMaterial: MeshBasicMaterial;
  private readonly pillarMaterial: MeshBasicMaterial;
  private activeBeacon: Group | null = null;
  private activeBay: RectangleDefinition | null = null;
  private readonly bays = new Map<string, RectangleDefinition>();
  private pulseSeconds = 0;

  constructor(
    private readonly scene: Scene,
    depots: readonly DepotDefinition[],
    options: DepotViewOptions = {},
  ) {
    const groundLight = flatGroundLight();
    if (depots.length > 0) {
      const concrete = this.track(toTexture(concreteImage(), { repeat: true, anisotropy: options.anisotropy ?? 1 }));
      this.root.add(
        new Mesh(
          this.merged(depots.map((depot) => yardGeometry(depot.yard))),
          this.overlayMaterial(concrete, new Color(0xffffff).multiply(groundLight), 1.5),
        ),
        new Mesh(
          this.merged(depots.map((depot) => bayLinesGeometry(depot.bay))),
          this.overlayMaterial(null, new Color(BAY_LINE_COLOR).multiply(groundLight), 3),
        ),
      );
    }

    this.wallMaterial = this.track(beaconMaterial(true));
    this.pillarMaterial = this.track(beaconMaterial(false));
    for (const depot of depots) {
      const beacon = new Group();
      beacon.visible = false;
      beacon.add(
        new Mesh(this.track(beaconWallsGeometry(depot.bay)), this.wallMaterial),
        new Mesh(
          this.track(
            fadingColumnGeometry(
              new CylinderGeometry(BEACON_PILLAR_RADIUS, BEACON_PILLAR_RADIUS, BEACON_PILLAR_HEIGHT, 12, 1, true),
              BEACON_PILLAR_HEIGHT,
            ).translate(depot.bay.x, BEACON_PILLAR_HEIGHT / 2, depot.bay.z),
          ),
          this.pillarMaterial,
        ),
      );
      this.beacons.set(depot.id, beacon);
      this.bays.set(depot.id, depot.bay);
      this.root.add(beacon);
    }
    scene.add(this.root);
  }

  /** The depot whose beacon is lit, or null. */
  get targetDepotId(): string | null {
    for (const [id, beacon] of this.beacons) {
      if (beacon === this.activeBeacon) {
        return id;
      }
    }
    return null;
  }

  /** Lights the beacon over `depotId`'s bay in the colour for `kind`, or turns it off (null). */
  setTarget(depotId: string | null, kind: DepotTargetKind = 'pickup'): void {
    if (this.activeBeacon !== null) {
      this.activeBeacon.visible = false;
    }
    this.activeBeacon = depotId === null ? null : (this.beacons.get(depotId) ?? null);
    this.activeBay = depotId === null ? null : (this.bays.get(depotId) ?? null);
    if (depotId !== null && this.activeBeacon === null) {
      throw new Error(`Unknown depot "${depotId}".`);
    }
    if (this.activeBeacon !== null) {
      this.activeBeacon.visible = true;
      this.wallMaterial.color.setHex(BEACON_COLORS[kind]);
      this.pillarMaterial.color.setHex(BEACON_COLORS[kind]);
    }
  }

  /** Pulses the beacon and fades its pillar out near the camera at (cameraX, cameraZ). Allocation-free. */
  update(deltaSeconds: number, cameraX: number, cameraZ: number): void {
    const bay = this.activeBay;
    if (this.activeBeacon === null || bay === null) {
      return;
    }
    this.pulseSeconds = (this.pulseSeconds + deltaSeconds) % 1000;
    const pulse = 0.5 + 0.5 * Math.sin(this.pulseSeconds * 3.2);
    this.wallMaterial.opacity = 0.55 + 0.35 * pulse;
    const distance = Math.hypot(cameraX - bay.x, cameraZ - bay.z);
    const far = Math.min(1, Math.max(0, (distance - PILLAR_FADE_END) / (PILLAR_FADE_START - PILLAR_FADE_END)));
    this.pillarMaterial.opacity = (0.45 + 0.2 * pulse) * far;
    this.pillarMaterial.visible = far > 0;
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

  /** Unlit and pre-lit like the road (flatGroundLight), pulled toward the camera by `layer` (see TrackView). */
  private overlayMaterial(map: Texture | null, color: Color, layer: number): MeshBasicMaterial {
    return this.track(
      new MeshBasicMaterial({
        ...(map === null ? {} : { map }),
        color,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -2 * layer,
      }),
    );
  }

  /** Remembers a GPU resource so dispose() can release it. */
  private track<T extends { dispose(): void }>(resource: T): T {
    this.resources.push(resource);
    return resource;
  }
}

/** A flat rectangle on the ground, with texture coordinates in concrete tiles. */
function yardGeometry(rectangle: RectangleDefinition): BufferGeometry {
  const geometry = new PlaneGeometry(rectangle.widthMeters, rectangle.lengthMeters);
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(
      i,
      (uv.getX(i) * rectangle.widthMeters) / CONCRETE_TILE_METERS,
      (uv.getY(i) * rectangle.lengthMeters) / CONCRETE_TILE_METERS,
    );
  }
  return placeFlat(geometry, rectangle, YARD_Y);
}

/** The painted outline of a bay, just inside its edges. */
function bayLinesGeometry(bay: RectangleDefinition): BufferGeometry {
  const halfLength = bay.lengthMeters / 2 - BAY_LINE_WIDTH / 2;
  const halfWidth = bay.widthMeters / 2 - BAY_LINE_WIDTH / 2;
  const lines = [
    new PlaneGeometry(BAY_LINE_WIDTH, bay.lengthMeters).translate(-halfWidth, 0, 0),
    new PlaneGeometry(BAY_LINE_WIDTH, bay.lengthMeters).translate(halfWidth, 0, 0),
    new PlaneGeometry(bay.widthMeters, BAY_LINE_WIDTH).translate(0, -halfLength, 0),
    new PlaneGeometry(bay.widthMeters, BAY_LINE_WIDTH).translate(0, halfLength, 0),
  ];
  const outline = mergeGeometries(lines);
  for (const line of lines) {
    line.dispose();
  }
  return placeFlat(outline, bay, BAY_LINE_Y);
}

/**
 * Lays a geometry drawn in the XY plane (X across, Y along) flat on the
 * ground: along the rectangle's heading, centred on it, at height `y`.
 */
function placeFlat(geometry: BufferGeometry, rectangle: RectangleDefinition, y: number): BufferGeometry {
  // rotateX(-90°) maps +Y to -Z; rotateY(heading + 180°) then turns "along" to (sin h, cos h).
  return geometry
    .rotateX(-Math.PI / 2)
    .rotateY((rectangle.headingDegrees * Math.PI) / 180 + Math.PI)
    .translate(rectangle.x, y, rectangle.z);
}

/** Four open walls around the bay, fading from the ground up. */
function beaconWallsGeometry(bay: RectangleDefinition): BufferGeometry {
  const heading = (bay.headingDegrees * Math.PI) / 180;
  const alongX = Math.sin(heading);
  const alongZ = Math.cos(heading);
  const halfLength = bay.lengthMeters / 2;
  const halfWidth = bay.widthMeters / 2;
  const corners = [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ].map(([l, w]) => [
    bay.x + alongX * halfLength * l! + alongZ * halfWidth * w!,
    bay.z + alongZ * halfLength * l! - alongX * halfWidth * w!,
  ]);
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  corners.forEach(([ax, az], side) => {
    const [bx, bz] = corners[(side + 1) % corners.length]!;
    const base = positions.length / 3;
    positions.push(ax!, 0, az!, bx!, 0, bz!, bx!, BEACON_WALL_HEIGHT, bz!, ax!, BEACON_WALL_HEIGHT, az!);
    colors.push(1, 1, 1, 0.8, 1, 1, 1, 0.8, 1, 1, 1, 0, 1, 1, 1, 0);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 4));
  geometry.setIndex(indices);
  return geometry;
}

/** Gives a vertical column (centred on the origin, `height` tall) white vertex colours that fade out upward. */
function fadingColumnGeometry(geometry: BufferGeometry, height: number): BufferGeometry {
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 4);
  for (let i = 0; i < position.count; i++) {
    const up = position.getY(i) / height + 0.5;
    colors.set([1, 1, 1, 0.9 * (1 - up) ** 1.5], i * 4);
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 4));
  return geometry;
}

/** Translucent, unlit, tinted by setTarget(); vertex alpha fades it. The pillar ignores fog so it shows from afar. */
function beaconMaterial(fog: boolean): MeshBasicMaterial {
  return new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    side: DoubleSide,
    fog,
  });
}
