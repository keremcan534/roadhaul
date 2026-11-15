import { button } from '../dom';
import type { Strings } from '../i18n';
import { withIcon } from '../icons';

/** What the button reads (OnFootService). */
export interface OnFootSource {
  /** The driver is out of the truck. */
  readonly active: boolean;
  /** Out, and at the cab's door. */
  readonly nearDoor: boolean;
  /** In the cab, and the truck stands still: the driver could get out. */
  readonly mayStepOut: boolean;
}

/** What it shows: get out, get in, walk back to the door, or nothing. */
type Shown = 'out' | 'in' | 'walkBack' | '';

/** It looks again at most this often, seconds. */
const REFRESH_SECONDS = 0.15;

/**
 * Getting out of the truck and back in (OnFootService): a button by the
 * hazard lights' that offers "Get out" while the truck stands still, and
 * on foot "Get in", greyed until the driver is back at the cab's door.
 * Call update() every frame while driving: it touches the DOM only when
 * what it says changes.
 */
export class OnFootButton {
  private readonly root: HTMLButtonElement;
  private readonly label: HTMLSpanElement;
  private shown: Shown = '';
  private enabled = false;
  private sinceRefresh = REFRESH_SECONDS;

  constructor(
    parent: HTMLElement,
    private readonly strings: Strings,
    private readonly source: OnFootSource,
    onPress: () => void,
  ) {
    const document = parent.ownerDocument;
    this.root = withIcon(button(document, 'button--secondary on-foot-button', '', 'on-foot', onPress), 'walk');
    this.label = document.createElement('span');
    this.label.className = 'on-foot-button__label';
    this.root.append(this.label);
    this.root.hidden = true;
    parent.append(this.root);
  }

  /** Off while not driving (menus, pause, a race). Cheap to set every frame. */
  set visible(visible: boolean) {
    if (visible === this.enabled) {
      return;
    }
    this.enabled = visible;
    this.sinceRefresh = REFRESH_SECONDS;
    if (!visible) {
      this.show('');
    }
  }

  update(deltaSeconds: number): void {
    if (!this.enabled) {
      return;
    }
    this.sinceRefresh += deltaSeconds;
    if (this.sinceRefresh < REFRESH_SECONDS) {
      return;
    }
    this.sinceRefresh = 0;
    const source = this.source;
    this.show(source.active ? (source.nearDoor ? 'in' : 'walkBack') : source.mayStepOut ? 'out' : '');
  }

  private show(shown: Shown): void {
    if (shown === this.shown) {
      return;
    }
    this.shown = shown;
    this.root.hidden = shown === '';
    this.root.dataset.state = shown;
    this.root.disabled = shown === 'walkBack';
    if (shown !== '') {
      // Away from the door it still says what it will do, greyed until the driver is back there.
      this.label.textContent = this.strings.t(shown === 'out' ? 'onFoot.out' : 'onFoot.in');
    }
  }
}
