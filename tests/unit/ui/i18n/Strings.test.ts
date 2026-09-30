import { describe, expect, it } from 'vitest';
import { SEASON_CHOICES, TIME_FLOWS, WEATHER_CHOICES } from '../../../../src/data/config/controls';
import { SEASONS } from '../../../../src/data/definitions/Season';
import { GAME_CONTENT } from '../../../../src/data/content';
import { DEFAULT_GAME_CONFIG, QUALITY_CHOICES } from '../../../../src/data/config/GameConfig';
import { BODY_TYPES } from '../../../../src/data/definitions/BodyType';
import { CARGO_CATEGORIES } from '../../../../src/data/definitions/CargoDefinition';
import { FACILITY_EFFECTS } from '../../../../src/data/definitions/FacilityDefinition';
import { MISSION_DIFFICULTIES } from '../../../../src/data/definitions/MissionDefinition';
import { VEHICLE_STATS } from '../../../../src/data/definitions/UpgradeDefinition';
import { VEHICLE_CLASSES } from '../../../../src/data/definitions/VehicleDefinition';
import { TUTORIAL_STEPS } from '../../../../src/domain/tutorial/tutorialSteps';
import { DAMAGE_BANDS } from '../../../../src/domain/vehicles/vehicleDamage';
import { CLOCK_PRESETS } from '../../../../src/systems/weather/TimeOfDayService';
import { HQ_TABS } from '../../../../src/ui/hq/hqTabs';
import { LANGUAGE_NAMES, LANGUAGES, type Language } from '../../../../src/data/config/languages';
import { PRODUCT_IDS } from '../../../../src/data/config/products';
import { DE } from '../../../../src/ui/i18n/de';
import { EN } from '../../../../src/ui/i18n/en';
import { ES } from '../../../../src/ui/i18n/es';
import { FR } from '../../../../src/ui/i18n/fr';
import { ID } from '../../../../src/ui/i18n/id';
import { chooseLanguage, loadStrings, stringsFor } from '../../../../src/ui/i18n';
import { IT } from '../../../../src/ui/i18n/it';
import { PL } from '../../../../src/ui/i18n/pl';
import { PT } from '../../../../src/ui/i18n/pt';
import { RU } from '../../../../src/ui/i18n/ru';
import { Strings, type StringTable } from '../../../../src/ui/i18n/Strings';
import { TR } from '../../../../src/ui/i18n/tr';

const tr = stringsFor('tr');
const en = stringsFor('en');

/** Every language's table. */
const TABLES: Readonly<Record<Language, StringTable>> = { de: DE, en: EN, es: ES, fr: FR, id: ID, it: IT, pl: PL, pt: PT, ru: RU, tr: TR };

/** Names are the same in every language: the cities, villages, trucks, drivers and rival companies. */
const NAME = /^(city|village|vehicle|driver|rival)\./;

describe('string tables', () => {
  it('have the same keys in every language', () => {
    for (const language of LANGUAGES) {
      expect(Object.keys(TABLES[language]).sort(), language).toEqual(Object.keys(EN).sort());
    }
  });

  it('say something in every entry, and keep the names as they are', () => {
    for (const language of LANGUAGES) {
      for (const [key, text] of Object.entries(TABLES[language])) {
        expect(text.trim(), `${language}: ${key}`).not.toBe('');
        if (NAME.test(key)) {
          expect(text, `${language}: ${key}`).toBe(EN[key]);
        }
      }
    }
  });

  it('name every city, village, cargo, mission, truck, upgrade, paint, product, weather, time of day, clock setting, event, driver, rival, facility and its effect, cargo category, tutorial step, graphics setting, stat, difficulty, level, damage band and message in both languages', () => {
    const keys = [
      ...GAME_CONTENT.cities.map((city) => `city.${city.id}.name`),
      ...GAME_CONTENT.paints.map((paint) => `paint.${paint.id}.name`),
      ...PRODUCT_IDS.flatMap((id) => [`product.${id}.name`, `product.${id}.description`]),
      ...GAME_CONTENT.maps.flatMap((map) => (map.villages ?? []).map((village) => `village.${village.id}.name`)),
      ...GAME_CONTENT.cargo.map((cargo) => `cargo.${cargo.id}.name`),
      ...GAME_CONTENT.missions.map((mission) => `mission.${mission.id}.title`),
      ...GAME_CONTENT.vehicles.map((vehicle) => `vehicle.${vehicle.id}.name`),
      ...GAME_CONTENT.upgrades.map((upgrade) => `upgrade.${upgrade.id}.name`),
      ...GAME_CONTENT.weather.map((weather) => `weather.${weather.id}.message`),
      ...GAME_CONTENT.daylight.map((daylight) => `daylight.${daylight.id}.message`),
      ...CLOCK_PRESETS.map((preset) => `settings.clock.${preset}`),
      ...TIME_FLOWS.map((flow) => `settings.timeFlow.${flow}`),
      ...WEATHER_CHOICES.map((choice) => `settings.weather.${choice}`),
      ...SEASON_CHOICES.map((choice) => `settings.season.${choice}`),
      ...SEASONS.map((season) => `season.${season}.message`),
      ...GAME_CONTENT.events.flatMap((event) => [`event.${event.id}.name`, `event.${event.id}.description`]),
      ...GAME_CONTENT.drivers.map((driver) => `driver.${driver.id}.name`),
      ...GAME_CONTENT.rivals.map((rival) => `rival.${rival.id}.name`),
      ...GAME_CONTENT.facilities.flatMap((facility) => [`facility.${facility.id}.name`, `facility.${facility.id}.description`]),
      ...FACILITY_EFFECTS.map((effect) => `facility.effect.${effect}`),
      ...CARGO_CATEGORIES.map((category) => `cargoCategory.${category}`),
      ...TUTORIAL_STEPS.filter((step) => step !== 'done').map((step) => `tutorial.${step}`),
      ...QUALITY_CHOICES.map((choice) => `settings.quality.${choice}`),
      ...VEHICLE_STATS.map((stat) => `stat.${stat}`),
      ...VEHICLE_CLASSES.map((vehicleClass) => `vehicleClass.${vehicleClass}`),
      ...BODY_TYPES.map((body) => `body.${body}`),
      ...HQ_TABS.map((tab) => `hq.tab.${tab}`),
      ...MISSION_DIFFICULTIES.map((difficulty) => `difficulty.${difficulty}`),
      ...DEFAULT_GAME_CONFIG.company.levelXp.map((_, index) => `company.levelName.${index + 1}`),
      ...DAMAGE_BANDS.map((band) => `damage.${band}`),
      ...['tooShort', 'tooLong', 'invalidCharacters'].map((error) => `newCompany.error.${error}`),
      ...['missing', 'corrupted', 'tooNew'].map((problem) => `menu.problem.${problem}`),
    ];
    for (const strings of [tr, en]) {
      for (const key of keys) {
        expect(strings.has(key), `${strings.language}: ${key}`).toBe(true);
      }
    }
    expect(tr.missionTitle({ id: 'first_package', cargoId: 'packaged_food' })).toBe('İlk Paket');
    // A generated contract has no title of its own: it is named after its cargo.
    expect(tr.missionTitle({ id: 'daily_81960_1', cargoId: 'farm_produce' })).toBe('Tarım ürünleri sevkiyatı');
    expect(en.cargoName('farm_produce')).toBe('Farm produce');
    expect(tr.cityName('city_b')).toBe('Ironford');
  });

  it('keep every placeholder of the English text in every language', () => {
    const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();
    for (const language of LANGUAGES) {
      for (const [key, text] of Object.entries(EN)) {
        expect(placeholders(TABLES[language][key]!), `${language}: ${key}`).toEqual(placeholders(text));
      }
    }
  });

  it('name every language in itself, and load each one’s table', async () => {
    expect(new Set(LANGUAGES).size).toBe(LANGUAGES.length);
    for (const language of LANGUAGES) {
      expect(LANGUAGE_NAMES[language].length, language).toBeGreaterThan(2);
      const strings = await loadStrings(language);
      expect(strings.language).toBe(language);
      expect(strings.t('settings.title')).toBe(TABLES[language]['settings.title']);
    }
  });
});

describe('Strings', () => {
  it('fills placeholders and shows missing keys as themselves', () => {
    expect(en.t('hud.pickup', { depot: 'Havenport depot' })).toBe('Pick up at Havenport depot');
    expect(en.t('hud.pickup')).toBe('Pick up at {depot}');
    expect(en.t('no.such.key')).toBe('no.such.key');
  });

  it('groups whole numbers the way each language does', () => {
    expect(tr.number(12000)).toBe('12.000');
    expect(en.number(12000)).toBe('12,000');
    expect(new Strings('de', DE).number(12000)).toBe('12.000');
    expect(new Strings('pt', PT).number(12000)).toBe('12.000');
    expect(new Strings('id', ID).number(12000)).toBe('12.000');
    // A (narrow) no-break space.
    expect(new Strings('ru', RU).number(12000)).toMatch(/^12\s000$/u);
    expect(new Strings('fr', FR).number(12000)).toMatch(/^12\s000$/u);
    expect(new Strings('de', DE).tons(4.5)).toBe('4,5 t');
  });

  it('formats money with each language’s grouping', () => {
    expect(tr.money(4200)).toBe('4.200 kredi');
    expect(en.money(4200)).toBe('4,200 credits');
    expect(tr.signedMoney(700)).toBe('+700 kredi');
    expect(en.signedMoney(-900)).toBe('−900 credits');
    expect(en.signedMoney(0)).toBe('0 credits');
    expect(en.signedMoney(-0)).toBe('0 credits');
  });

  it('shows time spans in days and hours, or hours and minutes, rounded up', () => {
    const minute = 60_000;
    expect(en.timeSpan(3 * 24 * 60 * minute + 4 * 60 * minute + 10 * minute)).toBe('3 d 4 h');
    expect(tr.timeSpan(5 * 60 * minute + 19.5 * minute)).toBe('5 sa 20 dk');
    expect(en.timeSpan(0)).toBe('0 h 0 min');
  });

  it('shows short distances in meters and long ones in kilometres', () => {
    expect(en.distance(83)).toBe('85 m');
    expect(en.distance(998)).toBe('1.0 km');
    expect(en.distance(997)).toBe('995 m');
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
  it('prefers the address, then the browser languages it speaks, then English', () => {
    expect(chooseLanguage('en', ['tr-TR'])).toBe('en');
    expect(chooseLanguage(null, ['tr-TR', 'en-US'])).toBe('tr');
    expect(chooseLanguage(null, ['ja-JP', 'de-DE', 'en-US'])).toBe('de');
    expect(chooseLanguage('xx', ['TR'])).toBe('tr');
    expect(chooseLanguage(null, ['ja-JP'])).toBe('en');
    expect(chooseLanguage(null, [])).toBe('en');
  });

  it('keeps the player’s pick over the device’s, though not over the address', () => {
    expect(chooseLanguage(null, ['tr-TR'], 'ru')).toBe('ru');
    expect(chooseLanguage(null, ['tr-TR'], 'auto')).toBe('tr');
    expect(chooseLanguage('es', ['tr-TR'], 'ru')).toBe('es');
  });

  it('reads a language by its base, and Indonesian by its old Android name', () => {
    expect(chooseLanguage(null, ['pt-PT'])).toBe('pt');
    expect(chooseLanguage(null, ['es-419'])).toBe('es');
    expect(chooseLanguage(null, ['in-ID'])).toBe('id');
    expect(chooseLanguage(null, ['fr_CA'])).toBe('fr');
  });
});
