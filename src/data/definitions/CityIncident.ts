/**
 * The rare things that happen in the region now and then, near the truck
 * (CityIncidentService): a building on fire with the fire brigade and an
 * ambulance at it, a police chase down the roads, fireworks over a town at
 * night.
 */
export const CITY_INCIDENT_KINDS = ['building_fire', 'police_chase', 'fireworks'] as const;
export type CityIncidentKind = (typeof CITY_INCIDENT_KINDS)[number];

export function isCityIncidentKind(value: unknown): value is CityIncidentKind {
  return typeof value === 'string' && (CITY_INCIDENT_KINDS as readonly string[]).includes(value);
}

/** The vehicles an incident brings: the fire brigade's engine, an ambulance, police cars and the car they chase. */
export const CITY_VEHICLE_KINDS = ['fire_engine', 'ambulance', 'police', 'getaway'] as const;
export type CityVehicleKind = (typeof CITY_VEHICLE_KINDS)[number];
