import {
  CAMERA_MODES,
  CONTROL_SIZES,
  STEERING_MODES,
  TILT_SENSITIVITIES,
  type CameraMode,
  type ControlSize,
  type SteeringMode,
  type TiltSensitivity,
} from '../../data/config/controls';
import { button, element } from '../dom';
import type { Strings } from '../i18n';
import { icon } from '../icons';
import type { IconName } from '../iconShapes';
import { LabelFitter } from '../LabelFitter';
import { choiceRow, select, type ChoiceRow } from './choiceRow';

/** The controls as set when the page opens. */
export interface ControlsShown {
  readonly steering: SteeringMode;
  readonly tiltSensitivity: TiltSensitivity;
  readonly controlSize: ControlSize;
  /** The camera a drive starts with: the one last picked. */
  readonly camera: CameraMode;
}

export interface ControlsActions {
  /** Each applies at once. Picking tilt is a tap, so iOS can be asked for the motion sensor there. */
  readonly onSteering: (mode: SteeringMode) => void;
  readonly onTiltSensitivity: (sensitivity: TiltSensitivity) => void;
  readonly onControlSize: (size: ControlSize) => void;
  readonly onCamera: (mode: CameraMode) => void;
  readonly onClose: () => void;
}

/** Each way of steering's picture on its card. */
const STEERING_ICONS: Readonly<Record<SteeringMode, IconName>> = { wheel: 'steering', tilt: 'tilt', buttons: 'arrows' };

/** The keyboard's keys, as the legend shows them, and what they do (KeyboardInput). */
const KEYS: readonly (readonly [action: string, keys: readonly string[]])[] = [
  ['gas', ['↑', 'W']],
  ['brake', ['↓', 'S', 'Space']],
  ['steer', ['←', '→', 'A', 'D']],
  ['camera', ['C']],
  ['horn', ['H']],
  ['map', ['M']],
  ['pause', ['Esc', 'P']],
];

/**
 * How the truck is driven, set before a drive or during one (the main menu
 * and the pause menu open it): the way of steering, as three cards (the
 * wheel on the screen, turning the phone, or left and right buttons), how
 * sensitive tilt steering is, how big the controls are (with a picture of
 * the screen's controls at that size), the camera a drive starts with, and
 * the keyboard's keys where there is a keyboard. Each choice applies at
 * once and is kept on the device.
 */
export class ControlsDialog {
  private readonly overlay: HTMLDivElement;
  private readonly steeringCards: readonly HTMLButtonElement[];
  /** Keeps the steering cards' names whole: a name too long for its card is made smaller. */
  private readonly cardTitles: LabelFitter;
  private readonly tilt: ChoiceRow<TiltSensitivity>;
  private readonly size: ChoiceRow<ControlSize>;
  private readonly camera: ChoiceRow<CameraMode>;
  private readonly preview: HTMLDivElement;

  constructor(parent: HTMLElement, strings: Strings, shown: ControlsShown, keyboard: boolean, actions: ControlsActions) {
    const document = parent.ownerDocument;
    this.overlay = element(document, 'div', 'screen controls');
    this.overlay.dataset.screen = 'controls';
    this.overlay.hidden = true;
    const panel = element(document, 'div', 'panel controls__panel');

    // The ways of steering, each a card with its picture and a line on how it goes.
    const steering = element(document, 'div', 'settings__row controls__steering');
    steering.dataset.setting = 'steering';
    const cards = element(document, 'div', 'controls__cards');
    cards.setAttribute('role', 'radiogroup');
    cards.setAttribute('aria-label', strings.t('settings.steering'));
    const titles: HTMLElement[] = [];
    this.steeringCards = STEERING_MODES.map((mode) => {
      const card = button(document, 'controls__card', '', 'steering', () => {
        this.showSteering(mode);
        actions.onSteering(mode);
      });
      card.setAttribute('role', 'radio');
      card.dataset.steering = mode;
      const title = element(document, 'span', 'controls__card-title', strings.t(`settings.steering.${mode}`));
      titles.push(title);
      card.append(
        icon(document, STEERING_ICONS[mode], 'controls__card-icon'),
        title,
        element(document, 'span', 'controls__card-note', strings.t(`controls.steering.${mode}`)),
      );
      cards.append(card);
      return card;
    });
    steering.append(element(document, 'h3', 'settings__label', strings.t('settings.steering')), cards);
    this.cardTitles = new LabelFitter(cards, titles);

    this.tilt = choiceRow(
      document,
      strings.t('settings.tiltSensitivity'),
      'tilt-sensitivity',
      TILT_SENSITIVITIES,
      shown.tiltSensitivity,
      (sensitivity) => strings.t(`settings.tiltSensitivity.${sensitivity}`),
    );
    this.tilt.onPick(actions.onTiltSensitivity);
    this.tilt.row.dataset.setting = 'tilt-sensitivity';
    this.tilt.row.append(element(document, 'p', 'settings__note', strings.t('settings.tiltNote')));

    // The controls' size, and how the screen's controls look at it.
    this.size = choiceRow(document, strings.t('settings.controlSize'), 'control-size', CONTROL_SIZES, shown.controlSize, (choice) =>
      strings.t(`settings.controlSize.${choice}`),
    );
    this.size.row.dataset.setting = 'control-size';
    this.preview = element(document, 'div', 'controls__preview');
    this.preview.setAttribute('aria-hidden', 'true');
    this.preview.append(
      element(document, 'span', 'controls__preview-steer'),
      element(document, 'span', 'controls__preview-pedal controls__preview-pedal--brake'),
      element(document, 'span', 'controls__preview-pedal controls__preview-pedal--gas'),
    );
    this.size.row.append(this.preview);
    this.size.onPick((size) => {
      this.preview.dataset.size = size;
      actions.onControlSize(size);
    });

    this.camera = choiceRow(document, strings.t('controls.camera'), 'camera', CAMERA_MODES, shown.camera, (mode) =>
      strings.t(`controls.camera.${mode}`),
    );
    this.camera.row.dataset.setting = 'camera';
    this.camera.row.append(element(document, 'p', 'settings__note', strings.t('controls.cameraNote')));
    this.camera.onPick(actions.onCamera);

    const keys = element(document, 'div', 'settings__row controls__keys');
    keys.dataset.setting = 'keys';
    keys.hidden = !keyboard;
    const list = element(document, 'dl', 'controls__key-list');
    for (const [action, codes] of KEYS) {
      const caps = element(document, 'dt', 'controls__key-caps');
      caps.append(...codes.map((code) => element(document, 'kbd', 'controls__key', code)));
      list.append(caps, element(document, 'dd', 'controls__key-action', strings.t(`controls.key.${action}`)));
    }
    keys.append(element(document, 'h3', 'settings__label', strings.t('controls.keyboard')), list);

    panel.append(
      element(document, 'h2', 'panel__title', strings.t('controls.title')),
      steering,
      this.tilt.row,
      this.size.row,
      this.camera.row,
      keys,
      button(document, 'button--primary settings__close', strings.t('controls.done'), 'close-controls', actions.onClose),
    );
    this.overlay.append(panel);
    parent.append(this.overlay);
    this.show(shown);
  }

  get isOpen(): boolean {
    return !this.overlay.hidden;
  }

  open(): void {
    this.overlay.hidden = false;
    this.cardTitles.refit();
  }

  close(): void {
    this.overlay.hidden = true;
  }

  /**
   * Shows the controls as they are set now, without telling anyone: they
   * change elsewhere too (the camera button, tilt steering turning out
   * unavailable).
   */
  show(shown: ControlsShown): void {
    this.showSteering(shown.steering);
    this.tilt.pick(shown.tiltSensitivity);
    this.size.pick(shown.controlSize);
    this.preview.dataset.size = shown.controlSize;
    this.camera.pick(shown.camera);
  }

  dispose(): void {
    this.cardTitles.dispose();
    this.overlay.remove();
  }

  private showSteering(mode: SteeringMode): void {
    STEERING_MODES.forEach((candidate, index) => select(this.steeringCards[index]!, candidate === mode));
    this.tilt.row.hidden = mode !== 'tilt';
    this.preview.dataset.mode = mode;
  }
}
