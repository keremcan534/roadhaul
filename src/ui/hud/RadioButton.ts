import type { RadioChoice } from '../../data/config/radio';
import { element } from '../dom';
import type { Strings } from '../i18n';
import { icon } from '../icons';

/**
 * The cab radio's button on the road, beside the camera button: a tap tunes
 * to the next station (off, then each station, then off); lit while one
 * plays. The entry point changes the station and names it in a toast.
 */
export class RadioButton {
  private readonly node: HTMLButtonElement;

  constructor(
    parent: HTMLElement,
    private readonly strings: Strings,
    onTune: () => void,
  ) {
    const document = parent.ownerDocument;
    this.node = element(document, 'button', 'radio-button');
    this.node.type = 'button';
    this.node.dataset.action = 'radio';
    this.node.hidden = true;
    this.node.append(icon(document, 'radio', 'radio-button__icon'));
    this.node.addEventListener('click', onTune);
    parent.append(this.node);
    this.show('off');
  }

  /** Shown on the road. Cheap to set every frame. */
  set visible(visible: boolean) {
    if (this.node.hidden === visible) {
      this.node.hidden = !visible;
    }
  }

  /** The station tuned to, or off. */
  show(choice: RadioChoice): void {
    this.node.dataset.station = choice;
    this.node.classList.toggle('is-on', choice !== 'off');
    const label = this.strings.t(choice === 'off' ? 'radio.off' : `radio.station.${choice}`);
    this.node.setAttribute('aria-label', `${this.strings.t('radio.title')}: ${label}`);
    this.node.title = label;
  }
}
