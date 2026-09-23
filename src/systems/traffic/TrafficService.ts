import type { Logger } from '../../core/logging/Logger';
import type { GameConfig } from '../../data/config/GameConfig';
import type { ContentCatalog } from '../../data/ContentCatalog';
import { ROAD_KINDS, type RoadKind } from '../../data/definitions/MapDefinition';
import { LaneGraph } from '../../domain/traffic/LaneGraph';
import { TrafficSimulation } from '../../domain/traffic/TrafficSimulation';
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
  private world: DrivingWorld | null = null;
  private readonly graphs = new Map<string, LaneGraph>();
  private readonly speedLimits: Readonly<Record<RoadKind, number>>;
  private drives = 0;

  constructor(
    private readonly driving: DrivingService,
    private readonly content: ContentCatalog,
    private readonly config: GameConfig['traffic'],
    private readonly logger: Logger,
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
    if (world !== this.world) {
      this.startDrive(world);
    }
    this.current!.update(dt, this.driving.vehicle, this.driving.footprint);
  }

  dispose(): void {
    this.driving.setMovingObstacles(null);
    this.current = null;
    this.world = null;
  }

  /** A new world (a new drive): its lanes, and fresh traffic that fills the roads on the first step. */
  private startDrive(world: DrivingWorld): void {
    let graph = this.graphs.get(world.id);
    if (graph === undefined) {
      graph = new LaneGraph(world, this.speedLimits);
      this.graphs.set(world.id, graph);
      this.logger.info(
        `Traffic lanes for ${world.id}: ${graph.linkCount} links, ${graph.nodeCount} junctions and turning circles.`,
      );
    }
    this.world = world;
    this.current = new TrafficSimulation(
      graph,
      this.content.trafficVehicles.all,
      {
        maxVehicles: this.config.maxVehicles,
        radiusMeters: this.config.radiusMeters,
        minSpawnDistanceMeters: this.config.minSpawnDistanceMeters,
      },
      FIRST_SEED + this.drives++,
    );
    this.driving.setMovingObstacles(this.current);
  }
}
