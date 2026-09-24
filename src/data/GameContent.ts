import type { CargoDefinition } from './definitions/CargoDefinition';
import type { CityDefinition } from './definitions/CityDefinition';
import type { EventDefinition } from './definitions/EventDefinition';
import type { MapDefinition } from './definitions/MapDefinition';
import type { MissionDefinition } from './definitions/MissionDefinition';
import type { PaintDefinition } from './definitions/PaintDefinition';
import type { TrafficVehicleDefinition } from './definitions/TrafficVehicleDefinition';
import type { UpgradeDefinition } from './definitions/UpgradeDefinition';
import type { VehicleDefinition } from './definitions/VehicleDefinition';
import type { WeatherDefinition } from './definitions/WeatherDefinition';

/**
 * Every static definition the game knows about. Today it is authored as
 * TypeScript in `src/data/content`; later content packs (spec §79) can supply
 * the same shape as JSON. Either way it goes through ContentCatalog.create(),
 * which validates it.
 */
export interface GameContent {
  readonly vehicles: readonly VehicleDefinition[];
  readonly cargo: readonly CargoDefinition[];
  readonly cities: readonly CityDefinition[];
  readonly missions: readonly MissionDefinition[];
  readonly maps: readonly MapDefinition[];
  readonly upgrades: readonly UpgradeDefinition[];
  readonly trafficVehicles: readonly TrafficVehicleDefinition[];
  readonly weather: readonly WeatherDefinition[];
  readonly events: readonly EventDefinition[];
  readonly paints: readonly PaintDefinition[];
}
