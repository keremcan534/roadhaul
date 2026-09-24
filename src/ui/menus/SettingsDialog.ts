import {
  CONTROL_SIZES,
  STEERING_MODES,
  TILT_SENSITIVITIES,
  type ControlSize,
  type SteeringMode,
  type TiltSensitivity,
} from '../../data/config/controls';
import { QUALITY_CHOICES, type QualityChoice, type QualityLevel } from '../../data/config/GameConfig';
import { button, element } from '../dom';
import type { Strings } from '../i18n';

/** What the dialog shows as set when it opens. */
export interface SettingsShown {
  /** The player's graphics setting, and the preset it gave (the device's when `auto`, or `?quality=`). */
  readonly quality: QualityChoice;
  readonly qualityInUse: QualityLevel;
  readonly steering: SteeringMode;
  readonly tiltSensitivity: TiltSensitivity;
  readonly controlSize: ControlSize;
  readonly sound: boolean;
  /** The performance display: FPS, draw calls, the preset and the GPU. */
  readonly stats: boolean;
}

export interface SettingsActions {
  /** The player picked another graphics setting; the game restarts with it. */
  readonly onQuality: (choice: QualityChoice) => void;
  /** The rest apply at once. Picking tilt is a tap, so iOS can be asked for the motion sensor there. */
  readonly onSteering: (mode: SteeringMode) => void;
  readonly onTiltSensitivity: (sensitivity: TiltSensitivity) => void;
  readonly onControlSize: (size: ControlSize) => void;
  readonly onSound: (on: boolean) => void;
  readonly onStats: (on: boolean) => void;
  readonly onClose: () => void;
}

/** A row of choices, one of them picked. */
interface ChoiceRow<T> {
  readonly row: HTMLDivElement;
  /** Marks `value` as the picked one, without telling anyone. */
  pick(value: T): void;
  /** Who hears when the player picks a choice. */
  onPick(listener: (value: T) => void): void;
}

/**
 * The device's settings (spec Phase 7): the graphics preset, or `auto` to
 * let the device decide, with the preset in use now; how to steer (the
 * on-screen wheel, turning the phone, or buttons), how sensitive tilt
 * steering is, and how big the controls are; sound on or off; and the
 * performance display, for testing on phones. A new graphics setting
 * restarts the game, which picks it up at boot; everything else applies at
 * once. It opens from the main menu and from the pause menu.
 */
export class SettingsDialog {
  private readonly overlay: HTMLDivElement;
  private readonly steering: ChoiceRow<SteeringMode>;
  private readonly tiltRow: HTMLDivElement;

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

    this.steering = choiceRow(document, strings.t('settings.steering'), 'steering', STEERING_MODES, shown.steering, (mode) =>
      strings.t(`settings.steering.${mode}`),
    );
    this.steering.row.dataset.setting = 'steering';
    this.steering.onPick((mode) => {
      this.tiltRow.hidden = mode !== 'tilt';
      actions.onSteering(mode);
    });

    const tilt = choiceRow(
      document,
      strings.t('settings.tiltSensitivity'),
      'tilt-sensitivity',
      TILT_SENSITIVITIES,
      shown.tiltSensitivity,
      (sensitivity) => strings.t(`settings.tiltSensitivity.${sensitivity}`),
    );
    tilt.onPick(actions.onTiltSensitivity);
    this.tiltRow = tilt.row;
    this.tiltRow.dataset.setting = 'tilt-sensitivity';
    this.tiltRow.append(element(document, 'p', 'settings__note', strings.t('settings.tiltNote')));
    this.tiltRow.hidden = shown.steering !== 'tilt';

    const size = choiceRow(document, strings.t('settings.controlSize'), 'control-size', CONTROL_SIZES, shown.controlSize, (choice) =>
      strings.t(`settings.controlSize.${choice}`),
    );
    size.row.dataset.setting = 'control-size';
    size.onPick(actions.onControlSize);

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
      this.steering.row,
      this.tiltRow,
      size.row,
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

  /** Shows a way of steering the game picked itself (tilt steering turned out unavailable). */
  showSteering(mode: SteeringMode): void {
    this.steering.pick(mode);
    this.tiltRow.hidden = mode !== 'tilt';
  }

  dispose(): void {
    this.overlay.remove();
  }
}

const ON_OFF = [true, false] as const;

/**
 * A labelled row of choices, each marked `data-<key>="<value>"` (on/off for
 * true/false). Picking one shows it picked at once and tells the listener
 * given to `onPick`.
 */
function choiceRow<T extends string | boolean>(
  document: Document,
  label: string,
  key: string,
  values: readonly T[],
  picked: T,
  labelOf: (value: T) => string,
): ChoiceRow<T> {
  const row = element(document, 'div', 'settings__row');
  const group = element(document, 'div', 'settings__choices');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', label);
  group.style.setProperty('--rh-choices', String(values.length));
  const dataKey = key.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase());
  let listener: (value: T) => void = () => {};
  const options = values.map((value) => {
    const option = button(document, 'settings__choice', labelOf(value), key, () => {
      pick(value);
      listener(value);
    });
    option.setAttribute('role', 'radio');
    option.dataset[dataKey] = typeof value === 'boolean' ? (value ? 'on' : 'off') : value;
    group.append(option);
    return option;
  });
  const pick = (value: T): void => {
    values.forEach((candidate, index) => select(options[index]!, candidate === value));
  };
  pick(picked);
  row.append(element(document, 'h3', 'settings__label', label), group);
  return {
    row,
    pick,
    onPick: (next) => {
      listener = next;
    },
  };
}

/** Marks a choice as the picked one of its group, or not. */
function select(option: HTMLButtonElement, selected: boolean): void {
  option.classList.toggle('button--primary', selected);
  option.classList.toggle('is-selected', selected);
  option.classList.toggle('button--secondary', !selected);
  option.setAttribute('aria-checked', String(selected));
}
