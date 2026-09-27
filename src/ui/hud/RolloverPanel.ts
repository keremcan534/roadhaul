import type { BodyAttitude } from '../../domain/vehicles/bodyMotion';
import { button, element } from '../dom';
import type { Strings } from '../i18n';

/**
 * The truck over slower than this (m/s: it has about stopped rolling and
 * sliding) offers to be put back on its wheels.
 */
export const RECOVER_OFFER_SPEED_METERS_PER_SECOND = 2;

export interface RolloverPanelActions {
  /** Put the truck back on its wheels, on the road (DrivingService.recover). */
  readonly onRecover: () => void;
}

/**
 * The truck's body in trouble, on the HUD (bodyMotion): a warning while it
 * is up on two wheels (ease off!), and once it has gone over and about come
 * to rest, a panel to put it back on its wheels on the road. Cheap every
 * frame: it touches the DOM only when what it shows changes.
 */
export class RolloverPanel {
  private readonly warning: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private enabled = false;
  private tipping = false;
  private offering = false;

  constructor(parent: HTMLElement, strings: Strings, actions: RolloverPanelActions) {
    const document = parent.ownerDocument;
    this.warning = element(document, 'div', 'rollover-warning', strings.t('rollover.tipping'));
    this.warning.setAttribute('role', 'alert');
    this.warning.hidden = true;
    this.panel = element(document, 'div', 'rollover-panel');
    this.panel.setAttribute('role', 'dialog');
    this.panel.hidden = true;
    this.panel.append(
      element(document, 'h2', 'rollover-panel__title', strings.t('rollover.title')),
      element(document, 'p', 'rollover-panel__note', strings.t('rollover.note')),
      button(document, 'button--primary rollover-panel__action', strings.t('rollover.recover'), 'recover-truck', actions.onRecover),
    );
    parent.append(this.warning, this.panel);
  }

  /** Whether the panel offering to put the truck back on its wheels is up. */
  get isOpen(): boolean {
    return !this.panel.hidden;
  }

  /** Off while not driving (menus, pause, the company panel). Cheap to set every frame: it acts only on a change. */
  set visible(visible: boolean) {
    if (visible === this.enabled) {
      return;
    }
    this.enabled = visible;
    this.show(false, false);
  }

  /** Shows what the truck's `attitude` and `speed` (m/s, its slide included) call for. Call every frame while driving. */
  update(attitude: BodyAttitude, speed: number): void {
    if (!this.enabled) {
      return;
    }
    this.show(
      attitude === 'tipping',
      attitude === 'overturned' && Math.abs(speed) < RECOVER_OFFER_SPEED_METERS_PER_SECOND,
    );
  }

  private show(tipping: boolean, offering: boolean): void {
    if (tipping !== this.tipping) {
      this.tipping = tipping;
      this.warning.hidden = !tipping;
    }
    if (offering !== this.offering) {
      this.offering = offering;
      this.panel.hidden = !offering;
    }
  }
}
