import {
  FALLBACK_LANGUAGE,
  LANGUAGE_LOCALES,
  languageOfTag,
  type Language,
  type LanguageChoice,
} from '../../data/config/languages';
import type { MissionDefinition } from '../../data/definitions/MissionDefinition';
import type { Credits, Fraction } from '../../data/units';

export { LANGUAGES, type Language } from '../../data/config/languages';

/** Player-facing text by key. Content keys derive from definition ids: `cargo.<id>.name`, `city.<id>.name`, `mission.<id>.title`. */
export type StringTable = Readonly<Record<string, string>>;

export type TextParameters = Readonly<Record<string, string | number>>;

/**
 * Localised text and number formats for one language (spec: localization,
 * roadmap Phase 7; the languages: data/config/languages.ts). UI code asks
 * for text by key and never hard-codes player-facing strings.
 */
export class Strings {
  private readonly integer: Intl.NumberFormat;
  private readonly decimal: Intl.NumberFormat;
  private readonly percentFormat: Intl.NumberFormat;

  constructor(
    readonly language: Language,
    private readonly table: StringTable,
  ) {
    const locale = LANGUAGE_LOCALES[language];
    this.integer = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
    this.decimal = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    this.percentFormat = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 });
  }

  /** The text for `key`, with `{name}` placeholders filled from `parameters`. A missing key shows as itself, so it stands out. */
  t(key: string, parameters?: TextParameters): string {
    const template = this.table[key] ?? key;
    if (parameters === undefined) {
      return template;
    }
    return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
      name in parameters ? String(parameters[name]) : placeholder,
    );
  }

  has(key: string): boolean {
    return key in this.table;
  }

  cityName(cityId: string): string {
    return this.t(`city.${cityId}.name`);
  }

  /** A village's name (MapDefinition.villages): the same in every language, like the cities'. */
  villageName(villageId: string): string {
    return this.t(`village.${villageId}.name`);
  }

  cargoName(cargoId: string): string {
    return this.t(`cargo.${cargoId}.name`);
  }

  /** A contract's title: the game's own have one each; a generated contract is named after its cargo. */
  missionTitle(mission: Pick<MissionDefinition, 'id' | 'cargoId'>): string {
    const key = `mission.${mission.id}.title`;
    return this.has(key) ? this.t(key) : this.t('mission.generated.title', { cargo: this.cargoName(mission.cargoId) });
  }

  vehicleName(vehicleId: string): string {
    return this.t(`vehicle.${vehicleId}.name`);
  }

  upgradeName(upgradeId: string): string {
    return this.t(`upgrade.${upgradeId}.name`);
  }

  eventName(eventId: string): string {
    return this.t(`event.${eventId}.name`);
  }

  rivalName(rivalId: string): string {
    return this.t(`rival.${rivalId}.name`);
  }

  facilityName(facilityId: string): string {
    return this.t(`facility.${facilityId}.name`);
  }

  /** A whole number with the language's grouping: "12.000", "12,000". */
  number(value: number): string {
    return this.integer.format(value);
  }

  /** Whole credits with grouping: "4.200 kredi", "4,200 credits". */
  money(credits: Credits): string {
    return this.t('format.money', { amount: this.integer.format(credits) });
  }

  /** Signed, for itemised pay: "+700 kredi", "−900 kredi"; zero has no sign. */
  signedMoney(credits: Credits): string {
    if (credits === 0) {
      return this.money(0);
    }
    return `${credits < 0 ? '−' : '+'}${this.money(Math.abs(credits))}`;
  }

  /** "85 m" (in steps of 5 m) under a kilometre, "1,2 km" from there. */
  distance(meters: number): string {
    const rounded = Math.round(meters / 5) * 5;
    return rounded < 1000
      ? this.t('format.meters', { value: this.integer.format(rounded) })
      : this.t('format.kilometers', { value: this.decimal.format(meters / 1000) });
  }

  /** Minutes and seconds: "2:05". */
  duration(seconds: number): string {
    const whole = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  }

  /** A span of days and hours, or else hours and minutes, rounded up: "3 g 4 sa", "5 h 20 min". */
  timeSpan(ms: number): string {
    const minutes = Math.max(0, Math.ceil(ms / 60_000));
    const days = Math.floor(minutes / (24 * 60));
    return days > 0
      ? this.t('format.daysHours', { days, hours: Math.floor((minutes % (24 * 60)) / 60) })
      : this.t('format.hoursMinutes', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
  }

  /** "%92" in Turkish, "92%" in English. */
  percent(fraction: Fraction): string {
    return this.percentFormat.format(fraction);
  }

  /** Tonnes with one decimal when needed: "4,5 t". */
  tons(tons: number): string {
    return this.t('format.tons', { value: Number.isInteger(tons) ? this.integer.format(tons) : this.decimal.format(tons) });
  }
}

/**
 * Picks the language: the address's (`?lang=`, for tests and links) wins,
 * then the player's setting, then the first of the device's preferred
 * languages the game speaks (by its base: `pt-PT` speaks Brazilian
 * Portuguese); English otherwise.
 */
export function chooseLanguage(requested: string | null, preferred: readonly string[], setting: LanguageChoice = 'auto'): Language {
  const asked = requested === null ? null : languageOfTag(requested);
  if (asked !== null) {
    return asked;
  }
  if (setting !== 'auto') {
    return setting;
  }
  for (const tag of preferred) {
    const language = languageOfTag(tag);
    if (language !== null) {
      return language;
    }
  }
  return FALLBACK_LANGUAGE;
}
