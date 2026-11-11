import type { MapDefinition } from '../../data/definitions/MapDefinition';
import { nearestDepotCity } from '../../domain/world/startPlaces';
import type { Strings } from '../i18n';

/**
 * The name the new company dialog offers for a company founded on `map`: after its home town, the city of the depot
 * nearest the map's start (`newCompany.suggested`, "Havenport Haulage"). Empty on a map without depots.
 */
export function suggestedCompanyName(strings: Strings, map: MapDefinition): string {
  const cityId = nearestDepotCity(map.depots, map.spawn.x, map.spawn.z);
  return cityId === null ? '' : strings.t('newCompany.suggested', { city: strings.t(`city.${cityId}.name`) });
}
