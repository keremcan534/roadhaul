import { Validator, type ValidationIssue } from '../../core/validation/Validator';
import type { ContentCatalog } from '../../data/ContentCatalog';
import { validateCompanyName } from '../company/companyName';
import { MISSION_STATES } from '../missions/MissionInstance';
import { statBonuses, type FittedUpgrades } from '../vehicles/upgradeBonuses';
import { CURRENT_SAVE_VERSION } from './SaveGameData';

/** Contract stages a save may hold: a finished contract is never saved as active. */
const SAVED_MISSION_STATES = MISSION_STATES.filter((state) => state !== 'completed' && state !== 'failed');
const VEHICLE_INSTANCE_ID = /^truck_\d{3,}$/;

type Json = Record<string, unknown>;

function isJson(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Checks save data that came back from storage (after migrateSave) before the
 * game trusts it: every field, range and reference to content. A save that
 * fails is treated as corrupted, never half-loaded.
 */
export function validateSaveGameData(
  data: unknown,
  content: ContentCatalog,
  maxCompanyLevel: number,
): readonly ValidationIssue[] {
  const validator = new Validator();
  if (!isJson(data)) {
    validator.report('save', 'must be an object');
    return validator.issues;
  }
  validator.check(data['version'] === CURRENT_SAVE_VERSION, 'version', `must be ${CURRENT_SAVE_VERSION}`);
  for (const key of ['createdAtMs', 'updatedAtMs']) {
    validator.check(isFiniteNumber(data[key]) && (data[key] as number) >= 0, key, 'must be a timestamp');
  }

  const section = (key: string, check: (value: Json) => void): void => {
    const value = data[key];
    if (isJson(value)) {
      check(value);
    } else {
      validator.report(key, 'must be an object');
    }
  };

  section('profile', (profile) => {
    const name = profile['companyName'];
    const checked = typeof name === 'string' ? validateCompanyName(name) : null;
    validator.check(
      checked !== null && checked.ok && checked.value === name,
      'profile.companyName',
      'must be a valid, normalised company name',
    );
  });
  section('company', (company) => {
    const level = company['level'];
    validator.check(
      Number.isInteger(level) && (level as number) >= 1 && (level as number) <= maxCompanyLevel,
      'company.level',
      `must be a whole number from 1 to ${maxCompanyLevel}`,
    );
    validator.nonNegativeInteger(company['xp'], 'company.xp');
    validator.nonNegativeInteger(company['reputation'], 'company.reputation');
  });
  section('economy', (economy) => {
    validator.check(
      Number.isSafeInteger(economy['credits']) && (economy['credits'] as number) >= 0,
      'economy.credits',
      'must be a whole number of credits, 0 or more',
    );
  });
  section('garage', (garage) => validateGarage(garage, content, validator));
  section('world', (world) => {
    const mapId = world['mapId'];
    const map = typeof mapId === 'string' ? content.maps.find(mapId) : undefined;
    validator.check(map !== undefined, 'world.mapId', `unknown map ${JSON.stringify(mapId)}`);
    const truck = world['truck'];
    if (truck !== null) {
      const placed =
        isJson(truck) &&
        [truck['x'], truck['z'], truck['headingRadians']].every(isFiniteNumber) &&
        (map === undefined ||
          (Math.abs(truck['x'] as number) < map.halfSizeMeters && Math.abs(truck['z'] as number) < map.halfSizeMeters));
      validator.check(placed, 'world.truck', 'must be null or a position inside the map and a heading');
    }
  });
  section('missions', (missions) => {
    const active = missions['active'];
    if (active === null) {
      return;
    }
    if (!isJson(active)) {
      validator.report('missions.active', 'must be null or an object');
      return;
    }
    const missionId = active['missionId'];
    validator.check(
      typeof missionId === 'string' && content.missions.has(missionId),
      'missions.active.missionId',
      `unknown mission ${JSON.stringify(missionId)}`,
    );
    validator.oneOf(active['state'], SAVED_MISSION_STATES, 'missions.active.state');
    for (const key of ['handlingSeconds', 'deliverySeconds']) {
      validator.check(
        isFiniteNumber(active[key]) && (active[key] as number) >= 0,
        `missions.active.${key}`,
        'must be 0 or more',
      );
    }
    validator.fraction(active['cargoDamage'], 'missions.active.cargoDamage');
    validator.check(active['failureReason'] === null, 'missions.active.failureReason', 'must be null');
  });
  section('stats', (stats) => {
    validator.nonNegativeInteger(stats['deliveriesCompleted'], 'stats.deliveriesCompleted');
    validator.nonNegativeInteger(stats['deliveriesFailed'], 'stats.deliveriesFailed');
    validator.nonNegativeInteger(stats['creditsEarned'], 'stats.creditsEarned');
    validator.check(
      isFiniteNumber(stats['distanceDrivenMeters']) && (stats['distanceDrivenMeters'] as number) >= 0,
      'stats.distanceDrivenMeters',
      'must be 0 or more',
    );
  });
  section('events', (events) => validateEventRuns(events['runs'], content, validator));
  return validator.issues;
}

/** Each run names a known event, once, with a whole edition and progress of 0 or more. */
function validateEventRuns(runs: unknown, content: ContentCatalog, validator: Validator): void {
  if (!validator.check(Array.isArray(runs), 'events.runs', 'must be a list')) {
    return;
  }
  const seen = new Set<unknown>();
  (runs as unknown[]).forEach((run, index) => {
    const path = `events.runs[${index}]`;
    if (!isJson(run)) {
      validator.report(path, 'must be an object');
      return;
    }
    const eventId = run['eventId'];
    validator.check(
      typeof eventId === 'string' && content.events.has(eventId),
      `${path}.eventId`,
      `unknown event ${JSON.stringify(eventId)}`,
    );
    validator.check(!seen.has(eventId), `${path}.eventId`, 'must not repeat');
    seen.add(eventId);
    validator.nonNegativeInteger(run['edition'], `${path}.edition`);
    validator.check(isFiniteNumber(run['progress']) && (run['progress'] as number) >= 0, `${path}.progress`, 'must be 0 or more');
    validator.boolean(run['rewarded'], `${path}.rewarded`);
  });
}

function validateGarage(garage: Json, content: ContentCatalog, validator: Validator): void {
  const vehicles = garage['vehicles'];
  if (!validator.check(Array.isArray(vehicles) && vehicles.length > 0, 'garage.vehicles', 'must list at least one truck')) {
    return;
  }
  const instanceIds = new Set<string>();
  (vehicles as unknown[]).forEach((vehicle, index) => {
    const path = `garage.vehicles[${index}]`;
    if (!isJson(vehicle)) {
      validator.report(path, 'must be an object');
      return;
    }
    const instanceId = vehicle['instanceId'];
    if (
      validator.check(
        typeof instanceId === 'string' && VEHICLE_INSTANCE_ID.test(instanceId) && !instanceIds.has(instanceId),
        `${path}.instanceId`,
        'must be a unique id like truck_001',
      )
    ) {
      instanceIds.add(instanceId as string);
    }
    const definitionId = vehicle['definitionId'];
    const definition = typeof definitionId === 'string' ? content.vehicles.find(definitionId) : undefined;
    validator.check(definition !== undefined, `${path}.definitionId`, `unknown vehicle ${JSON.stringify(definitionId)}`);
    const upgrades = validateUpgrades(vehicle['upgrades'], `${path}.upgrades`, content, validator);
    // A bigger tank holds more: the capacity includes the fitted fuel tank upgrade.
    const capacity =
      definition === undefined
        ? Infinity
        : definition.fuelCapacityLiters * (1 + statBonuses(upgrades, content.upgrades.all).fuelCapacity);
    const fuel = vehicle['fuelLiters'];
    validator.check(
      isFiniteNumber(fuel) && fuel >= 0 && fuel <= capacity + 1e-6,
      `${path}.fuelLiters`,
      'must be from 0 to the tank capacity',
    );
    validator.fraction(vehicle['damage'], `${path}.damage`);
  });
  const active = garage['activeVehicleInstanceId'];
  validator.check(
    typeof active === 'string' && instanceIds.has(active),
    'garage.activeVehicleInstanceId',
    'must name one of the trucks',
  );
}

/** Checks a truck's fitted upgrades and returns the usable ones (none when the whole field is broken). */
function validateUpgrades(value: unknown, path: string, content: ContentCatalog, validator: Validator): FittedUpgrades {
  if (!isJson(value)) {
    validator.report(path, 'must be an object of upgrade levels');
    return {};
  }
  const usable: Record<string, number> = {};
  for (const [upgradeId, level] of Object.entries(value)) {
    const upgrade = content.upgrades.find(upgradeId);
    const valid =
      upgrade !== undefined && Number.isInteger(level) && (level as number) >= 1 && (level as number) <= upgrade.levels.length;
    if (validator.check(valid, `${path}.${upgradeId}`, 'must be a known upgrade at one of its levels')) {
      usable[upgradeId] = level as number;
    }
  }
  return usable;
}
