import type { TutorialStep } from '../../domain/tutorial/tutorialSteps';
import { button, element, setText } from '../dom';
import type { Strings } from '../i18n';

/** Where a hint appears: over the HQ, or over the road while driving. */
export type TutorialPlace = 'companyHq' | 'driving';

/**
 * The tutorial's one short hint at a time (spec §41: few words, learnt by
 * playing), with a button to skip the tutorial. The control the hint is
 * about glows (styles.css, by `<html data-tutorial-step>`). In the HQ the
 * hint sits in `hqSlot`, above the list, so it never covers a button; over
 * the road it floats under the mission HUD. show() is cheap to call every
 * frame: it touches the DOM only when the hint changes.
 */
export class TutorialHint {
  private readonly root: HTMLDivElement;
  private readonly text: HTMLParagraphElement;
  private shown: TutorialStep | null = null;
  private place: TutorialPlace | null = null;

  constructor(
    private readonly parent: HTMLElement,
    private readonly hqSlot: HTMLElement,
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
    // Out of the HQ's slot while hidden, so the slot is empty and takes no room.
    const host = !this.root.hidden && place === 'companyHq' ? this.hqSlot : this.parent;
    if (this.root.parentElement !== host) {
      host.append(this.root);
    }
    if (!this.root.hidden) {
      setText(this.text, this.strings.t(`tutorial.${step}`));
      this.root.dataset.step = step!;
      this.root.classList.toggle('tutorial-hint--inline', place === 'companyHq');
    }
  }

  dispose(): void {
    this.root.remove();
  }
}

/** Where the hint for `step` belongs; null once the tutorial is over. */
export function tutorialPlace(step: TutorialStep): TutorialPlace | null {
  switch (step) {
    case 'takeContract':
    case 'buyUpgrade':
      return 'companyHq';
    case 'driveToPickup':
    case 'deliver':
      return 'driving';
    case 'done':
      return null;
  }
}
