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
import { CLOCK_PRESETS, type ClockPreset } from '../../systems/weather/TimeOfDayService';
import { button, element } from '../dom';
import { choiceRow, select } from './choiceRow';
import type { Strings } from '../i18n';

/** What the dialog shows as set when it opens. */
export interface SettingsShown {
  /** The player's graphics setting, and the preset it gave (the device's when `auto`, or `?quality=`). */
  readonly quality: QualityChoice;
  readonly qualityInUse: QualityLevel;
  readonly sound: boolean;
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
}

export interface SettingsActions {
  /** The player picked another graphics setting; the game restarts with it. */
  readonly onQuality: (choice: QualityChoice) => void;
  /** The rest apply at once. */
  readonly onSound: (on: boolean) => void;
  readonly onStats: (on: boolean) => void;
  /** The player set the clock, minutes after midnight (a preset, or the slider). */
  readonly onClock: (minutes: number) => void;
  readonly onTimeFlow: (flow: TimeFlow) => void;
  readonly onWeather: (choice: WeatherChoice) => void;
  readonly onSeason: (choice: SeasonChoice) => void;
  readonly onClose: () => void;
}

/** The slider sets the clock in steps of this many minutes. */
const CLOCK_STEP_MINUTES = 5;

/**
 * The device's settings (spec Phase 7): the graphics preset, or `auto` to
 * let the device decide, with the preset in use now; the time of day (a
 * preset, or any time on a slider) and whether the day passes, stands
 * still or keeps the phone's time; the weather, as it comes or held as one
 * kind; the season, the calendar's or held as one; sound on or off; and
 * the performance display, for testing on phones. A new graphics setting
 * restarts the game, which picks it up at boot; everything else applies at
 * once. It opens from the main menu and from the pause menu; the controls
 * have a page of their own (ControlsDialog).
 */
export class SettingsDialog {
  private readonly overlay: HTMLDivElement;
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
    presets.style.setProperty('--rh-choices', String(CLOCK_PRESETS.length));
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
    const stats = choiceRow(document, strings.t('settings.stats'), 'stats', ON_OFF, shown.stats, onOff);
    stats.row.dataset.setting = 'stats';
    stats.onPick(actions.onStats);

    panel.append(
      element(document, 'h2', 'panel__title', strings.t('settings.title')),
      quality.row,
      this.clockRow,
      flow.row,
      weather.row,
      season.row,
      sound.row,
      stats.row,
      button(document, 'button--ghost settings__close', strings.t('settings.close'), 'close-settings', actions.onClose),
    );
    this.overlay.append(panel);
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

  private setClock(minutes: number, actions: SettingsActions): void {
    this.showClock(minutes, this.presetMinutes);
    actions.onClock(minutes);
  }
}

const ON_OFF = [true, false] as const;
