import { button, element } from '../dom';
import type { Strings } from '../i18n';

export interface PauseMenuActions {
  /** The pause button (or Escape) was pressed: the entry point pauses and calls open(). */
  readonly onPauseRequested: () => void;
  readonly onResume: () => void;
  readonly onRecover: () => void;
  readonly onRoadsideFuel: () => void;
  readonly onAbandon: () => void;
  readonly onCompanyHq: () => void;
}

/** The roadside fuel offer: its price, or free emergency fuel for a stranded, broke company. */
export type RoadsideFuelOffer = { readonly cost: string } | 'emergency' | null;

/**
 * The pause button shown while driving, and the menu it opens: resume, put a
 * stuck truck back on the road, abandon the contract, or go back to the HQ
 * (only without a contract, so a job is never dropped by accident).
 */
export class PauseMenu {
  private readonly pauseButton: HTMLButtonElement;
  private readonly overlay: HTMLDivElement;
  private readonly abandonButton: HTMLButtonElement;
  private readonly hqButton: HTMLButtonElement;
  private readonly fuelButton: HTMLButtonElement;

  constructor(
    parent: HTMLElement,
    private readonly strings: Strings,
    actions: PauseMenuActions,
  ) {
    const document = parent.ownerDocument;
    this.pauseButton = button(document, 'pause-button', '', 'pause', actions.onPauseRequested);
    this.pauseButton.setAttribute('aria-label', strings.t('pause.open'));
    this.pauseButton.hidden = true;

    this.overlay = element(document, 'div', 'screen pause-menu');
    this.overlay.dataset.screen = 'pause';
    this.overlay.hidden = true;
    const panel = element(document, 'div', 'panel pause-menu__panel');
    const closeThen = (action: () => void) => () => {
      this.close();
      action();
    };
    this.abandonButton = button(
      document,
      'button--danger',
      strings.t('pause.abandon'),
      'abandon',
      closeThen(actions.onAbandon),
    );
    this.hqButton = button(document, 'button--secondary', strings.t('pause.hq'), 'company-hq', closeThen(actions.onCompanyHq));
    this.fuelButton = button(document, 'button--secondary', '', 'roadside-fuel', closeThen(actions.onRoadsideFuel));
    panel.append(
      element(document, 'h2', 'panel__title', strings.t('pause.title')),
      button(document, 'button--primary', strings.t('pause.resume'), 'resume', closeThen(actions.onResume)),
      button(document, 'button--secondary', strings.t('pause.recover'), 'recover', closeThen(actions.onRecover)),
      this.fuelButton,
      this.abandonButton,
      this.hqButton,
    );
    this.overlay.append(panel);
    parent.append(this.pauseButton, this.overlay);
  }

  get isOpen(): boolean {
    return !this.overlay.hidden;
  }

  /** The pause button is offered while driving. */
  set buttonVisible(visible: boolean) {
    this.pauseButton.hidden = !visible;
  }

  /**
   * Shows the menu. With a contract running, it offers abandoning it instead
   * of going back to the HQ. `fuel` offers a fuel truck when the tank is not full.
   */
  open(hasContract: boolean, fuel: RoadsideFuelOffer): void {
    this.abandonButton.hidden = !hasContract;
    this.hqButton.hidden = hasContract;
    this.fuelButton.hidden = fuel === null;
    if (fuel !== null) {
      this.fuelButton.textContent =
        fuel === 'emergency' ? this.strings.t('pause.emergencyFuel') : this.strings.t('pause.roadsideFuel', fuel);
    }
    this.overlay.hidden = false;
  }

  close(): void {
    this.overlay.hidden = true;
  }

  dispose(): void {
    this.pauseButton.remove();
    this.overlay.remove();
  }
}
