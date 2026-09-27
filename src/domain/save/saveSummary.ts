import type { ContentCatalog } from '../../data/ContentCatalog';
import type { Credits } from '../../data/units';
import type { MissionState } from '../missions/MissionInstance';
import type { SaveGameData, TruckPlacementSaveData } from './SaveGameData';

/** A saved company at a glance, for the main menu (GameSessionService.readSave). */
export interface SaveSummary {
  readonly companyName: string;
  readonly level: number;
  readonly credits: Credits;
  /** The trucks the company owns, the drivers it has hired and the deliveries it has made. */
  readonly trucks: number;
  readonly drivers: number;
  readonly deliveries: number;
  /** The model of the truck the player drives (VehicleDefinition id). */
  readonly truckModelId: string;
  /** The map the truck is on, and where on it the truck was left: null for the map's own start. */
  readonly mapId: string;
  readonly truck: TruckPlacementSaveData | null;
  /** The contract under way, or null. */
  readonly contract: SavedContract | null;
  /** When the save was written, Unix epoch milliseconds. */
  readonly updatedAtMs: number;
}

/** The contract under way in a save: what it carries, from where to where, and how far along it is. */
export interface SavedContract {
  readonly missionId: string;
  readonly cargoId: string;
  readonly originCityId: string;
  readonly destinationCityId: string;
  readonly state: MissionState;
}

/**
 * What the main menu shows of `save` (validated, so its contract is a
 * contract of the day saved whole or one of the game's own in `content`).
 */
export function summarizeSave(save: SaveGameData, content: ContentCatalog): SaveSummary {
  const active = save.garage.vehicles.find((vehicle) => vehicle.instanceId === save.garage.activeVehicleInstanceId);
  const mission = save.missions.active;
  const definition = mission === null ? null : (mission.contract ?? content.missions.get(mission.missionId));
  return {
    companyName: save.profile.companyName,
    level: save.company.level,
    credits: save.economy.credits,
    trucks: save.garage.vehicles.length,
    drivers: save.fleet.drivers.length,
    deliveries: save.stats.deliveriesCompleted,
    truckModelId: active?.definitionId ?? save.garage.vehicles[0]!.definitionId,
    mapId: save.world.mapId,
    truck: save.world.truck,
    contract:
      mission === null || definition === null
        ? null
        : {
            missionId: mission.missionId,
            cargoId: definition.cargoId,
            originCityId: definition.originCityId,
            destinationCityId: definition.destinationCityId,
            state: mission.state,
          },
    updatedAtMs: save.updatedAtMs,
  };
}
