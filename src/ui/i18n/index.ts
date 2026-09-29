import { EN } from './en';
import { Strings, type Language, type StringTable } from './Strings';
import { TR } from './tr';

export { chooseLanguage, LANGUAGES, Strings, type Language } from './Strings';

/** The tables that come with the game's code: English (the fallback) and Turkish. */
const BUNDLED = { en: EN, tr: TR } as const;

/** Every other language's table loads when it is picked, as a chunk of its own: nobody downloads ten. */
const LOADERS: Readonly<Record<Language, () => Promise<StringTable>>> = {
  en: () => Promise.resolve(EN),
  tr: () => Promise.resolve(TR),
  de: () => import('./de').then((table) => table.DE),
  es: () => import('./es').then((table) => table.ES),
  fr: () => import('./fr').then((table) => table.FR),
  id: () => import('./id').then((table) => table.ID),
  it: () => import('./it').then((table) => table.IT),
  pl: () => import('./pl').then((table) => table.PL),
  pt: () => import('./pt').then((table) => table.PT),
  ru: () => import('./ru').then((table) => table.RU),
};

/** The string tables for a language that comes with the code. */
export function stringsFor(language: keyof typeof BUNDLED): Strings {
  return new Strings(language, BUNDLED[language]);
}

/** The string tables for `language`, loaded if they are not with the code. */
export async function loadStrings(language: Language): Promise<Strings> {
  return new Strings(language, await LOADERS[language]());
}
