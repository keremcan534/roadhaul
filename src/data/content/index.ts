import type { GameContent } from '../GameContent';
import { CARGO } from './cargo';
import { CITIES } from './cities';
import { MAPS } from './maps';
import { MISSIONS } from './missions';
import { VEHICLES } from './vehicles';

/** The built-in content shipped with the game. Validated at boot by ContentCatalog.create(). */
export const GAME_CONTENT: GameContent = {
  vehicles: VEHICLES,
  cargo: CARGO,
  cities: CITIES,
  missions: MISSIONS,
  maps: MAPS,
};
