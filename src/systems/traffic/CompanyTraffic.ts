import { laneRouteTo, type LaneRoute } from '../../domain/traffic/laneRoutes';
import type { LaneGraph } from '../../domain/traffic/LaneGraph';
import type { TrafficSimulation } from '../../domain/traffic/TrafficSimulation';
import type { DrivingService } from '../driving/DrivingService';
import type { CompanyTruckMarker, MapPlacement } from '../fleet/DepotRoads';

/** Company trucks the maps put somewhere along their roads: the fleet's (FleetService) or the rivals' (RivalService). */
export interface CompanyTruckSource {
  readonly markers: readonly CompanyTruckMarker[];
  /** Fills `markers` and returns how many there are. */
  updateMarkers(): number;
}

/** The traffic company trucks join (TrafficService). */
export interface TrafficSource {
  readonly simulation: TrafficSimulation | null;
}

/** How often it looks for company trucks to bring into the traffic, seconds. */
const CHECK_SECONDS = 0.25;
/** A depot is reached on the lanes that pass this much further from it than the nearest. */
const DEPOT_REACH_METERS = 25;

/** A company truck it has seen on the maps. */
interface TrackedTruck {
  readonly key: string;
  /** Its id as a guest in the traffic. */
  readonly id: number;
  /** Its slot in the traffic, or -1 while it is not in it. */
  slot: number;
  /** It has left the traffic: it comes back only once it has been out of the traffic's reach. */
  waitingOutOfReach: boolean;
  /** On the maps at the last look. */
  seen: boolean;
}

/**
 * The company's fleet and the rivals on the road around the truck. The maps
 * put every company truck on a contract somewhere along its road
 * (CompanyTruckSource); CompanyTraffic brings those within the traffic's
 * reach into it, as lorries in their colours (TrafficSimulation guests),
 * where and when traffic appears (out of sight), heading for the depot
 * their contracts end at. There they leave the road. While one drives in
 * the traffic, the maps show it where it is (placeInTraffic). A truck that
 * has left the traffic comes back only after it has been out of reach, so
 * it never shows twice.
 *
 * Call update() every fixed step, after the traffic. Allocation-free, but
 * for the first time it meets a truck and the first time a map is driven to
 * each depot.
 */
export class CompanyTraffic {
  private readonly tracked: TrackedTruck[] = [];
  private simulation: TrafficSimulation | null = null;
  private graph: LaneGraph | null = null;
  private readonly routes = new Map<string, LaneRoute | null>();
  /** The kind of traffic vehicle company trucks drive as (a lorry); -1 when the traffic has none. */
  private truckType = -1;
  private sinceCheck = CHECK_SECONDS;

  constructor(
    private readonly traffic: TrafficSource,
    private readonly sources: readonly CompanyTruckSource[],
    private readonly driving: DrivingService,
    /** GameConfig.traffic.radiusMeters. */
    private readonly radiusMeters: number,
  ) {}

  /** Company trucks driving in the traffic now. */
  get inTraffic(): number {
    let count = 0;
    for (let i = 0; i < this.tracked.length; i++) {
      if (this.isInTraffic(this.tracked[i]!)) {
        count++;
      }
    }
    return count;
  }

  update(dt: number): void {
    const simulation = this.traffic.simulation;
    if (simulation === null || !this.driving.isDriving) {
      return;
    }
    if (simulation !== this.simulation) {
      this.startTraffic(simulation);
    }
    this.sinceCheck += dt;
    if (this.sinceCheck < CHECK_SECONDS || this.truckType < 0) {
      return;
    }
    this.sinceCheck = 0;
    const tracked = this.tracked;
    for (let i = 0; i < tracked.length; i++) {
      const truck = tracked[i]!;
      truck.seen = false;
      if (truck.slot >= 0 && !this.isInTraffic(truck)) {
        truck.slot = -1; // Gone: out of reach, or there and out of sight.
        truck.waitingOutOfReach = true;
      }
    }
    for (let s = 0; s < this.sources.length; s++) {
      const source = this.sources[s]!;
      const count = source.updateMarkers();
      for (let m = 0; m < count; m++) {
        this.consider(simulation, source.markers[m]!);
      }
    }
    // Gone from the maps (called back to the garage, a rival bought out): its lorry drives on and leaves.
    for (let i = 0; i < tracked.length; i++) {
      const truck = tracked[i]!;
      if (!truck.seen && truck.slot >= 0) {
        simulation.releaseGuest(truck.slot);
        truck.slot = -1;
      }
    }
  }

  /**
   * Puts `placement` where company truck `key` drives in the traffic and
   * returns true; false while it is not in the traffic (the maps' own
   * placement stands). Allocation-free.
   */
  placeInTraffic(key: string, placement: MapPlacement): boolean {
    const simulation = this.simulation;
    if (key === '' || simulation === null || simulation !== this.traffic.simulation) {
      return false;
    }
    for (let i = 0; i < this.tracked.length; i++) {
      const truck = this.tracked[i]!;
      if (truck.key === key) {
        if (!this.isInTraffic(truck)) {
          return false;
        }
        placement.x = simulation.x[truck.slot]!;
        placement.z = simulation.z[truck.slot]!;
        placement.heading = simulation.heading[truck.slot]!;
        return true;
      }
    }
    return false;
  }

  /** Brings the truck `marker` shows into the traffic if it may come now. */
  private consider(simulation: TrafficSimulation, marker: CompanyTruckMarker): void {
    if (marker.key === '') {
      return; // Only the maps show it.
    }
    const truck = this.trackedTruck(marker.key);
    truck.seen = true;
    if (truck.slot >= 0) {
      return;
    }
    const vehicle = this.driving.vehicle;
    const distance = Math.hypot(marker.x - vehicle.x, marker.z - vehicle.z);
    if (truck.waitingOutOfReach) {
      truck.waitingOutOfReach = distance <= this.radiusMeters;
      return;
    }
    if (!marker.moving || distance > this.radiusMeters) {
      return;
    }
    const route = this.routeTo(simulation.graph, marker.destinationCityId);
    if (route !== null) {
      truck.slot = simulation.addGuest(truck.id, this.truckType, marker.color, marker.x, marker.z, marker.heading, route);
    }
  }

  private isInTraffic(truck: TrackedTruck): boolean {
    const simulation = this.simulation;
    return (
      truck.slot >= 0 && simulation !== null && simulation.active[truck.slot] === 1 && simulation.guest[truck.slot] === truck.id
    );
  }

  /** The truck known by `key`: allocates the first time it is met. */
  private trackedTruck(key: string): TrackedTruck {
    const tracked = this.tracked;
    for (let i = 0; i < tracked.length; i++) {
      if (tracked[i]!.key === key) {
        return tracked[i]!;
      }
    }
    const truck: TrackedTruck = { key, id: tracked.length, slot: -1, waitingOutOfReach: false, seen: false };
    tracked.push(truck);
    return truck;
  }

  /** The way through the lanes to `cityId`'s depot on the map being driven; null where it has none. */
  private routeTo(graph: LaneGraph, cityId: string): LaneRoute | null {
    let route = this.routes.get(cityId);
    if (route === undefined) {
      const depot = this.driving.world.depotOf(cityId);
      route = depot === undefined ? null : laneRouteTo(graph, depot.bay.x, depot.bay.z, DEPOT_REACH_METERS);
      this.routes.set(cityId, route);
    }
    return route;
  }

  /** A new drive's traffic: nobody is in it yet, and its lanes may be another map's. */
  private startTraffic(simulation: TrafficSimulation): void {
    this.simulation = simulation;
    if (simulation.graph !== this.graph) {
      this.graph = simulation.graph;
      this.routes.clear();
    }
    this.truckType = simulation.types.findIndex((type) => type.kind === 'truck');
    for (let i = 0; i < this.tracked.length; i++) {
      this.tracked[i]!.slot = -1;
      this.tracked[i]!.waitingOutOfReach = false;
    }
    this.sinceCheck = CHECK_SECONDS;
  }
}
