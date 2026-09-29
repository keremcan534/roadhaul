import { element } from '../dom';
import type { Strings } from '../i18n';

/**
 * A note over the game while its graphics are rebuilt: the phone took the
 * GPU back (the WebGL context was lost) and three.js rebuilds everything once
 * it is returned. The drive waits, paused, underneath.
 */
export class GraphicsNotice {
  private readonly node: HTMLDivElement;

  constructor(parent: HTMLElement, strings: Strings) {
    const document = parent.ownerDocument;
    this.node = element(document, 'div', 'graphics-notice');
    this.node.setAttribute('role', 'status');
    this.node.hidden = true;
    this.node.append(element(document, 'div', 'graphics-notice__bar'), element(document, 'p', 'graphics-notice__text', strings.t('graphics.restoring')));
    parent.append(this.node);
  }

  set visible(visible: boolean) {
    this.node.hidden = !visible;
  }

  get visible(): boolean {
    return !this.node.hidden;
  }
}
