import { element } from '../dom';

export type ToastKind = 'info' | 'success' | 'warning';

/** How long a notice stays, seconds (it fades during the last part). */
const TOAST_SECONDS = 3.2;
/** At most this many notices at once; older ones make room. */
const MAX_TOASTS = 3;

interface Toast {
  readonly node: HTMLDivElement;
  secondsLeft: number;
}

/**
 * Short notices at the top of the screen: level-ups, an empty tank, not
 * enough credits. Timed by the frame loop (update), not by timers, so they
 * pause with the page.
 */
export class Toasts {
  private readonly root: HTMLDivElement;
  private readonly toasts: Toast[] = [];

  constructor(parent: HTMLElement) {
    this.root = element(parent.ownerDocument, 'div', 'toasts');
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-live', 'polite');
    parent.append(this.root);
  }

  show(text: string, kind: ToastKind = 'info'): void {
    const node = element(this.root.ownerDocument, 'div', `toast toast--${kind}`, text);
    this.root.append(node);
    this.toasts.push({ node, secondsLeft: TOAST_SECONDS });
    while (this.toasts.length > MAX_TOASTS) {
      this.toasts.shift()!.node.remove();
    }
  }

  /** Per frame: ages the notices. Does nothing (and allocates nothing) while none is shown. */
  update(deltaSeconds: number): void {
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      const toast = this.toasts[i]!;
      toast.secondsLeft -= deltaSeconds;
      if (toast.secondsLeft <= 0) {
        toast.node.remove();
        this.toasts.splice(i, 1);
      } else if (toast.secondsLeft < 0.5 && !toast.node.classList.contains('is-leaving')) {
        toast.node.classList.add('is-leaving');
      }
    }
  }

  clear(): void {
    for (const toast of this.toasts) {
      toast.node.remove();
    }
    this.toasts.length = 0;
  }

  dispose(): void {
    this.root.remove();
  }
}
