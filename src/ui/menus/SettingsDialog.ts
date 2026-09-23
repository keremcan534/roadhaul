import { QUALITY_CHOICES, type QualityChoice, type QualityLevel } from '../../data/config/GameConfig';
import { button, element } from '../dom';
import type { Strings } from '../i18n';

export interface SettingsActions {
  /** The player picked another graphics setting; the game restarts with it. */
  readonly onQuality: (choice: QualityChoice) => void;
  readonly onClose: () => void;
}

/**
 * The device's settings (spec Phase 7): the graphics preset, or `auto` to
 * let the device decide, and which preset is in use now. A new setting
 * restarts the game, which picks it up at boot.
 */
export class SettingsDialog {
  private readonly overlay: HTMLDivElement;

  constructor(parent: HTMLElement, strings: Strings, setting: QualityChoice, inUse: QualityLevel, actions: SettingsActions) {
    const document = parent.ownerDocument;
    this.overlay = element(document, 'div', 'screen settings');
    this.overlay.dataset.screen = 'settings';
    this.overlay.hidden = true;
    const panel = element(document, 'div', 'panel settings__panel');
    const choices = element(document, 'div', 'settings__choices');
    choices.setAttribute('role', 'radiogroup');
    choices.setAttribute('aria-label', strings.t('settings.quality'));
    for (const choice of QUALITY_CHOICES) {
      const option = button(
        document,
        choice === setting ? 'button--primary settings__choice is-selected' : 'button--secondary settings__choice',
        strings.t(`settings.quality.${choice}`),
        'quality',
        () => {
          if (choice !== setting) {
            actions.onQuality(choice);
          }
        },
      );
      option.dataset.quality = choice;
      option.setAttribute('role', 'radio');
      option.setAttribute('aria-checked', String(choice === setting));
      choices.append(option);
    }
    panel.append(
      element(document, 'h2', 'panel__title', strings.t('settings.title')),
      element(document, 'h3', 'settings__label', strings.t('settings.quality')),
      choices,
      element(
        document,
        'p',
        'settings__note',
        `${strings.t('settings.inUse', { quality: strings.t(`settings.quality.${inUse}`) })} ${strings.t('settings.restart')}`,
      ),
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
}
