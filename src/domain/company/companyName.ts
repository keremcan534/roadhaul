import { err, ok, type Result } from '../../core/Result';

export const COMPANY_NAME_MIN_LENGTH = 2;
export const COMPANY_NAME_MAX_LENGTH = 24;

export type CompanyNameError = 'tooShort' | 'tooLong' | 'invalidCharacters';

/** Control and invisible formatting characters (zero-width spaces, direction marks, ...). */
const FORBIDDEN_CHARACTERS = /[\p{Cc}\p{Cf}]/u;

/**
 * Normalises the company name the player typed (trims and collapses
 * whitespace) and checks it. Length counts characters, not UTF-16 units, so
 * "Şahin Lojistik" counts 14.
 */
export function validateCompanyName(input: string): Result<string, CompanyNameError> {
  const name = input.trim().replace(/\s+/g, ' ');
  if (FORBIDDEN_CHARACTERS.test(name)) {
    return err('invalidCharacters');
  }
  const length = Array.from(name).length;
  if (length < COMPANY_NAME_MIN_LENGTH) {
    return err('tooShort');
  }
  if (length > COMPANY_NAME_MAX_LENGTH) {
    return err('tooLong');
  }
  return ok(name);
}
