import type { GameContent } from '../GameContent';
import { CARGO } from './cargo';
import { CITIES } from './cities';
import { DAYLIGHT } from './daylight';
import { DRIVERS } from './drivers';
import { MAPS } from './maps';
import { EVENTS } from './events';
import { MISSIONS } from './missions';
import { PAINTS } from './paints';
import { TRAFFIC_VEHICLES } from './trafficVehicles';
import { UPGRADES } from './upgrades';
import { VEHICLES } from './vehicles';
import { WEATHER } from './weather';

/** The built-in content shipped with the game. Validated at boot by ContentCatalog.create(). */
export const GAME_CONTENT: GameContent = {
  vehicles: VEHICLES,
  cargo: CARGO,
  cities: CITIES,
  missions: MISSIONS,
  maps: MAPS,
  upgrades: UPGRADES,
  trafficVehicles: TRAFFIC_VEHICLES,
  weather: WEATHER,
  daylight: DAYLIGHT,
  events: EVENTS,
  paints: PAINTS,
  drivers: DRIVERS,
};
