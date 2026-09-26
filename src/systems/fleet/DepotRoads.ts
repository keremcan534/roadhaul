import type { ContentCatalog } from '../../data/ContentCatalog';
import type { FleetJob, FleetMarket } from '../../domain/fleet/fleetJobs';
import type { DrivingWorld } from '../../domain/world/DrivingWorld';
import { createRouteTrace, type RouteTrace } from '../../domain/world/RoadNetwork';
import { createRouteGuidance } from '../../domain/world/roadRoute';
import type { DrivingService } from '../driving/DrivingService';

/** A contract's way on the map: the loading bay, the road from there sample by sample, and the next bay. */
export interface JobRoute {
  readonly x: Float64Array;
  readonly z: Float64Array;
  /** Metres from the first point. */
  readonly along: Float64Array;
  readonly length: number;
}

/** Where a truck is on the map, and the way it faces (for the map's markers). */
export interface MapPlacement {
  x: number;
  z: number;
  /** 0 faces +Z, π/2 faces +X. */
  heading: number;
}

/**
 * A company truck out on a contract, where the maps put it: one of the
 * fleet's (FleetService) or a rival's (RivalService).
 */
export interface CompanyTruckMarker extends MapPlacement {
  /**
   * Which truck, for as long as it exists (CompanyTraffic follows it by
   * this); '' for one that only the maps show (the rival racing the company
   * for a tender).
   */
  key: string;
  /** Its colour, 0xRRGGBB: its paint (the fleet's), or its company's (a rival's). */
  color: number;
  /** On the road, not standing at a depot. */
  moving: boolean;
  /** The city its contract ends in. */
  destinationCityId: string;
}

/**
 * The cities with a depot on the map being driven, the road between their
 * bays, and the way that road takes: what the fleet's and the rivals'
 * contracts are planned on (FleetMarket) and followed along on the map.
 * Each distance and way is worked out once and kept until another map is
 * driven.
 */
export class DepotRoads {
  private current: FleetMarket | null = null;
  private world: DrivingWorld | null = null;
  private trace: RouteTrace | null = null;
  private paces = new Float64Array(0);
  private readonly routes = new Map<string, JobRoute | null>();

  constructor(
    private readonly content: ContentCatalog,
    private readonly driving: DrivingService,
  ) {}

  /** The market on the map being driven; null while nothing is. */
  market(): FleetMarket | null {
    if (!this.driving.isDriving) {
      return null;
    }
    const world = this.driving.world;
    if (this.current === null || this.world !== world) {
      const guidance = createRouteGuidance();
      const distances = new Map<string, number>();
      this.world = world;
      this.routes.clear();
      this.current = {
        cities: this.content.cities.all.filter((city) => world.depotOf(city.id) !== undefined),
        cargo: this.content.cargo.all,
        distanceMeters: (originCityId, destinationCityId) => {
          const key = `${originCityId}>${destinationCityId}`;
          let meters = distances.get(key);
          if (meters === undefined) {
            const from = world.depotOf(originCityId)!.bay;
            const to = world.depotOf(destinationCityId)!.bay;
            meters = world.network.guide(from.x, from.z, to.x, to.z, guidance).distanceMeters;
            distances.set(key, meters);
          }
          return meters;
        },
      };
      this.trace = createRouteTrace(world.network);
      this.paces = new Float64Array(world.roads.length).fill(1);
    }
    return this.current;
  }

  /**
   * The way from `originCityId`'s bay to `destinationCityId`'s on the map
   * being driven; null while nothing is, or when either has no depot there.
   * Allocates only the first time for each pair.
   */
  route(originCityId: string, destinationCityId: string): JobRoute | null {
    if (this.market() === null) {
      return null;
    }
    const key = `${originCityId}>${destinationCityId}`;
    const known = this.routes.get(key);
    if (known !== undefined) {
      return known;
    }
    const world = this.driving.world;
    const from = world.depotOf(originCityId)?.bay;
    const to = world.depotOf(destinationCityId)?.bay;
    let route: JobRoute | null = null;
    if (from !== undefined && to !== undefined) {
      const trace = world.network.trace(from.x, from.z, to.x, to.z, this.paces, this.trace!);
      const count = trace.count + 2;
      const x = new Float64Array(count);
      const z = new Float64Array(count);
      const along = new Float64Array(count);
      x[0] = from.x;
      z[0] = from.z;
      x.set(trace.x.subarray(0, trace.count), 1);
      z.set(trace.z.subarray(0, trace.count), 1);
      x[count - 1] = to.x;
      z[count - 1] = to.z;
      for (let i = 1; i < count; i++) {
        along[i] = along[i - 1]! + Math.hypot(x[i]! - x[i - 1]!, z[i]! - z[i - 1]!);
      }
      route = { x, z, along, length: along[count - 1]! };
    }
    this.routes.set(key, route);
    return route;
  }
}

/**
 * Puts `placement` where a truck `elapsedSeconds` into `job` is along
 * `route`: at the first bay while it loads (the first half of
 * `handlingSeconds`), along the road at an even pace, and at the next bay
 * while it unloads. True while it is on the road. Allocation-free.
 */
export function placeOnJob(
  route: JobRoute,
  job: Pick<FleetJob, 'durationSeconds'>,
  elapsedSeconds: number,
  handlingSeconds: number,
  placement: MapPlacement,
): boolean {
  const handling = Math.min(handlingSeconds, job.durationSeconds) / 2;
  const drive = Math.max(1e-6, job.durationSeconds - 2 * handling);
  const share = Math.min(1, Math.max(0, (elapsedSeconds - handling) / drive));
  placeAlong(route, share * route.length, placement);
  return elapsedSeconds > handling && share < 1;
}

/** Puts `placement` `distance` metres along `route`, facing along it. Allocation-free. */
export function placeAlong(route: JobRoute, distance: number, placement: MapPlacement): void {
  const along = route.along;
  const last = along.length - 1;
  let i = 1;
  while (i < last && along[i]! < distance) {
    i++;
  }
  const x0 = route.x[i - 1]!;
  const z0 = route.z[i - 1]!;
  const x1 = route.x[i]!;
  const z1 = route.z[i]!;
  const span = along[i]! - along[i - 1]!;
  const t = span > 1e-9 ? Math.min(1, Math.max(0, (distance - along[i - 1]!) / span)) : 1;
  placement.x = x0 + (x1 - x0) * t;
  placement.z = z0 + (z1 - z0) * t;
  if (Math.abs(x1 - x0) + Math.abs(z1 - z0) > 1e-9) {
    placement.heading = Math.atan2(x1 - x0, z1 - z0);
  }
}
