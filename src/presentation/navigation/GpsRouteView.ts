import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  type Scene,
} from 'three';
import { laneOffsetMeters } from '../../domain/world/lanes';
import type { RoadPath } from '../../domain/world/RoadPath';
import type { NavigationService } from '../../systems/navigation/NavigationService';
import { flatGroundLight } from '../world/lighting';

/** The line covers the route this far ahead of the truck… */
const LENGTH_METERS = 700;
/** …in at most this many points (road samples are about 4 m apart). */
const MAX_POINTS = 256;
const WIDTH_METERS = 1.4;
/** Above the road's painted lines (TrackView), below the truck's wheels. */
const LINE_Y = 0.1;
const COLOR = 0x2e9bff;
const OPACITY = 0.6;

/**
 * The GPS route drawn on the road (spec §63): a translucent band down the
 * middle of the right-hand lane along the route ahead, and on into the
 * depot yard to the bay. One draw call. Its buffers are allocated once;
 * update() rewrites them only when NavigationService has worked out the
 * route again (ten times a second at most), without allocating.
 */
export class GpsRouteView {
  private readonly geometry = new BufferGeometry();
  private readonly material: MeshBasicMaterial;
  private readonly mesh: Mesh;
  private readonly positions: Float32Array;
  private readonly pointX = new Float64Array(MAX_POINTS);
  private readonly pointZ = new Float64Array(MAX_POINTS);
  private readonly pointOffset = new Float64Array(MAX_POINTS);
  private shownRevision = -1;

  constructor(
    private readonly scene: Scene,
    private readonly navigation: NavigationService,
  ) {
    this.positions = new Float32Array(MAX_POINTS * 2 * 3);
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    const indices = new Uint16Array((MAX_POINTS - 1) * 6);
    for (let i = 0; i < MAX_POINTS - 1; i++) {
      const left = i * 2;
      // Wound so the band faces up, like TrackView's road ribbons.
      indices.set([left, left + 1, left + 2, left + 1, left + 3, left + 2], i * 6);
    }
    this.geometry.setIndex(new BufferAttribute(indices, 1));
    this.geometry.setDrawRange(0, 0);
    this.material = new MeshBasicMaterial({
      color: new Color(COLOR).multiply(flatGroundLight()),
      transparent: true,
      opacity: OPACITY,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -8,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.name = 'gps-route';
    // The band moves with the truck over the whole map: its bounds would go stale.
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /**
   * Redraws the band when the route has changed: from the truck (heading
   * `truckHeading` at truckX, truckZ) along `roads` of the current world.
   */
  update(truckX: number, truckZ: number, truckHeading: number, roads: readonly RoadPath[]): void {
    const navigation = this.navigation;
    if (navigation.revision === this.shownRevision) {
      return;
    }
    this.shownRevision = navigation.revision;
    const route = navigation.route;
    if (route === null || !route.connected || route.count < 2) {
      this.mesh.visible = false;
      return;
    }
    // Start at the first sample not behind the truck.
    const forwardX = Math.sin(truckHeading);
    const forwardZ = Math.cos(truckHeading);
    let first = 0;
    while (
      first < Math.min(route.count - 2, 6) &&
      (route.x[first]! - truckX) * forwardX + (route.z[first]! - truckZ) * forwardZ < -2
    ) {
      first++;
    }
    let count = 0;
    for (let i = first; i < route.count && count < MAX_POINTS - 1; i++) {
      if (route.along[i]! - route.along[first]! > LENGTH_METERS) {
        break;
      }
      // Two roads meet at one position: keep the first of the pair.
      if (count > 0 && Math.hypot(route.x[i]! - this.pointX[count - 1]!, route.z[i]! - this.pointZ[count - 1]!) < 0.5) {
        continue;
      }
      const road = roads[route.road[i]!];
      this.pointX[count] = route.x[i]!;
      this.pointZ[count] = route.z[i]!;
      this.pointOffset[count] = road === undefined ? 0 : laneOffsetMeters(road.kind, road.widthMeters, 0);
      count++;
    }
    // Reaching the end of the route: carry the band off the road to the bay.
    const last = route.count - 1;
    if (count < MAX_POINTS && route.along[last]! - route.along[first]! <= LENGTH_METERS) {
      this.pointX[count] = route.targetX;
      this.pointZ[count] = route.targetZ;
      this.pointOffset[count] = 0;
      count++;
    }
    if (count < 2) {
      this.mesh.visible = false;
      return;
    }
    this.writeBand(count);
    this.mesh.visible = true;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }

  /** Band edges either side of each point, shifted into the lane; "right" is the direction of travel turned clockwise. */
  private writeBand(count: number): void {
    const positions = this.positions;
    const half = WIDTH_METERS / 2;
    for (let i = 0; i < count; i++) {
      const previous = Math.max(0, i - 1);
      const next = Math.min(count - 1, i + 1);
      const tx = this.pointX[next]! - this.pointX[previous]!;
      const tz = this.pointZ[next]! - this.pointZ[previous]!;
      const length = Math.hypot(tx, tz) || 1;
      const rightX = -tz / length;
      const rightZ = tx / length;
      const offset = this.pointOffset[i]!;
      const x = this.pointX[i]!;
      const z = this.pointZ[i]!;
      const vertex = i * 6;
      positions[vertex] = x + rightX * (offset - half);
      positions[vertex + 1] = LINE_Y;
      positions[vertex + 2] = z + rightZ * (offset - half);
      positions[vertex + 3] = x + rightX * (offset + half);
      positions[vertex + 4] = LINE_Y;
      positions[vertex + 5] = z + rightZ * (offset + half);
    }
    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.setDrawRange(0, (count - 1) * 6);
  }
}
