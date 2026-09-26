import { describe, expect, it } from 'vitest';
import { TIME_FLOWS, WEATHER_CHOICES } from '../../../../src/data/config/controls';
import { GAME_CONTENT } from '../../../../src/data/content';
import { DEFAULT_GAME_CONFIG, QUALITY_CHOICES } from '../../../../src/data/config/GameConfig';
import { BODY_TYPES } from '../../../../src/data/definitions/BodyType';
import { CARGO_CATEGORIES } from '../../../../src/data/definitions/CargoDefinition';
import { MISSION_DIFFICULTIES } from '../../../../src/data/definitions/MissionDefinition';
import { VEHICLE_STATS } from '../../../../src/data/definitions/UpgradeDefinition';
import { VEHICLE_CLASSES } from '../../../../src/data/definitions/VehicleDefinition';
import { TUTORIAL_STEPS } from '../../../../src/domain/tutorial/tutorialSteps';
import { DAMAGE_BANDS } from '../../../../src/domain/vehicles/vehicleDamage';
import { CLOCK_PRESETS } from '../../../../src/systems/weather/TimeOfDayService';
import { HQ_TABS } from '../../../../src/ui/hq/hqTabs';
import { EN } from '../../../../src/ui/i18n/en';
import { chooseLanguage, stringsFor } from '../../../../src/ui/i18n';
import { TR } from '../../../../src/ui/i18n/tr';

const tr = stringsFor('tr');
const en = stringsFor('en');

describe('string tables', () => {
  it('have the same keys in Turkish and English', () => {
    expect(Object.keys(TR).sort()).toEqual(Object.keys(EN).sort());
  });

  it('name every city, cargo, mission, truck, upgrade, weather, time of day, clock setting, event, driver, rival, cargo category, tutorial step, graphics setting, stat, difficulty, level, damage band and message in both languages', () => {
    const keys = [
      ...GAME_CONTENT.cities.map((city) => `city.${city.id}.name`),
      ...GAME_CONTENT.cargo.map((cargo) => `cargo.${cargo.id}.name`),
      ...GAME_CONTENT.missions.map((mission) => `mission.${mission.id}.title`),
      ...GAME_CONTENT.vehicles.map((vehicle) => `vehicle.${vehicle.id}.name`),
      ...GAME_CONTENT.upgrades.map((upgrade) => `upgrade.${upgrade.id}.name`),
      ...GAME_CONTENT.weather.map((weather) => `weather.${weather.id}.message`),
      ...GAME_CONTENT.daylight.map((daylight) => `daylight.${daylight.id}.message`),
      ...CLOCK_PRESETS.map((preset) => `settings.clock.${preset}`),
      ...TIME_FLOWS.map((flow) => `settings.timeFlow.${flow}`),
      ...WEATHER_CHOICES.map((choice) => `settings.weather.${choice}`),
      ...GAME_CONTENT.events.flatMap((event) => [`event.${event.id}.name`, `event.${event.id}.description`]),
      ...GAME_CONTENT.drivers.map((driver) => `driver.${driver.id}.name`),
      ...GAME_CONTENT.rivals.map((rival) => `rival.${rival.id}.name`),
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

  it('keep every placeholder of the English text in the Turkish one', () => {
    const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();
    for (const [key, text] of Object.entries(EN)) {
      expect(placeholders(TR[key]!), key).toEqual(placeholders(text));
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
  it('prefers an explicit choice, then the browser languages, then English', () => {
    expect(chooseLanguage('en', ['tr-TR'])).toBe('en');
    expect(chooseLanguage(null, ['tr-TR', 'en-US'])).toBe('tr');
    expect(chooseLanguage(null, ['de-DE', 'en-US'])).toBe('en');
    expect(chooseLanguage('xx', ['TR'])).toBe('tr');
    expect(chooseLanguage(null, [])).toBe('en');
  });
});
