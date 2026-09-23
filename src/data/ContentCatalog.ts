import { frozenCopy } from '../core/objects/frozenCopy';
import { ValidationError, Validator, type ValidationIssue } from '../core/validation/Validator';
import { validateCargoDefinition, type CargoDefinition } from './definitions/CargoDefinition';
import { validateCityDefinition, type CityDefinition } from './definitions/CityDefinition';
import { validateMissionDefinition, type MissionDefinition } from './definitions/MissionDefinition';
import { validateVehicleDefinition, type VehicleDefinition } from './definitions/VehicleDefinition';
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

  private constructor(content: GameContent) {
    this.vehicles = new DefinitionTable('vehicle', content.vehicles);
    this.cargo = new DefinitionTable('cargo', content.cargo);
    this.cities = new DefinitionTable('city', content.cities);
    this.missions = new DefinitionTable('mission', content.missions);
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
  validateMissionReferences(validator, content);
  return validator.issues;
}

/**
 * Content is typed, but future JSON packs are not: every check below must
 * survive null or primitive entries and report them instead of throwing.
 */
function isObject(value: unknown): value is object {
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
  if (![content.missions, content.cities, content.cargo, content.vehicles].every(Array.isArray)) {
    return; // Already reported by validateTable.
  }
  // Non-object entries were reported by validateTable; skip them here.
  const cityIds = new Set(content.cities.filter(isObject).map((city) => city.id));
  const cargoIds = new Set(content.cargo.filter(isObject).map((cargo) => cargo.id));
  const vehicles = content.vehicles.filter(isObject);

  content.missions.forEach((mission, index) => {
    if (!isObject(mission)) {
      return;
    }
    const path = `missions[${index}]`;
    validator.check(
      cityIds.has(mission.originCityId),
      `${path}.originCityId`,
      `unknown city "${mission.originCityId}"`,
    );
    validator.check(
      cityIds.has(mission.destinationCityId),
      `${path}.destinationCityId`,
      `unknown city "${mission.destinationCityId}"`,
    );
    validator.check(
      mission.originCityId !== mission.destinationCityId,
      `${path}.destinationCityId`,
      'must differ from originCityId',
    );
    validator.check(cargoIds.has(mission.cargoId), `${path}.cargoId`, `unknown cargo "${mission.cargoId}"`);

    // A contract that no truck can haul could never be completed (spec §29, step 4).
    const requiredClass = mission.requiredVehicleClass;
    const haulable = vehicles.some(
      (vehicle) =>
        vehicle.maxPayloadTons >= mission.cargoWeightTons &&
        (requiredClass === undefined || vehicle.vehicleClass === requiredClass),
    );
    const vehicleKind = requiredClass === undefined ? 'vehicle' : `${requiredClass} vehicle`;
    validator.check(
      haulable,
      `${path}.cargoWeightTons`,
      `no ${vehicleKind} can carry ${mission.cargoWeightTons} t`,
    );
  });
}
