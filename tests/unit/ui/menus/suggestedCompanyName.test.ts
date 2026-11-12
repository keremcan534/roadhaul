import { describe, expect, it } from 'vitest';
import type { Language } from '../../../../src/data/config/languages';
import { GAME_CONTENT } from '../../../../src/data/content';
import { validateCompanyName } from '../../../../src/domain/company/companyName';
import { DE } from '../../../../src/ui/i18n/de';
import { EN } from '../../../../src/ui/i18n/en';
import { ES } from '../../../../src/ui/i18n/es';
import { FR } from '../../../../src/ui/i18n/fr';
import { ID } from '../../../../src/ui/i18n/id';
import { IT } from '../../../../src/ui/i18n/it';
import { PL } from '../../../../src/ui/i18n/pl';
import { PT } from '../../../../src/ui/i18n/pt';
import { RU } from '../../../../src/ui/i18n/ru';
import { Strings, type StringTable } from '../../../../src/ui/i18n/Strings';
import { TR } from '../../../../src/ui/i18n/tr';
import { suggestedCompanyName } from '../../../../src/ui/menus/suggestedCompanyName';

const TABLES: Readonly<Record<Language, StringTable>> = { de: DE, en: EN, es: ES, fr: FR, id: ID, it: IT, pl: PL, pt: PT, ru: RU, tr: TR };
const NORTH_VALLEY = GAME_CONTENT.maps.find((map) => map.id === 'north_valley')!;

describe('suggestedCompanyName', () => {
  it('names a new company after its home town', () => {
    expect(suggestedCompanyName(new Strings('en', EN), NORTH_VALLEY)).toBe('Havenport Haulage');
    expect(suggestedCompanyName(new Strings('tr', TR), NORTH_VALLEY)).toBe('Havenport Lojistik');
  });

  it('offers a name the dialog accepts, in every language and region', () => {
    for (const [language, table] of Object.entries(TABLES) as [Language, StringTable][]) {
      for (const map of GAME_CONTENT.maps) {
        const name = suggestedCompanyName(new Strings(language, table), map);
        expect(validateCompanyName(name), `${language} on ${map.id}: "${name}"`).toEqual({ ok: true, value: name });
      }
    }
  });

  it('offers nothing on a map without depots', () => {
    expect(suggestedCompanyName(new Strings('en', EN), { ...NORTH_VALLEY, depots: [] })).toBe('');
  });
});
