import { frozenCopy } from '../core/objects/frozenCopy';
import { ValidationError, Validator, type ValidationIssue } from '../core/validation/Validator';
import { validateCargoDefinition, type CargoDefinition } from './definitions/CargoDefinition';
import { validateCityDefinition, type CityDefinition } from './definitions/CityDefinition';
import { validateDriverDefinition, type DriverDefinition } from './definitions/DriverDefinition';
import { validateEventDefinition, type EventDefinition } from './definitions/EventDefinition';
import { validateMapDefinition, type MapDefinition } from './definitions/MapDefinition';
import {
  GENERATED_MISSION_ID_PREFIX,
  validateMissionDefinition,
  vehicleCanHaul,
  type MissionDefinition,
} from './definitions/MissionDefinition';
import {
  validateTrafficVehicleDefinition,
  type TrafficVehicleDefinition,
} from './definitions/TrafficVehicleDefinition';
import { validatePaintDefinition, type PaintDefinition } from './definitions/PaintDefinition';
import { validateRivalCompanyDefinition, type RivalCompanyDefinition } from './definitions/RivalCompanyDefinition';
import { validateUpgradeDefinition, type UpgradeDefinition } from './definitions/UpgradeDefinition';
import { validateVehicleDefinition, type VehicleDefinition } from './definitions/VehicleDefinition';
import {
  DAYLIGHT_PHASES,
  validateDaylightDefinition,
  type DaylightDefinition,
} from './definitions/DaylightDefinition';
import { validateWeatherDefinition, type WeatherDefinition } from './definitions/WeatherDefinition';
import type { GameContent } from './GameContent';

/** Read-only lookup of one kind of definition by id. */
export class DefinitionTable<T extends { readonly id: string }> {
  private readonly byId: ReadonlyMap<string, T>;

  constructor(
    /** Human-readable kind used in error messages, e.g. "vehicle". */
    readonly kind: string,
    readonly all: readonly T[],
  ) {
    this.byId = new Map(all.map((definition) => [definition.id, definition]));
  }

  get size(): number {
    return this.all.length;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  find(id: string): T | undefined {
    return this.byId.get(id);
  }

  /** Throws for unknown ids: use it where the id has already been validated. */
  get(id: string): T {
    const definition = this.byId.get(id);
    if (definition === undefined) {
      throw new Error(`Unknown ${this.kind} "${id}".`);
    }
    return definition;
  }
}

/**
 * The validated, immutable set of static definitions: the single place game
 * code looks definitions up. Definitions are deep-frozen: runtime state must
 * live elsewhere (the domain layer) and reference definitions by id.
 */
export class ContentCatalog {
  readonly vehicles: DefinitionTable<VehicleDefinition>;
  readonly cargo: DefinitionTable<CargoDefinition>;
  readonly cities: DefinitionTable<CityDefinition>;
  readonly missions: DefinitionTable<MissionDefinition>;
  readonly maps: DefinitionTable<MapDefinition>;
  readonly upgrades: DefinitionTable<UpgradeDefinition>;
  readonly trafficVehicles: DefinitionTable<TrafficVehicleDefinition>;
  readonly weather: DefinitionTable<WeatherDefinition>;
  /** The times of day with a look of their own, one of each DAYLIGHT_PHASES. */
  readonly daylight: DefinitionTable<DaylightDefinition>;
  readonly events: DefinitionTable<EventDefinition>;
  readonly paints: DefinitionTable<PaintDefinition>;
  readonly drivers: DefinitionTable<DriverDefinition>;
  readonly rivals: DefinitionTable<RivalCompanyDefinition>;

  private constructor(content: GameContent) {
    this.vehicles = new DefinitionTable('vehicle', content.vehicles);
    this.cargo = new DefinitionTable('cargo', content.cargo);
    this.cities = new DefinitionTable('city', content.cities);
    this.missions = new DefinitionTable('mission', content.missions);
    this.maps = new DefinitionTable('map', content.maps);
    this.upgrades = new DefinitionTable('upgrade', content.upgrades);
    this.trafficVehicles = new DefinitionTable('traffic vehicle', content.trafficVehicles);
    this.weather = new DefinitionTable('weather', content.weather);
    this.daylight = new DefinitionTable('daylight', content.daylight);
    this.events = new DefinitionTable('event', content.events);
    this.paints = new DefinitionTable('paint', content.paints);
    this.drivers = new DefinitionTable('driver', content.drivers);
    this.rivals = new DefinitionTable('rival company', content.rivals);
  }

  /** Validates `content` and builds a catalog from a frozen copy. Throws a ValidationError listing every problem. */
  static create(content: GameContent): ContentCatalog {
    const issues = validateGameContent(content);
    if (issues.length > 0) {
      throw new ValidationError('Game content', issues);
    }
    return new ContentCatalog(frozenCopy(content));
  }
}

/** Checks every definition and every cross-reference between definitions. */
export function validateGameContent(content: GameContent): readonly ValidationIssue[] {
  const validator = new Validator();
  validateTable(validator, 'vehicles', content.vehicles, validateVehicleDefinition);
  validateTable(validator, 'cargo', content.cargo, validateCargoDefinition);
  validateTable(validator, 'cities', content.cities, validateCityDefinition);
  validateTable(validator, 'missions', content.missions, validateMissionDefinition);
  validateTable(validator, 'maps', content.maps, validateMapDefinition);
  validateTable(validator, 'upgrades', content.upgrades, validateUpgradeDefinition);
  validateTable(validator, 'trafficVehicles', content.trafficVehicles, validateTrafficVehicleDefinition);
  validateTable(validator, 'weather', content.weather, validateWeatherDefinition);
  validateTable(validator, 'daylight', content.daylight, validateDaylightDefinition);
  validateTable(validator, 'events', content.events, validateEventDefinition);
  validateTable(validator, 'paints', content.paints, validatePaintDefinition);
  validateTable(validator, 'drivers', content.drivers, validateDriverDefinition);
  validateTable(validator, 'rivals', content.rivals, validateRivalCompanyDefinition);
  validateMissionReferences(validator, content);
  validateDepotReferences(validator, content);
  validateWeatherSuccessions(validator, content);
  validateDaylightPhases(validator, content);
  validateRivalReferences(validator, content);
  return validator.issues;
}

/** Every weather a weather may turn into exists. */
function validateWeatherSuccessions(validator: Validator, content: GameContent): void {
  if (!Array.isArray(content.weather)) {
    return; // Already reported by validateTable.
  }
  const ids = new Set(content.weather.filter(isObject).map((weather) => weather.id));
  content.weather.forEach((weather, index) => {
    if (isObject(weather) && Array.isArray(weather.next)) {
      (weather.next as readonly string[]).forEach((id: string, nextIndex: number) => {
        validator.check(ids.has(id), `weather[${index}].next[${nextIndex}]`, `unknown weather "${id}"`);
      });
    }
  });
}

/** Every time of day with a look of its own is there, and night falls after dusk and dawn. */
function validateDaylightPhases(validator: Validator, content: GameContent): void {
  if (!Array.isArray(content.daylight)) {
    return; // Already reported by validateTable.
  }
  const phases = content.daylight.filter(isObject);
  for (const phase of DAYLIGHT_PHASES) {
    validator.check(
      phases.some((daylight) => daylight.id === phase),
      'daylight',
      `must have the "${phase}" look`,
    );
  }
  const night = phases.find((daylight) => daylight.id === 'night');
  for (const twilight of phases.filter((daylight) => daylight.id !== 'night')) {
    validator.check(
      night === undefined || !(twilight.sunElevationDegrees <= night.sunElevationDegrees),
      `daylight.${String(twilight.id)}.sunElevationDegrees`,
      "must be higher than the night's",
    );
  }
}

/** Each rival's home city has a depot on a map, and its trucks exist; no two rivals share a home or a colour. */
function validateRivalReferences(validator: Validator, content: GameContent): void {
  if (![content.rivals, content.cities, content.vehicles, content.maps].every(Array.isArray)) {
    return; // Already reported by validateTable.
  }
  const cityIds = new Set(content.cities.filter(isObject).map((city) => city.id));
  const vehicleIds = new Set(content.vehicles.filter(isObject).map((vehicle) => vehicle.id));
  const citiesWithDepots = new Set(
    content.maps
      .filter(isObject)
      .flatMap((map) => (Array.isArray(map.depots) ? map.depots.filter(isObject).map((depot) => depot.cityId) : [])),
  );
  const homes = new Set<string>();
  const colors = new Set<number>();
  content.rivals.forEach((rival, index) => {
    if (!isObject(rival)) {
      return;
    }
    const path = `rivals[${index}]`;
    if (validator.check(cityIds.has(rival.homeCityId), `${path}.homeCityId`, `unknown city "${rival.homeCityId}"`)) {
      validator.check(
        citiesWithDepots.has(rival.homeCityId),
        `${path}.homeCityId`,
        `city "${rival.homeCityId}" has no depot on any map`,
      );
    }
    validator.check(!homes.has(rival.homeCityId), `${path}.homeCityId`, `another rival is at home in "${rival.homeCityId}"`);
    homes.add(rival.homeCityId);
    validator.check(!colors.has(rival.color), `${path}.color`, 'another rival has this colour');
    colors.add(rival.color);
    validator.check(vehicleIds.has(rival.vehicleId), `${path}.vehicleId`, `unknown vehicle "${rival.vehicleId}"`);
  });
}

/**
 * Content is typed, but future JSON packs are not: every check below must
 * survive null or primitive entries and report them instead of throwing.
 */
function isObject<T>(value: T): value is T & object {
  return typeof value === 'object' && value !== null;
}

function validateTable<T extends { readonly id: string }>(
  validator: Validator,
  name: string,
  items: readonly T[],
  validateItem: (item: T, path: string, validator: Validator) => void,
): void {
  if (!validator.check(Array.isArray(items), name, 'must be a list')) {
    return;
  }
  const seenIds = new Set<string>();
  items.forEach((item, index) => {
    const path = `${name}[${index}]`;
    if (!validator.check(isObject(item), path, 'must be an object')) {
      return;
    }
    validateItem(item, path, validator);
    validator.check(!seenIds.has(item.id), `${path}.id`, `duplicate id "${item.id}"`);
    seenIds.add(item.id);
  });
}

function validateMissionReferences(validator: Validator, content: GameContent): void {
  if (![content.missions, content.cities, content.cargo, content.vehicles, content.maps].every(Array.isArray)) {
    return; // Already reported by validateTable.
  }
  // Non-object entries were reported by validateTable; skip them here.
  const cityIds = new Set(content.cities.filter(isObject).map((city) => city.id));
  const cargoById = new Map(content.cargo.filter(isObject).map((cargo) => [cargo.id, cargo]));
  const vehicles = content.vehicles.filter(isObject);
  const citiesWithDepots = new Set(
    content.maps
      .filter(isObject)
      .flatMap((map) => (Array.isArray(map.depots) ? map.depots.filter(isObject).map((depot) => depot.cityId) : [])),
  );

  content.missions.forEach((mission, index) => {
    if (!isObject(mission)) {
      return;
    }
    const path = `missions[${index}]`;
    validator.check(
      typeof mission.id !== 'string' || !mission.id.startsWith(GENERATED_MISSION_ID_PREFIX),
      `${path}.id`,
      `ids starting with "${GENERATED_MISSION_ID_PREFIX}" are kept for generated contracts`,
    );
    for (const key of ['originCityId', 'destinationCityId'] as const) {
      const cityId = mission[key];
      if (validator.check(cityIds.has(cityId), `${path}.${key}`, `unknown city "${cityId}"`)) {
        validator.check(citiesWithDepots.has(cityId), `${path}.${key}`, `city "${cityId}" has no depot on any map`);
      }
    }
    validator.check(
      mission.originCityId !== mission.destinationCityId,
      `${path}.destinationCityId`,
      'must differ from originCityId',
    );
    const cargo = cargoById.get(mission.cargoId);
    if (!validator.check(cargo !== undefined, `${path}.cargoId`, `unknown cargo "${mission.cargoId}"`)) {
      return;
    }

    // A contract that no truck can haul could never be completed (spec §29, step 4).
    const requiredClass = mission.requiredVehicleClass;
    const haulable = vehicles.some((vehicle) => vehicleCanHaul(vehicle, mission, cargo!));
    const vehicleKind = requiredClass === undefined ? 'vehicle' : `${requiredClass} vehicle`;
    validator.check(
      haulable,
      `${path}.cargoWeightTons`,
      `no ${vehicleKind} with a body for ${cargo!.requiredBody} cargo can carry ${mission.cargoWeightTons} t`,
    );
  });
}

function validateDepotReferences(validator: Validator, content: GameContent): void {
  if (![content.maps, content.cities].every(Array.isArray)) {
    return; // Already reported by validateTable.
  }
  const cityIds = new Set(content.cities.filter(isObject).map((city) => city.id));
  const seenDepotIds = new Set<string>();
  content.maps.forEach((map, mapIndex) => {
    if (!isObject(map) || !Array.isArray(map.depots)) {
      return;
    }
    map.depots.forEach((depot, index) => {
      if (!isObject(depot)) {
        return;
      }
      const path = `maps[${mapIndex}].depots[${index}]`;
      validator.check(cityIds.has(depot.cityId), `${path}.cityId`, `unknown city "${depot.cityId}"`);
      validator.check(!seenDepotIds.has(depot.id), `${path}.id`, `duplicate depot id "${depot.id}"`);
      seenDepotIds.add(depot.id);
    });
    if (Array.isArray(map.citySigns)) {
      map.citySigns.forEach((sign, index) => {
        if (isObject(sign)) {
          const path = `maps[${mapIndex}].citySigns[${index}].cityId`;
          validator.check(cityIds.has(sign.cityId), path, `unknown city "${sign.cityId}"`);
        }
      });
    }
  });
}
