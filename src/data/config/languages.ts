/**
 * The languages the game speaks (spec: localization), in the order the
 * language picker lists them: by their own names, the Latin alphabet first.
 */
export const LANGUAGES = ['id', 'de', 'en', 'es', 'fr', 'it', 'pl', 'pt', 'ru', 'tr'] as const;
export type Language = (typeof LANGUAGES)[number];

/** The player's language setting: the device's (`auto`), or one picked. */
export type LanguageChoice = 'auto' | Language;

/** What the game speaks when the device asks for none of its languages. */
export const FALLBACK_LANGUAGE: Language = 'en';

/** Each language's name in itself, as the picker shows it. */
export const LANGUAGE_NAMES: Readonly<Record<Language, string>> = {
  id: 'Bahasa Indonesia',
  de: 'Deutsch',
  en: 'English',
  es: 'Español',
  fr: 'Français',
  it: 'Italiano',
  pl: 'Polski',
  pt: 'Português (Brasil)',
  ru: 'Русский',
  tr: 'Türkçe',
};

/** The locale each language writes its numbers in (grouping, decimals, percentages). */
export const LANGUAGE_LOCALES: Readonly<Record<Language, string>> = {
  id: 'id-ID',
  de: 'de-DE',
  en: 'en-GB',
  es: 'es-ES',
  fr: 'fr-FR',
  it: 'it-IT',
  pl: 'pl-PL',
  pt: 'pt-BR',
  ru: 'ru-RU',
  tr: 'tr-TR',
};

export function isLanguage(value: unknown): value is Language {
  return (LANGUAGES as readonly unknown[]).includes(value);
}

export function isLanguageChoice(value: unknown): value is LanguageChoice {
  return value === 'auto' || isLanguage(value);
}

/**
 * The game's language for a language tag (BCP 47, as browsers give them:
 * `pt-PT`, `es-419`, `in-ID`), by its base; null when the game does not
 * speak it. Older Android names Indonesian `in`.
 */
export function languageOfTag(tag: string): Language | null {
  const base = tag.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  const language = base === 'in' ? 'id' : base;
  return isLanguage(language) ? language : null;
}
