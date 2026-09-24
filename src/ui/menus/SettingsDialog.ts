import { QUALITY_CHOICES, type QualityChoice, type QualityLevel } from '../../data/config/GameConfig';
import { button, element } from '../dom';
import type { Strings } from '../i18n';

/** What the dialog shows as set when it opens. */
export interface SettingsShown {
  /** The player's graphics setting, and the preset it gave (the device's when `auto`, or `?quality=`). */
  readonly quality: QualityChoice;
  readonly qualityInUse: QualityLevel;
  readonly sound: boolean;
}

export interface SettingsActions {
  /** The player picked another graphics setting; the game restarts with it. */
  readonly onQuality: (choice: QualityChoice) => void;
  /** Sound switched on or off; it applies at once. */
  readonly onSound: (on: boolean) => void;
  readonly onClose: () => void;
}

/**
 * The device's settings (spec Phase 7): the graphics preset, or `auto` to
 * let the device decide, with the preset in use now; and sound on or off. A
 * new graphics setting restarts the game, which picks it up at boot; sound
 * switches at once.
 */
export class SettingsDialog {
  private readonly overlay: HTMLDivElement;
  private readonly soundOptions: HTMLButtonElement[] = [];

  constructor(parent: HTMLElement, strings: Strings, shown: SettingsShown, actions: SettingsActions) {
    const document = parent.ownerDocument;
    this.overlay = element(document, 'div', 'screen settings');
    this.overlay.dataset.screen = 'settings';
    this.overlay.hidden = true;
    const panel = element(document, 'div', 'panel settings__panel');

    const quality = radioGroup(document, strings.t('settings.quality'));
    for (const choice of QUALITY_CHOICES) {
      const option = radio(document, strings.t(`settings.quality.${choice}`), 'quality', choice === shown.quality, () => {
        if (choice !== shown.quality) {
          actions.onQuality(choice);
        }
      });
      option.dataset.quality = choice;
      quality.append(option);
    }

    const sound = radioGroup(document, strings.t('settings.sound'));
    sound.classList.add('settings__choices--pair');
    for (const on of [true, false]) {
      const option = radio(document, strings.t(on ? 'settings.sound.on' : 'settings.sound.off'), 'sound', on === shown.sound, () => {
        this.showSound(on);
        actions.onSound(on);
      });
      option.dataset.sound = on ? 'on' : 'off';
      this.soundOptions.push(option);
      sound.append(option);
    }

    panel.append(
      element(document, 'h2', 'panel__title', strings.t('settings.title')),
      element(document, 'h3', 'settings__label', strings.t('settings.quality')),
      quality,
      element(
        document,
        'p',
        'settings__note',
        `${strings.t('settings.inUse', { quality: strings.t(`settings.quality.${shown.qualityInUse}`) })} ${strings.t('settings.restart')}`,
      ),
      element(document, 'h3', 'settings__label', strings.t('settings.sound')),
      sound,
      button(document, 'button--ghost', strings.t('settings.close'), 'close-settings', actions.onClose),
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

  dispose(): void {
    this.overlay.remove();
  }

  private showSound(on: boolean): void {
    for (const option of this.soundOptions) {
      select(option, (option.dataset.sound === 'on') === on);
    }
  }
}

function radioGroup(document: Document, label: string): HTMLDivElement {
  const group = element(document, 'div', 'settings__choices');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', label);
  return group;
}

function radio(document: Document, label: string, action: string, selected: boolean, onPick: () => void): HTMLButtonElement {
  const option = button(document, 'settings__choice', label, action, onPick);
  option.setAttribute('role', 'radio');
  select(option, selected);
  return option;
}

/** Marks a choice as the picked one of its group, or not. */
function select(option: HTMLButtonElement, selected: boolean): void {
  option.classList.toggle('button--primary', selected);
  option.classList.toggle('is-selected', selected);
  option.classList.toggle('button--secondary', !selected);
  option.setAttribute('aria-checked', String(selected));
}
