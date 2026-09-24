import type { TutorialStep } from '../../domain/tutorial/tutorialSteps';
import { button, element, setText } from '../dom';
import type { Strings } from '../i18n';

/** Where a hint appears: in the company panel, or over the road. */
export type TutorialPlace = 'panel' | 'road';

/**
 * The tutorial's one short hint at a time (spec §41: few words, learnt by
 * playing), with a button to skip the tutorial. The control the hint is
 * about glows (styles.css, by `<html data-tutorial-step>`). In the company
 * panel the hint sits in `panelSlot`, above the list, so it never covers a
 * button; over the road it floats under the HUD. show() is cheap to call
 * every frame: it touches the DOM only when the hint changes.
 */
export class TutorialHint {
  private readonly root: HTMLDivElement;
  private readonly text: HTMLParagraphElement;
  private shown: TutorialStep | null = null;
  private place: TutorialPlace | null = null;

  constructor(
    private readonly parent: HTMLElement,
    private readonly panelSlot: HTMLElement,
    private readonly strings: Strings,
    onSkip: () => void,
  ) {
    const document = parent.ownerDocument;
    this.root = element(document, 'div', 'tutorial-hint');
    this.root.setAttribute('role', 'status');
    this.root.hidden = true;
    this.text = element(document, 'p', 'tutorial-hint__text');
    this.root.append(this.text, button(document, 'button--ghost tutorial-hint__skip', strings.t('tutorial.skip'), 'skip-tutorial', onSkip));
    parent.append(this.root);
  }

  /** Shows the hint for `step` at `place`, or hides it (null). */
  show(step: TutorialStep | null, place: TutorialPlace | null): void {
    if (step === this.shown && place === this.place) {
      return;
    }
    this.shown = step;
    this.place = place;
    this.root.hidden = step === null || step === 'done';
    // Out of the panel's slot while hidden, so the slot is empty and takes no room.
    const host = !this.root.hidden && place === 'panel' ? this.panelSlot : this.parent;
    if (this.root.parentElement !== host) {
      host.append(this.root);
    }
    if (!this.root.hidden) {
      setText(this.text, this.strings.t(`tutorial.${step}`));
      this.root.dataset.step = step!;
      this.root.classList.toggle('tutorial-hint--inline', place === 'panel');
    }
  }

  dispose(): void {
    this.root.remove();
  }
}

/**
 * Whether the hint for `step` shows at `place`. Taking a contract and buying
 * an upgrade are hinted on the road (the button that opens the panel glows)
 * and in the panel; the driving hints only on the road; none once the
 * tutorial is over.
 */
export function tutorialShows(step: TutorialStep, place: TutorialPlace): boolean {
  switch (step) {
    case 'takeContract':
    case 'buyUpgrade':
      return true;
    case 'driveToPickup':
    case 'deliver':
      return place === 'road';
    case 'done':
      return false;
  }
}
