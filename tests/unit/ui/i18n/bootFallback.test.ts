import { describe, expect, it } from 'vitest';
import { LANGUAGES, type Language } from '../../../../src/data/config/languages';
import { DE } from '../../../../src/ui/i18n/de';
import { EN } from '../../../../src/ui/i18n/en';
import { ES } from '../../../../src/ui/i18n/es';
import { FR } from '../../../../src/ui/i18n/fr';
import { ID } from '../../../../src/ui/i18n/id';
import { IT } from '../../../../src/ui/i18n/it';
import { PL } from '../../../../src/ui/i18n/pl';
import { PT } from '../../../../src/ui/i18n/pt';
import { RU } from '../../../../src/ui/i18n/ru';
import type { StringTable } from '../../../../src/ui/i18n/Strings';
import { TR } from '../../../../src/ui/i18n/tr';

const TABLES: Readonly<Record<Language, StringTable>> = { de: DE, en: EN, es: ES, fr: FR, id: ID, it: IT, pl: PL, pt: PT, ru: RU, tr: TR };
const INDEX_HTML = Object.values(
  import.meta.glob<string>('/index.html', { query: '?raw', import: 'default', eager: true }),
)[0]!;

/** The old-WebView script in index.html: the one inline classic script. */
function fallbackScript(): string {
  const match = /<script>([\s\S]*?)<\/script>/.exec(INDEX_HTML);
  expect(match, 'index.html has the old-WebView script').not.toBeNull();
  return match![1]!;
}

/** Its words, language by language: `xx: ['note', 'link'],`. */
function fallbackText(): Map<string, readonly [string, string]> {
  const rows = fallbackScript().matchAll(/^\s*([a-z]{2}): \['([^']*)', '([^']*)'\],$/gm);
  return new Map([...rows].map((row) => [row[1]!, [row[2]!, row[3]!] as const]));
}

/** The boot screen's words for a WebView too old to run the game, which index.html carries before any of it loads. */
describe('the old-WebView note', () => {
  it('says what the string tables say, in every language', () => {
    const text = fallbackText();
    expect([...text.keys()].sort()).toEqual([...LANGUAGES].sort());
    for (const language of LANGUAGES) {
      expect(text.get(language), language).toEqual([TABLES[language]['boot.oldWebview'], TABLES[language]['boot.openPlay']]);
    }
  });

  it('is written in ES5, to run where the game cannot', () => {
    const script = fallbackScript()
      .replace(/^\s*\/\/.*$/gm, '')
      // The feature test's ES2022 is a string, compiled only to see whether it can be.
      .replace(/new Function\('[^']*'\)/, 'new Function()');
    for (const later of [/=>/, /`/, /\b(let|const|class)\s/, /\?\?|\?\./, /\.\.\./]) {
      expect(script, String(later)).not.toMatch(later);
    }
    expect(() => new Function(script)).not.toThrow();
  });
});
