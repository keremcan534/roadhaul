import type { EventBus } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import type { GameConfig } from '../../data/config/GameConfig';
import { CITY_INCIDENT_KINDS, type CityIncidentKind, type CityVehicleKind } from '../../data/definitions/CityIncident';
import { weighted } from '../../domain/rewards/crates';
import { NIGHT_FROM } from '../../domain/sky/skyWonders';
import {
  createRoadSpot,
  nearestCityId,
  nearestRoadSpot,
  pickBurningBuilding,
  pickRoadSpot,
} from '../../domain/world/cityIncidents';
import type { DrivingWorld } from '../../domain/world/DrivingWorld';
import { createRouteTrace, type RouteTrace } from '../../domain/world/RoadNetwork';
import type { GameEvents } from '../GameEvents';

/** What the incidents need of the truck: whether it is on the map, where, and the map. */
export interface IncidentWitness {
  readonly isDriving: boolean;
  readonly vehicle: { readonly x: number; readonly z: number; readonly heading: number };
  readonly world: DrivingWorld;
}

/** An incident under way. */
export interface CityIncident {
  readonly kind: CityIncidentKind;
  /** Where it is: the burning building's middle, the chase's start, the fireworks' launch. */
  readonly x: number;
  readonly z: number;
  /** The fire's building: its box and height. Zero for the others. */
  readonly halfWidthX: number;
  readonly halfWidthZ: number;
  readonly heightMeters: number;
  /** The city it is in or nearest. */
  readonly cityId: string | null;
  readonly durationSeconds: number;
}

/** The most vehicles an incident brings. */
export const MAX_INCIDENT_VEHICLES = 3;
/** The chase: the police this far behind the car they chase, and the second car further, meters. */
const CHASE_GAPS = [0, 24, 48] as const;
/** The chase is driven this far right of the road's middle, meters: in its lane. */
const CHASE_LANE_OFFSET = 1.9;
/** The chase runs to a road behind the truck, this far from it, from–to, meters: it comes past. */
const CHASE_REACH: readonly [number, number] = [400, 1200];
/** The responders park this far in from the road's edge, toward the fire, meters. */
const PARK_IN_FROM_EDGE = 1.6;
/** …the ambulance behind the fire engine and a police car ahead, this far along the road, meters. */
const AMBULANCE_BEHIND = 13;
const POLICE_AHEAD = 12;
/** Tries again this soon when nothing fitted where the truck is, seconds. */
const RETRY_SECONDS = 20;
/** The chase's route is a straight line after this many samples it could not follow. */
const MIN_ROUTE_SAMPLES = 12;

const FIRE_VEHICLES: readonly CityVehicleKind[] = ['fire_engine', 'ambulance', 'police'];
const CHASE_VEHICLES: readonly CityVehicleKind[] = ['getaway', 'police', 'police'];
const NO_VEHICLES: readonly CityVehicleKind[] = [];

/**
 * The region's rare happenings (GameConfig.cityLife): now and then, while
 * the truck drives, something happens near it, where the player can see it:
 * a town's building catches fire and the fire brigade, an ambulance and the
 * police come to it; the police chase a car down the roads; after dark,
 * fireworks over a town. One at a time, a few minutes apart, each for a few
 * minutes. It says when one starts and ends (CityIncidentStarted,
 * CityIncidentEnded): the news and the presentation follow. Its vehicles
 * (`vehicleX`, `vehicleZ`, `vehicleHeading`, `vehicleKinds`) are seen, not
 * driven into. Nothing is saved.
 *
 * Call update() every fixed step. Allocation-free while an incident runs or
 * waits; starting one looks over the map once.
 */
export class CityIncidentService {
  private current: CityIncident | null = null;
  private elapsed = 0;
  private untilNext: number;
  private forced: CityIncidentKind | null = null;
  private kinds: readonly CityVehicleKind[] = NO_VEHICLES;
  /** Where each vehicle is, and which way it faces (radians, 0 along +z). */
  readonly vehicleX = new Float64Array(MAX_INCIDENT_VEHICLES);
  readonly vehicleZ = new Float64Array(MAX_INCIDENT_VEHICLES);
  readonly vehicleHeading = new Float64Array(MAX_INCIDENT_VEHICLES);
  private route: RouteTrace | null = null;
  private routeWorld: DrivingWorld | null = null;
  private paces: Float64Array = new Float64Array(0);
  private readonly cursors = new Int32Array(MAX_INCIDENT_VEHICLES);
  private readonly spot = createRoadSpot();
  private readonly target = createRoadSpot();

  constructor(
    private readonly config: GameConfig['cityLife'],
    private readonly truck: IncidentWitness,
    private readonly sky: { readonly weights: { readonly night: number } },
    /** Uniform in [0, 1): a seeded generator in tests. */
    private readonly random: () => number,
    private readonly events: EventBus<GameEvents>,
    private readonly logger: Logger,
  ) {
    this.untilNext = config.firstAfterSeconds;
  }

  /** The incident under way, or null. */
  get incident(): CityIncident | null {
    return this.current;
  }

  /** How long the incident has been under way, seconds. */
  get elapsedSeconds(): number {
    return this.elapsed;
  }

  /** The vehicles it brought, in the order of `vehicleX`…: none for fireworks. */
  get vehicleKinds(): readonly CityVehicleKind[] {
    return this.kinds;
  }

  /** Starts an incident of `kind` at the next step, whatever the time (`?city=`, for a look). */
  force(kind: CityIncidentKind): void {
    this.forced = kind;
  }

  /** Moves `dt` seconds on: the incident under way runs on and ends; the next comes in its time. */
  update(dt: number): void {
    if (!this.truck.isDriving) {
      return;
    }
    const incident = this.current;
    if (incident !== null) {
      this.elapsed += dt;
      const chaseOver = incident.kind === 'police_chase' && !this.moveChase();
      if (chaseOver || this.elapsed >= incident.durationSeconds) {
        this.end(incident, chaseOver);
      }
      return;
    }
    this.untilNext -= dt;
    if (this.forced === null && this.untilNext > 0) {
      return;
    }
    const kind = this.forced ?? this.pickKind();
    this.forced = null;
    if (kind === null || !this.start(kind)) {
      this.untilNext = RETRY_SECONDS;
    }
  }

  private pickKind(): CityIncidentKind | null {
    const dark = this.sky.weights.night >= NIGHT_FROM;
    const weights = this.config.weights;
    // Fireworks only after dark: without them the others share the draw.
    return weighted(
      CITY_INCIDENT_KINDS,
      dark ? weights : { ...weights, fireworks: 0 },
      this.random(),
    );
  }

  private start(kind: CityIncidentKind): boolean {
    const { x, z, heading } = this.truck.vehicle;
    const world = this.truck.world;
    const { nearMeters, farMeters } = this.config;
    let incident: CityIncident | null = null;
    switch (kind) {
      case 'building_fire': {
        const building = pickBurningBuilding(world.buildings, x, z, heading, nearMeters, farMeters, this.random());
        if (building === null || !this.parkResponders(world, building)) {
          return false;
        }
        const cx = (building.minX + building.maxX) / 2;
        const cz = (building.minZ + building.maxZ) / 2;
        incident = {
          kind,
          x: cx,
          z: cz,
          halfWidthX: (building.maxX - building.minX) / 2,
          halfWidthZ: (building.maxZ - building.minZ) / 2,
          heightMeters: building.heightMeters,
          cityId: nearestCityId(world.depots, cx, cz),
          durationSeconds: this.config.durationSeconds[kind],
        };
        this.kinds = FIRE_VEHICLES;
        break;
      }
      case 'police_chase': {
        if (!this.planChase(world, x, z, heading)) {
          return false;
        }
        incident = {
          kind,
          x: this.spot.x,
          z: this.spot.z,
          halfWidthX: 0,
          halfWidthZ: 0,
          heightMeters: 0,
          cityId: nearestCityId(world.depots, this.spot.x, this.spot.z),
          durationSeconds: this.config.durationSeconds[kind],
        };
        this.kinds = CHASE_VEHICLES;
        break;
      }
      case 'fireworks': {
        // Out in front of the truck, far enough to be seen over the roofs.
        const reach = farMeters * 0.8;
        const side = (this.random() - 0.5) * reach * 0.6;
        const fx = x + Math.sin(heading) * reach + Math.cos(heading) * side;
        const fz = z + Math.cos(heading) * reach - Math.sin(heading) * side;
        incident = {
          kind,
          x: fx,
          z: fz,
          halfWidthX: 0,
          halfWidthZ: 0,
          heightMeters: 0,
          cityId: nearestCityId(world.depots, fx, fz),
          durationSeconds: this.config.durationSeconds[kind],
        };
        this.kinds = NO_VEHICLES;
        break;
      }
    }
    this.current = incident;
    this.elapsed = 0;
    this.logger.info(`City incident: ${kind} in ${incident.cityId ?? 'the country'}.`);
    this.events.emit('CityIncidentStarted', { kind, cityId: incident.cityId, x: incident.x, z: incident.z });
    return true;
  }

  private end(incident: CityIncident, caught: boolean): void {
    this.current = null;
    this.kinds = NO_VEHICLES;
    const [least, most] = this.config.gapSeconds;
    this.untilNext = least + (most - least) * this.random();
    this.events.emit('CityIncidentEnded', { kind: incident.kind, cityId: incident.cityId, caught });
  }

  /** The fire engine, the ambulance and a police car, parked along the road nearest `building`, its side of it. */
  private parkResponders(world: DrivingWorld, building: { minX: number; maxX: number; minZ: number; maxZ: number }): boolean {
    const cx = (building.minX + building.maxX) / 2;
    const cz = (building.minZ + building.maxZ) / 2;
    const spot = this.spot;
    if (!nearestRoadSpot(world.roads, cx, cz, spot)) {
      return false;
    }
    // Right of the road's direction: (−dz, dx). The building's side of the road decides which edge they park at.
    const rightX = -spot.directionZ;
    const rightZ = spot.directionX;
    const side = (cx - spot.x) * rightX + (cz - spot.z) * rightZ >= 0 ? 1 : -1;
    const across = side * Math.max(0, spot.halfWidthMeters - PARK_IN_FROM_EDGE);
    const heading = Math.atan2(spot.directionX * side, spot.directionZ * side);
    const along = [0, -AMBULANCE_BEHIND * side, POLICE_AHEAD * side];
    for (let i = 0; i < FIRE_VEHICLES.length; i++) {
      this.vehicleX[i] = spot.x + rightX * across + spot.directionX * along[i]!;
      this.vehicleZ[i] = spot.z + rightZ * across + spot.directionZ * along[i]!;
      this.vehicleHeading[i] = heading;
    }
    return true;
  }

  /** A route by road for the chase: from a road ahead of the truck to one behind it, so it comes past. */
  private planChase(world: DrivingWorld, x: number, z: number, heading: number): boolean {
    const { nearMeters, farMeters } = this.config;
    if (!pickRoadSpot(world.roads, x, z, heading, nearMeters, farMeters, this.random(), this.spot)) {
      return false;
    }
    if (!pickRoadSpot(world.roads, x, z, heading + Math.PI, CHASE_REACH[0], CHASE_REACH[1], this.random(), this.target)) {
      return false;
    }
    if (this.routeWorld !== world) {
      this.route = createRouteTrace(world.network);
      this.paces = new Float64Array(world.roads.length).fill(this.config.chaseSpeed);
      this.routeWorld = world;
    }
    const route = world.network.trace(this.spot.x, this.spot.z, this.target.x, this.target.z, this.paces, this.route!);
    if (!route.connected || route.count < MIN_ROUTE_SAMPLES) {
      return false;
    }
    this.cursors.fill(0);
    this.moveChase();
    return true;
  }

  /** Moves the chase on along its route; false once the car they chase has reached its end. */
  private moveChase(): boolean {
    const route = this.route!;
    const last = route.count - 1;
    const end = route.along[last]!;
    const lead = CHASE_GAPS[CHASE_GAPS.length - 1]! + this.elapsed * this.config.chaseSpeed;
    for (let i = 0; i < CHASE_VEHICLES.length; i++) {
      const distance = Math.min(end, Math.max(0, lead - CHASE_GAPS[i]!));
      let k = this.cursors[i]!;
      while (k < last - 1 && route.along[k + 1]! < distance) {
        k++;
      }
      this.cursors[i] = k;
      const d0 = route.along[k]!;
      const d1 = route.along[k + 1]!;
      const t = d1 > d0 ? Math.min(1, Math.max(0, (distance - d0) / (d1 - d0))) : 0;
      const dx = route.x[k + 1]! - route.x[k]!;
      const dz = route.z[k + 1]! - route.z[k]!;
      const length = Math.sqrt(dx * dx + dz * dz) || 1;
      // Right of the way it goes: (−dz, dx) over its length.
      this.vehicleX[i] = route.x[k]! + dx * t + (-dz / length) * CHASE_LANE_OFFSET;
      this.vehicleZ[i] = route.z[k]! + dz * t + (dx / length) * CHASE_LANE_OFFSET;
      this.vehicleHeading[i] = Math.atan2(dx, dz);
    }
    return lead < end;
  }
}
