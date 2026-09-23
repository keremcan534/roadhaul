import { describe, expect, it } from 'vitest';
import { GAME_CONTENT } from '../../../../src/data/content';
import { MISSION_DIFFICULTIES } from '../../../../src/data/definitions/MissionDefinition';
import { EN } from '../../../../src/ui/i18n/en';
import { chooseLanguage, stringsFor } from '../../../../src/ui/i18n';
import { TR } from '../../../../src/ui/i18n/tr';

const tr = stringsFor('tr');
const en = stringsFor('en');

describe('string tables', () => {
  it('have the same keys in Turkish and English', () => {
    expect(Object.keys(TR).sort()).toEqual(Object.keys(EN).sort());
  });

  it('name every city, cargo, mission and difficulty in both languages', () => {
    const keys = [
      ...GAME_CONTENT.cities.map((city) => `city.${city.id}.name`),
      ...GAME_CONTENT.cargo.map((cargo) => `cargo.${cargo.id}.name`),
      ...GAME_CONTENT.missions.map((mission) => `mission.${mission.id}.title`),
      ...MISSION_DIFFICULTIES.map((difficulty) => `difficulty.${difficulty}`),
    ];
    for (const strings of [tr, en]) {
      for (const key of keys) {
        expect(strings.has(key), `${strings.language}: ${key}`).toBe(true);
      }
    }
    expect(tr.missionTitle('first_package')).toBe('İlk Paket');
    expect(en.cargoName('farm_produce')).toBe('Farm produce');
    expect(tr.cityName('city_b')).toBe('Demirkent');
  });

  it('keep every placeholder of the English text in the Turkish one', () => {
    const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();
    for (const [key, text] of Object.entries(EN)) {
      expect(placeholders(TR[key]!), key).toEqual(placeholders(text));
    }
  });
});

describe('Strings', () => {
  it('fills placeholders and shows missing keys as themselves', () => {
    expect(en.t('hud.pickup', { depot: 'Yeniliman depot' })).toBe('Pick up at Yeniliman depot');
    expect(en.t('hud.pickup')).toBe('Pick up at {depot}');
    expect(en.t('no.such.key')).toBe('no.such.key');
  });

  it('formats money with each language’s grouping', () => {
    expect(tr.money(4200)).toBe('4.200 kredi');
    expect(en.money(4200)).toBe('4,200 credits');
    expect(tr.signedMoney(700)).toBe('+700 kredi');
    expect(en.signedMoney(-900)).toBe('−900 credits');
  });

  it('shows short distances in meters and long ones in kilometres', () => {
    expect(en.distance(83)).toBe('85 m');
    expect(tr.distance(1234)).toBe('1,2 km');
    expect(en.distance(1234)).toBe('1.2 km');
  });

  it('shows durations as minutes and seconds, rounding up', () => {
    expect(en.duration(125)).toBe('2:05');
    expect(en.duration(59.2)).toBe('1:00');
    expect(en.duration(-3)).toBe('0:00');
  });

  it('writes percentages the way each language does', () => {
    expect(tr.percent(0.92)).toBe('%92');
    expect(en.percent(0.92)).toBe('92%');
  });

  it('writes whole and fractional tonnes', () => {
    expect(tr.tons(4.5)).toBe('4,5 t');
    expect(en.tons(3)).toBe('3 t');
  });
});

describe('chooseLanguage', () => {
  it('prefers an explicit choice, then the browser languages, then English', () => {
    expect(chooseLanguage('en', ['tr-TR'])).toBe('en');
    expect(chooseLanguage(null, ['tr-TR', 'en-US'])).toBe('tr');
    expect(chooseLanguage(null, ['de-DE', 'en-US'])).toBe('en');
    expect(chooseLanguage('xx', ['TR'])).toBe('tr');
    expect(chooseLanguage(null, [])).toBe('en');
  });
});
