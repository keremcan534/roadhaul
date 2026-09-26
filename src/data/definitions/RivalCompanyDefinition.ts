import type { Validator } from '../../core/validation/Validator';
import type { Credits, Fraction } from '../units';

/** Stands for the player's company where standing and the league list companies by id: no rival may use it. */
export const PLAYER_COMPANY_ID = 'player';

/**
 * A haulage company of the region the player's company competes with (spec
 * §65 V3: tenders and an AI economy). Its trucks take contracts between the
 * cities by themselves, as the company's fleet does; what they deliver wins
 * it standing in the cities, and the profit buys it more trucks and
 * campaigns. It starts out leading in its home city. Its name comes from
 * the string tables (`rival.<id>.name`).
 */
export interface RivalCompanyDefinition {
  /** Stable snake_case id. It is written into save files: never rename it. */
  readonly id: string;
  /** Its trucks' and its territory's colour on the map, 0xRRGGBB. */
  readonly color: number;
  /** CityDefinition id of its headquarters: it leads there at the start, and its trucks keep coming back. */
  readonly homeCityId: string;
  /** VehicleDefinition id of the trucks it runs. */
  readonly vehicleId: string;
  /** Trucks on the road at the start… */
  readonly startingTrucks: number;
  /** …and at most, once it has bought more. */
  readonly maxTrucks: number;
  /** Money in hand at the start, besides its trucks. */
  readonly startingCredits: Credits;
  /** How much quicker than the fleet's average pace its drivers are: 1 is the average. */
  readonly speedFactor: number;
  /**
   * How hard it fights, 0..1: how likely it is to run a campaign when it
   * can, and to send its trucks to the cities another company leads.
   */
  readonly aggression: Fraction;
}

export function validateRivalCompanyDefinition(rival: RivalCompanyDefinition, path: string, validator: Validator): void {
  if (validator.id(rival.id, `${path}.id`)) {
    validator.check(rival.id !== PLAYER_COMPANY_ID, `${path}.id`, `"${PLAYER_COMPANY_ID}" stands for the player's company`);
  }
  validator.check(
    Number.isInteger(rival.color) && rival.color >= 0 && rival.color <= 0xffffff,
    `${path}.color`,
    'must be a colour from 0x000000 to 0xffffff',
  );
  validator.id(rival.homeCityId, `${path}.homeCityId`);
  validator.id(rival.vehicleId, `${path}.vehicleId`);
  validator.positiveInteger(rival.startingTrucks, `${path}.startingTrucks`);
  validator.check(
    Number.isInteger(rival.maxTrucks) && rival.maxTrucks >= rival.startingTrucks,
    `${path}.maxTrucks`,
    'must be a whole number, at least startingTrucks',
  );
  validator.nonNegativeInteger(rival.startingCredits, `${path}.startingCredits`);
  validator.check(
    Number.isFinite(rival.speedFactor) && rival.speedFactor >= 0.5 && rival.speedFactor <= 1.5,
    `${path}.speedFactor`,
    'must be from 0.5 to 1.5',
  );
  validator.fraction(rival.aggression, `${path}.aggression`);
}
