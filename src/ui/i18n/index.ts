import { EN } from './en';
import { Strings, type Language } from './Strings';
import { TR } from './tr';

export { chooseLanguage, LANGUAGES, Strings, type Language } from './Strings';

/** The string tables for `language`. */
export function stringsFor(language: Language): Strings {
  return new Strings(language, language === 'tr' ? TR : EN);
}
