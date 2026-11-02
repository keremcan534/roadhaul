import type { Logger } from '../../core/logging/Logger';
import type { GameConfig } from '../../data/config/GameConfig';
import type { ContentCatalog } from '../../data/ContentCatalog';
import { ROAD_KINDS, type RoadKind } from '../../data/definitions/MapDefinition';
import { LaneGraph } from '../../domain/traffic/LaneGraph';
import { TrafficSimulation } from '../../domain/traffic/TrafficSimulation';
import { placeTrafficSignals, type TrafficSignals } from '../../domain/traffic/trafficSignals';
import type { DrivingWorld } from '../../domain/world/DrivingWorld';
import type { DrivingService } from '../driving/DrivingService';

/** Seeds the traffic of the first drive; each later drive takes the next seed. */
const FIRST_SEED = 20260922;

/**
 * Owns the NPC traffic around the truck (roadmap step 22, spec §19). It lays
 * the lanes of whichever world the truck drives in (once per map), keeps one
 * TrafficSimulation per drive, and makes its vehicles obstacles the truck
 * collides with. Call update() every fixed step before the truck moves;
 * presentation reads `simulation`.
 */
export class TrafficService {
  private current: TrafficSimulation | null = null;
  /** The drive the traffic belongs to (DrivingService.drive). */
  private drive = -1;
  private readonly graphs = new Map<string, LaneGraph>();
  private readonly signals = new Map<string, TrafficSignals | null>();
  private readonly speedLimits: Readonly<Record<RoadKind, number>>;
  private drives = 0;
  private speedFactor = 1;

  /** @param wrecks Whether the truck wrecks the cars and minibuses it drives into hard enough (CrashService). */
  constructor(
    private readonly driving: DrivingService,
    private readonly content: ContentCatalog,
    private readonly config: GameConfig['traffic'],
    private readonly logger: Logger,
    private readonly wrecks = false,
  ) {
    const limits = {} as Record<RoadKind, number>;
    for (const kind of ROAD_KINDS) {
      limits[kind] = config.speedLimitsKmh[kind] / 3.6;
    }
    this.speedLimits = limits;
  }

  /** The traffic of the current drive; null until the first update of a drive. */
  get simulation(): TrafficSimulation | null {
    return this.current;
  }

  /** Moves the traffic on by `dt` seconds. Nothing happens while no truck is driven. */
  update(dt: number): void {
    if (!this.driving.isDriving) {
      return;
    }
    const world = this.driving.world;
    if (this.driving.drive !== this.drive) {
      this.startDrive(world);
    }
    this.current!.update(dt, this.driving.vehicle, this.driving.footprint, this.driving.trailer, this.driving.trailerFootprint);
  }

  /** Slows all traffic to `factor` of its usual speed, in this drive and later ones (WeatherService). */
  setSpeedFactor(factor: number): void {
    this.speedFactor = factor;
    this.current?.setSpeedFactor(factor);
  }

  dispose(): void {
    this.driving.setMovingObstacles(null);
    this.current = null;
    this.drive = -1;
  }

  /** The traffic's time its lights keep, seconds (TrafficSimulation.signalSeconds); null while no traffic is simulated. */
  get signalSeconds(): number | null {
    return this.current?.signalSeconds ?? null;
  }

  /** `world`'s traffic lights (worked out once a map, with its lanes); null where it has none. */
  signalsOf(world: DrivingWorld): TrafficSignals | null {
    let signals = this.signals.get(world.id);
    if (signals === undefined) {
      signals = placeTrafficSignals(this.graphOf(world), world);
      this.signals.set(world.id, signals);
      if (signals !== null) {
        this.logger.info(`Traffic lights for ${world.id}: ${signals.junctionCount} junctions, ${signals.heads.length} heads.`);
      }
    }
    return signals;
  }

  /** `world`'s lanes, built the first time. */
  private graphOf(world: DrivingWorld): LaneGraph {
    let graph = this.graphs.get(world.id);
    if (graph === undefined) {
      graph = new LaneGraph(world, this.speedLimits);
      this.graphs.set(world.id, graph);
      this.logger.info(
        `Traffic lanes for ${world.id}: ${graph.linkCount} links, ${graph.nodeCount} junctions and turning circles.`,
      );
    }
    return graph;
  }

  /** A new drive: its world's lanes, and fresh traffic that fills the roads on the first step. */
  private startDrive(world: DrivingWorld): void {
    const graph = this.graphOf(world);
    const signals = this.signalsOf(world);
    this.drive = this.driving.drive;
    this.current = new TrafficSimulation(
      graph,
      this.content.trafficVehicles.all,
      {
        maxVehicles: this.config.maxVehicles,
        radiusMeters: this.config.radiusMeters,
        minSpawnDistanceMeters: this.config.minSpawnDistanceMeters,
        wrecks: this.wrecks,
        signals,
      },
      FIRST_SEED + this.drives++,
    );
    this.current.setSpeedFactor(this.speedFactor);
    this.driving.setMovingObstacles(this.current);
  }
}
