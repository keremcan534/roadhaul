import { err, ok, type Result } from '../../core/Result';

export const COMPANY_NAME_MIN_LENGTH = 2;
export const COMPANY_NAME_MAX_LENGTH = 24;

export type CompanyNameError = 'tooShort' | 'tooLong' | 'invalidCharacters';

/**
 * Characters that make a name invisible or unreadable: control and formatting
 * characters (zero-width spaces, direction marks, ...) plus "letters" that
 * render as blank space (Hangul fillers, the blank braille pattern).
 */
const FORBIDDEN_CHARACTERS = /[\p{Cc}\p{Cf}ᅟᅠㅤﾠ⠀]/u;

/** A name needs at least one visible letter or digit. */
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/**
 * Normalises the company name the player typed (Unicode NFC, trimmed,
 * whitespace collapsed) and checks it. Length counts characters, not UTF-16
 * units, so "Şahin Lojistik" counts 14 however the "Ş" was typed.
 */
export function validateCompanyName(input: string): Result<string, CompanyNameError> {
  const name = input.normalize('NFC').trim().replace(/\s+/g, ' ');
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
  if (!LETTER_OR_DIGIT.test(name)) {
    return err('invalidCharacters');
  }
  return ok(name);
}
