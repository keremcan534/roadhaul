import { Validator, type ValidationIssue } from '../../core/validation/Validator';
import type { ContentCatalog } from '../../data/ContentCatalog';
import { validateMissionDefinition, type MissionDefinition } from '../../data/definitions/MissionDefinition';
import { PLAYER_COMPANY_ID } from '../../data/definitions/RivalCompanyDefinition';
import { validateCompanyName } from '../company/companyName';
import { MISSION_STATES } from '../missions/MissionInstance';
import { isTenderId, TENDER_ID_PREFIX } from '../rivals/tenders';
import { TUTORIAL_STEPS } from '../tutorial/tutorialSteps';
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
    const contract = active['contract'];
    if (contract === null) {
      validator.check(
        typeof missionId === 'string' && content.missions.has(missionId),
        'missions.active.missionId',
        `unknown mission ${JSON.stringify(missionId)}`,
      );
    } else if (!isJson(contract)) {
      validator.report('missions.active.contract', 'must be null or a contract');
    } else {
      validateGeneratedContract(contract, 'missions.active.contract', content, validator);
      validator.check(contract['id'] === missionId, 'missions.active.contract.id', 'must be the mission id');
    }
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
  section('tutorial', (tutorial) => validator.oneOf(tutorial['step'], TUTORIAL_STEPS, 'tutorial.step'));
  section('fleet', (fleet) => validateFleet(fleet, data['garage'], content, validator));
  section('rivals', (rivals) => validateRivals(rivals, content, validator));
  return validator.issues;
}

/** A generated contract, kept whole: its fields, and what it names in the content. */
function validateGeneratedContract(contract: Json, path: string, content: ContentCatalog, validator: Validator): void {
  validateMissionDefinition(contract as unknown as MissionDefinition, path, validator);
  validator.check(
    typeof contract['cargoId'] === 'string' && content.cargo.has(contract['cargoId']),
    `${path}.cargoId`,
    `unknown cargo ${JSON.stringify(contract['cargoId'])}`,
  );
  for (const key of ['originCityId', 'destinationCityId']) {
    validator.check(
      typeof contract[key] === 'string' && content.cities.has(contract[key]),
      `${path}.${key}`,
      `unknown city ${JSON.stringify(contract[key])}`,
    );
  }
}

/**
 * Each hired driver is a known one, once; drives one of the company's
 * trucks other than the player's (each truck one driver), or none; stands
 * in a known city; and any contract under way is a sound one of theirs.
 */
function validateFleet(fleet: Json, garage: unknown, content: ContentCatalog, validator: Validator): void {
  validator.nonNegativeInteger(fleet['jobsPlanned'], 'fleet.jobsPlanned');
  const drivers = fleet['drivers'];
  if (!validator.check(Array.isArray(drivers), 'fleet.drivers', 'must be a list')) {
    return;
  }
  const garageTrucks = new Set<unknown>();
  let activeTruck: unknown;
  if (isJson(garage) && Array.isArray(garage['vehicles'])) {
    for (const vehicle of garage['vehicles'] as unknown[]) {
      if (isJson(vehicle)) {
        garageTrucks.add(vehicle['instanceId']);
      }
    }
    activeTruck = garage['activeVehicleInstanceId'];
  }
  const seenDrivers = new Set<unknown>();
  const seenTrucks = new Set<unknown>();
  (drivers as unknown[]).forEach((driver, index) => {
    const path = `fleet.drivers[${index}]`;
    if (!isJson(driver)) {
      validator.report(path, 'must be an object');
      return;
    }
    const driverId = driver['driverId'];
    validator.check(
      typeof driverId === 'string' && content.drivers.has(driverId) && !seenDrivers.has(driverId),
      `${path}.driverId`,
      `must be a known driver, hired once, not ${JSON.stringify(driverId)}`,
    );
    seenDrivers.add(driverId);
    const truck = driver['truckInstanceId'];
    validator.check(
      truck === null || (garageTrucks.has(truck) && truck !== activeTruck && !seenTrucks.has(truck)),
      `${path}.truckInstanceId`,
      "must be null or one of the company's other trucks, driven by nobody else",
    );
    seenTrucks.add(truck);
    const cityId = driver['cityId'];
    validator.check(
      typeof cityId === 'string' && content.cities.has(cityId),
      `${path}.cityId`,
      `unknown city ${JSON.stringify(cityId)}`,
    );
    const job = driver['job'];
    if (job !== null) {
      if (validator.check(truck !== null, `${path}.job`, 'must be null without a truck')) {
        validateFleetJob(job, `${path}.job`, content, validator);
      }
    }
    validator.check(
      isFiniteNumber(driver['repairSecondsLeft']) && (driver['repairSecondsLeft'] as number) >= 0,
      `${path}.repairSecondsLeft`,
      'must be 0 or more',
    );
    validator.nonNegativeInteger(driver['jobsCompleted'], `${path}.jobsCompleted`);
    validator.check(Number.isSafeInteger(driver['creditsEarned']), `${path}.creditsEarned`, 'must be a whole number of credits');
  });
}

function validateFleetJob(job: unknown, path: string, content: ContentCatalog, validator: Validator): void {
  if (!isJson(job)) {
    validator.report(path, 'must be null or a contract');
    return;
  }
  for (const key of ['originCityId', 'destinationCityId']) {
    validator.check(
      typeof job[key] === 'string' && content.cities.has(job[key]),
      `${path}.${key}`,
      `unknown city ${JSON.stringify(job[key])}`,
    );
  }
  validator.check(
    typeof job['cargoId'] === 'string' && content.cargo.has(job['cargoId']),
    `${path}.cargoId`,
    `unknown cargo ${JSON.stringify(job['cargoId'])}`,
  );
  validator.positiveNumber(job['cargoTons'], `${path}.cargoTons`);
  validator.check(
    isFiniteNumber(job['distanceMeters']) && (job['distanceMeters'] as number) >= 0,
    `${path}.distanceMeters`,
    'must be 0 or more',
  );
  validator.positiveNumber(job['durationSeconds'], `${path}.durationSeconds`);
  for (const key of ['pay', 'driverShare', 'fuelCost']) {
    validator.nonNegativeInteger(job[key], `${path}.${key}`);
  }
  validator.boolean(job['incident'], `${path}.incident`);
  const elapsed = job['elapsedSeconds'];
  validator.check(
    isFiniteNumber(elapsed) && elapsed >= 0 && (!isFiniteNumber(job['durationSeconds']) || elapsed <= job['durationSeconds']),
    `${path}.elapsedSeconds`,
    'must be from 0 to the contract\'s duration',
  );
}

/**
 * The rivals: each a known one, listed once, with its money, its trucks (at
 * most its fleet's size, none once bought out; in known cities, with sound
 * contracts under way) and its timers; standing of known companies in known
 * cities, once each; the company's campaign timers; and the tenders.
 */
function validateRivals(rivals: Json, content: ContentCatalog, validator: Validator): void {
  const companies = rivals['companies'];
  if (validator.check(Array.isArray(companies), 'rivals.companies', 'must be a list')) {
    const seen = new Set<unknown>();
    (companies as unknown[]).forEach((company, index) => {
      const path = `rivals.companies[${index}]`;
      if (!isJson(company)) {
        validator.report(path, 'must be an object');
        return;
      }
      const rivalId = company['rivalId'];
      const rival = typeof rivalId === 'string' ? content.rivals.find(rivalId) : undefined;
      validator.check(
        rival !== undefined && !seen.has(rivalId),
        `${path}.rivalId`,
        `must be a known rival, listed once, not ${JSON.stringify(rivalId)}`,
      );
      seen.add(rivalId);
      validator.check(
        Number.isSafeInteger(company['credits']) && (company['credits'] as number) >= 0,
        `${path}.credits`,
        'must be a whole number of credits, 0 or more',
      );
      validator.boolean(company['acquired'], `${path}.acquired`);
      for (const key of ['campaignCooldownSeconds', 'decisionSeconds']) {
        validator.check(isFiniteNumber(company[key]) && (company[key] as number) >= 0, `${path}.${key}`, 'must be 0 or more');
      }
      const trucks = company['trucks'];
      if (!validator.check(Array.isArray(trucks), `${path}.trucks`, 'must be a list')) {
        return;
      }
      const count = (trucks as unknown[]).length;
      validator.check(
        rival === undefined || count <= rival.maxTrucks,
        `${path}.trucks`,
        `must be at most ${rival?.maxTrucks ?? 0} trucks`,
      );
      validator.check(company['acquired'] !== true || count === 0, `${path}.trucks`, 'must be none once bought out');
      (trucks as unknown[]).forEach((truck, truckIndex) => {
        const truckPath = `${path}.trucks[${truckIndex}]`;
        if (!isJson(truck)) {
          validator.report(truckPath, 'must be an object');
          return;
        }
        const cityId = truck['cityId'];
        validator.check(
          typeof cityId === 'string' && content.cities.has(cityId),
          `${truckPath}.cityId`,
          `unknown city ${JSON.stringify(cityId)}`,
        );
        if (truck['job'] !== null) {
          validateFleetJob(truck['job'], `${truckPath}.job`, content, validator);
        }
      });
    });
  }

  const standing = rivals['standing'];
  if (validator.check(Array.isArray(standing), 'rivals.standing', 'must be a list')) {
    const seen = new Set<string>();
    (standing as unknown[]).forEach((entry, index) => {
      const path = `rivals.standing[${index}]`;
      if (!isJson(entry)) {
        validator.report(path, 'must be an object');
        return;
      }
      const { cityId, companyId, points } = entry;
      validator.check(
        typeof cityId === 'string' && content.cities.has(cityId),
        `${path}.cityId`,
        `unknown city ${JSON.stringify(cityId)}`,
      );
      validator.check(
        typeof companyId === 'string' && (companyId === PLAYER_COMPANY_ID || content.rivals.has(companyId)),
        `${path}.companyId`,
        `must be "${PLAYER_COMPANY_ID}" or a known rival, not ${JSON.stringify(companyId)}`,
      );
      const key = `${String(cityId)}>${String(companyId)}`;
      validator.check(!seen.has(key), path, 'must be the only standing of its company in its city');
      seen.add(key);
      validator.check(isFiniteNumber(points) && points > 0, `${path}.points`, 'must be more than 0');
    });
  }

  const cooldowns = rivals['campaignCooldowns'];
  if (validator.check(Array.isArray(cooldowns), 'rivals.campaignCooldowns', 'must be a list')) {
    const seen = new Set<unknown>();
    (cooldowns as unknown[]).forEach((cooldown, index) => {
      const path = `rivals.campaignCooldowns[${index}]`;
      if (!isJson(cooldown)) {
        validator.report(path, 'must be an object');
        return;
      }
      const cityId = cooldown['cityId'];
      validator.check(
        typeof cityId === 'string' && content.cities.has(cityId) && !seen.has(cityId),
        `${path}.cityId`,
        `must be a known city, listed once, not ${JSON.stringify(cityId)}`,
      );
      seen.add(cityId);
      validator.check(isFiniteNumber(cooldown['seconds']) && cooldown['seconds'] > 0, `${path}.seconds`, 'must be more than 0');
    });
  }

  for (const key of ['tender', 'race']) {
    if (rivals[key] !== null) {
      validateTender(rivals[key], `rivals.${key}`, content, validator);
    }
  }
  const next = rivals['nextTenderSeconds'];
  validator.check(next === null || (isFiniteNumber(next) && next >= 0), 'rivals.nextTenderSeconds', 'must be null or 0 or more');
  validator.nonNegativeInteger(rivals['tendersPosted'], 'rivals.tendersPosted');
  validator.nonNegativeInteger(rivals['jobsPlanned'], 'rivals.jobsPlanned');
}

/** A tender: its generated contract, with a tender's id, the rival racing it, the prize and the rival's time. */
function validateTender(tender: unknown, path: string, content: ContentCatalog, validator: Validator): void {
  if (!isJson(tender)) {
    validator.report(path, 'must be null or a tender');
    return;
  }
  const contract = tender['contract'];
  if (isJson(contract)) {
    validateGeneratedContract(contract, `${path}.contract`, content, validator);
    validator.check(
      typeof contract['id'] === 'string' && isTenderId(contract['id']),
      `${path}.contract.id`,
      `must start with "${TENDER_ID_PREFIX}"`,
    );
  } else {
    validator.report(`${path}.contract`, 'must be a contract');
  }
  const rivalId = tender['rivalId'];
  validator.check(
    typeof rivalId === 'string' && content.rivals.has(rivalId),
    `${path}.rivalId`,
    `unknown rival ${JSON.stringify(rivalId)}`,
  );
  validator.nonNegativeInteger(tender['prize'], `${path}.prize`);
  validator.positiveNumber(tender['rivalSeconds'], `${path}.rivalSeconds`);
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
    const paintId = vehicle['paintId'];
    validator.check(
      paintId === null || (typeof paintId === 'string' && content.paints.has(paintId)),
      `${path}.paintId`,
      `must be null or a known paint, not ${JSON.stringify(paintId)}`,
    );
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
