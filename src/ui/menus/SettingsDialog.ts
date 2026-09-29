import { formatClock, MINUTES_PER_DAY } from '../../core/time/dayTime';
import {
  SEASON_CHOICES,
  TIME_FLOWS,
  WEATHER_CHOICES,
  type SeasonChoice,
  type TimeFlow,
  type WeatherChoice,
} from '../../data/config/controls';
import { QUALITY_CHOICES, type QualityChoice, type QualityLevel } from '../../data/config/GameConfig';
import { isLanguageChoice, LANGUAGE_NAMES, LANGUAGES, type Language, type LanguageChoice } from '../../data/config/languages';
import { CLOCK_PRESETS, type ClockPreset } from '../../systems/weather/TimeOfDayService';
import { button, element } from '../dom';
import { choiceRow, select } from './choiceRow';
import type { Strings } from '../i18n';

/** What the dialog shows as set when it opens. */
export interface SettingsShown {
  /** The player's language setting, and the language the device's setting gives. */
  readonly language: LanguageChoice;
  readonly deviceLanguage: Language;
  /** The player's graphics setting, and the preset it gave (the device's when `auto`, or `?quality=`). */
  readonly quality: QualityChoice;
  readonly qualityInUse: QualityLevel;
  readonly sound: boolean;
  /** Buzzing on crashes, where the device can (a touch screen); null where it is not offered. */
  readonly vibration: boolean | null;
  /** The performance display: FPS, draw calls, the preset and the GPU. */
  readonly stats: boolean;
  /** The game's clock: the time now (minutes after midnight), and how it goes. */
  readonly clockMinutes: number;
  readonly timeFlow: TimeFlow;
  /** The time today of each of the clock's presets (dawn, the morning, noon, dusk, the night). */
  readonly clockPresets: Readonly<Record<ClockPreset, number>>;
  /** The weather: as it comes, or the one held. */
  readonly weather: WeatherChoice;
  /** The season: the calendar's, or the one held. */
  readonly season: SeasonChoice;
  /** About the game: its version and build, and where its privacy policy is published. */
  readonly about: {
    readonly version: string;
    readonly build: string;
    readonly privacyUrl: string;
    /** Links open in place (the Android app hands them to the browser) rather than in a new tab. */
    readonly linksInPlace: boolean;
  };
}

export interface SettingsActions {
  /** The player picked another language; the game restarts in it. */
  readonly onLanguage: (choice: LanguageChoice) => void;
  /** The player picked another graphics setting; the game restarts with it. */
  readonly onQuality: (choice: QualityChoice) => void;
  /** The rest apply at once. */
  readonly onSound: (on: boolean) => void;
  readonly onVibration: (on: boolean) => void;
  readonly onStats: (on: boolean) => void;
  /** The player set the clock, minutes after midnight (a preset, or the slider). */
  readonly onClock: (minutes: number) => void;
  readonly onTimeFlow: (flow: TimeFlow) => void;
  readonly onWeather: (choice: WeatherChoice) => void;
  readonly onSeason: (choice: SeasonChoice) => void;
  /** The open-source licences' text, loaded the first time their page opens. */
  readonly loadLicenses: () => Promise<string>;
  readonly onClose: () => void;
}

/** The slider sets the clock in steps of this many minutes. */
const CLOCK_STEP_MINUTES = 5;

/**
 * The device's settings (spec Phase 7): the language, the device's or one
 * picked from a list; the graphics preset, or `auto` to let the device
 * decide, with the preset in use now; the time of day (a preset, or any
 * time on a slider) and whether the day passes, stands still or keeps the
 * phone's time; the weather, as it comes or held as one kind; the season,
 * the calendar's or held as one; sound and vibration on or off; and the
 * performance display, for testing on phones. A new language or graphics
 * setting restarts the game, which picks it up at boot; everything else
 * applies at once. Below them, about the game: its version, the
 * open-source licences (a page of their own within the dialog) and the
 * privacy policy. It opens from the main menu and from the pause menu; the
 * controls have a page of their own (ControlsDialog).
 */
export class SettingsDialog {
  private readonly overlay: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly languageSelect: HTMLSelectElement;
  private readonly licensesPanel: HTMLDivElement;
  private readonly licensesText: HTMLPreElement;
  private licensesLoaded = false;
  private readonly clockRow: HTMLDivElement;
  private readonly clockTime: HTMLOutputElement;
  private readonly clockSlider: HTMLInputElement;
  private readonly clockPresets: readonly HTMLButtonElement[];
  private presetMinutes: Readonly<Record<ClockPreset, number>>;

  constructor(parent: HTMLElement, strings: Strings, shown: SettingsShown, actions: SettingsActions) {
    const document = parent.ownerDocument;
    this.overlay = element(document, 'div', 'screen settings');
    this.overlay.dataset.screen = 'settings';
    this.overlay.hidden = true;
    const panel = element(document, 'div', 'panel settings__panel');
    this.panel = panel;

    // The language: a list (ten names do not fit a row of buttons), each language named in itself.
    const language = element(document, 'div', 'settings__row');
    language.dataset.setting = 'language';
    this.languageSelect = element(document, 'select', 'settings__select');
    this.languageSelect.setAttribute('aria-label', strings.t('settings.language'));
    const option = (value: LanguageChoice, label: string): HTMLOptionElement => {
      const node = element(document, 'option', '', label);
      node.value = value;
      node.lang = value === 'auto' ? strings.language : value;
      return node;
    };
    this.languageSelect.append(
      option('auto', strings.t('settings.language.auto', { language: LANGUAGE_NAMES[shown.deviceLanguage] })),
      ...LANGUAGES.map((code) => option(code, LANGUAGE_NAMES[code])),
    );
    this.languageSelect.value = shown.language;
    this.languageSelect.addEventListener('change', () => {
      const choice = this.languageSelect.value;
      if (isLanguageChoice(choice) && choice !== shown.language) {
        actions.onLanguage(choice);
      }
    });
    language.append(
      element(document, 'h3', 'settings__label', strings.t('settings.language')),
      this.languageSelect,
      element(document, 'p', 'settings__note', strings.t('settings.languageNote')),
    );

    const quality = choiceRow(document, strings.t('settings.quality'), 'quality', QUALITY_CHOICES, shown.quality, (choice) =>
      strings.t(`settings.quality.${choice}`),
    );
    quality.row.dataset.setting = 'quality';
    quality.row.append(
      element(
        document,
        'p',
        'settings__note',
        `${strings.t('settings.inUse', { quality: strings.t(`settings.quality.${shown.qualityInUse}`) })} ${strings.t('settings.restart')}`,
      ),
    );
    quality.onPick((choice) => {
      if (choice !== shown.quality) {
        actions.onQuality(choice);
      }
    });

    // The time of day: a preset, or any time on the slider; the readout shows it.
    this.presetMinutes = shown.clockPresets;
    this.clockRow = element(document, 'div', 'settings__row settings__clock');
    this.clockRow.dataset.setting = 'clock';
    const clockLabel = element(document, 'h3', 'settings__label', `${strings.t('settings.clock')} `);
    this.clockTime = element(document, 'output', 'settings__clock-time');
    clockLabel.append(this.clockTime);
    const presets = element(document, 'div', 'settings__choices');
    this.clockPresets = CLOCK_PRESETS.map((preset) => {
      const option = button(document, 'settings__choice button--secondary', strings.t(`settings.clock.${preset}`), 'clock', () =>
        this.setClock(this.presetMinutes[preset], actions),
      );
      option.dataset.clock = preset;
      presets.append(option);
      return option;
    });
    this.clockSlider = element(document, 'input', 'settings__slider');
    this.clockSlider.type = 'range';
    this.clockSlider.min = '0';
    this.clockSlider.max = String(MINUTES_PER_DAY - CLOCK_STEP_MINUTES);
    this.clockSlider.step = String(CLOCK_STEP_MINUTES);
    this.clockSlider.setAttribute('aria-label', strings.t('settings.clock'));
    this.clockSlider.addEventListener('input', () => this.setClock(Number(this.clockSlider.value), actions));
    this.clockRow.append(clockLabel, presets, this.clockSlider);
    const flow = choiceRow(document, strings.t('settings.timeFlow'), 'time-flow', TIME_FLOWS, shown.timeFlow, (choice) =>
      strings.t(`settings.timeFlow.${choice}`),
    );
    flow.row.dataset.setting = 'time-flow';
    flow.row.append(element(document, 'p', 'settings__note', strings.t('settings.timeNote')));
    flow.onPick((choice) => {
      this.clockSlider.disabled = choice === 'device';
      actions.onTimeFlow(choice);
    });
    this.clockSlider.disabled = shown.timeFlow === 'device';
    this.showClock(shown.clockMinutes, shown.clockPresets);

    const weather = choiceRow(document, strings.t('settings.weather'), 'weather', WEATHER_CHOICES, shown.weather, (choice) =>
      strings.t(`settings.weather.${choice}`),
    );
    weather.row.dataset.setting = 'weather';
    weather.row.append(element(document, 'p', 'settings__note', strings.t('settings.weatherNote')));
    weather.onPick(actions.onWeather);

    const season = choiceRow(document, strings.t('settings.season'), 'season', SEASON_CHOICES, shown.season, (choice) =>
      strings.t(`settings.season.${choice}`),
    );
    season.row.dataset.setting = 'season';
    season.row.append(element(document, 'p', 'settings__note', strings.t('settings.seasonNote')));
    season.onPick(actions.onSeason);

    const onOff = (value: boolean): string => strings.t(value ? 'settings.on' : 'settings.off');
    const sound = choiceRow(document, strings.t('settings.sound'), 'sound', ON_OFF, shown.sound, onOff);
    sound.row.dataset.setting = 'sound';
    sound.onPick(actions.onSound);
    const vibration =
      shown.vibration === null ? null : choiceRow(document, strings.t('settings.vibration'), 'vibration', ON_OFF, shown.vibration, onOff);
    if (vibration !== null) {
      vibration.row.dataset.setting = 'vibration';
      vibration.row.append(element(document, 'p', 'settings__note', strings.t('settings.vibrationNote')));
      vibration.onPick(actions.onVibration);
    }
    const stats = choiceRow(document, strings.t('settings.stats'), 'stats', ON_OFF, shown.stats, onOff);
    stats.row.dataset.setting = 'stats';
    stats.onPick(actions.onStats);

    // About the game: its version and build, what it is made with, the licences and the privacy policy.
    const about = element(document, 'div', 'settings__row settings__about');
    about.dataset.setting = 'about';
    const version = element(
      document,
      'p',
      'settings__note settings__version',
      strings.t('about.version', { version: shown.about.version, build: shown.about.build }),
    );
    const links = element(document, 'div', 'settings__links');
    const privacy = element(document, 'a', 'button button--secondary settings__link', strings.t('about.privacy'));
    privacy.href = shown.about.privacyUrl;
    privacy.dataset.action = 'privacy-policy';
    if (!shown.about.linksInPlace) {
      privacy.target = '_blank';
      privacy.rel = 'noopener';
    }
    links.append(
      button(document, 'button--secondary settings__link', strings.t('about.licenses'), 'licenses', () => this.showLicenses(true, actions)),
      privacy,
    );
    about.append(
      element(document, 'h3', 'settings__label', strings.t('settings.about')),
      version,
      element(document, 'p', 'settings__note', strings.t('about.credits')),
      links,
    );

    panel.append(
      element(document, 'h2', 'panel__title', strings.t('settings.title')),
      language,
      quality.row,
      this.clockRow,
      flow.row,
      weather.row,
      season.row,
      sound.row,
      ...(vibration === null ? [] : [vibration.row]),
      stats.row,
      about,
      button(document, 'button--ghost settings__close', strings.t('settings.close'), 'close-settings', actions.onClose),
    );

    // The licences: a page of the dialog's own, back to the settings when closed.
    this.licensesPanel = element(document, 'div', 'panel settings__panel settings__licenses');
    this.licensesPanel.hidden = true;
    this.licensesText = element(document, 'pre', 'settings__licenses-text', '…');
    this.licensesPanel.append(
      element(document, 'h2', 'panel__title', strings.t('about.licenses')),
      this.licensesText,
      button(document, 'button--ghost settings__close', strings.t('settings.close'), 'close-licenses', () =>
        this.showLicenses(false, actions),
      ),
    );
    this.overlay.append(panel, this.licensesPanel);
    parent.append(this.overlay);
  }

  get isOpen(): boolean {
    return !this.overlay.hidden;
  }

  open(): void {
    this.overlay.hidden = false;
  }

  close(): void {
    this.overlay.hidden = true;
    this.panel.hidden = false;
    this.licensesPanel.hidden = true;
  }

  /** Opens the dialog at its language list (the main menu's language button). */
  openAtLanguage(): void {
    this.open();
    this.languageSelect.scrollIntoView({ block: 'nearest' });
    this.languageSelect.focus({ preventScroll: true });
  }

  /** Android's back button: from the licences back to the settings; from the settings, shut. */
  stepBack(): void {
    if (!this.licensesPanel.hidden) {
      this.panel.hidden = false;
      this.licensesPanel.hidden = true;
    } else {
      this.close();
    }
  }

  /**
   * Shows the clock as it stands now (it goes on while the dialog is shut),
   * with the time today of each preset.
   */
  showClock(minutes: number, presets: Readonly<Record<ClockPreset, number>>): void {
    this.presetMinutes = presets;
    const stepped = Math.round(minutes / CLOCK_STEP_MINUTES) * CLOCK_STEP_MINUTES;
    this.clockSlider.value = String(Math.min(stepped, MINUTES_PER_DAY - CLOCK_STEP_MINUTES));
    this.clockTime.value = formatClock(minutes);
    CLOCK_PRESETS.forEach((preset, index) => select(this.clockPresets[index]!, Math.abs(presets[preset] - minutes) < 1));
  }

  dispose(): void {
    this.overlay.remove();
  }

  /** Shows the licences' page (loading their text the first time), or goes back to the settings. */
  private showLicenses(shown: boolean, actions: SettingsActions): void {
    this.panel.hidden = shown;
    this.licensesPanel.hidden = !shown;
    if (shown && !this.licensesLoaded) {
      this.licensesLoaded = true;
      actions.loadLicenses().then(
        (text) => {
          this.licensesText.textContent = text;
        },
        () => {
          // Not loaded (offline in a browser, between deployments): try again next time.
          this.licensesLoaded = false;
        },
      );
    }
  }

  private setClock(minutes: number, actions: SettingsActions): void {
    this.showClock(minutes, this.presetMinutes);
    actions.onClock(minutes);
  }
}

const ON_OFF = [true, false] as const;
