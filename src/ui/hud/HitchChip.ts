import { element, setText } from '../dom';
import type { Strings } from '../i18n';
import { icon } from '../icons';

/** The distance is shown in steps of this many meters. */
const STEP_METERS = 50;

/**
 * Over the road's alerts, a hitchhiker's (HitchhikerService): one waiting
 * ahead and how far, or the rider's town and how far its depot is. Cheap
 * every frame: it touches the DOM only when what it shows changes.
 */
export class HitchChip {
  private readonly node: HTMLDivElement;
  private readonly label: HTMLSpanElement;
  private enabled = false;
  private shownStage = '';
  private shownCity = '';
  private shownMeters = -1;

  constructor(
    parent: HTMLElement,
    private readonly strings: Strings,
  ) {
    const document = parent.ownerDocument;
    this.node = element(document, 'div', 'hitch-chip');
    this.node.setAttribute('role', 'status');
    this.node.dataset.value = 'hitch';
    this.node.hidden = true;
    this.label = element(document, 'span', 'hitch-chip__label');
    this.node.append(icon(document, 'walk', 'hitch-chip__icon'), this.label);
    parent.append(this.node);
  }

  /** Off while not driving the truck. Cheap to set every frame. */
  set visible(visible: boolean) {
    if (visible !== this.enabled) {
      this.enabled = visible;
      this.node.hidden = !visible || this.shownStage === '' || this.shownStage === 'none';
    }
  }

  /** Someone waiting `meters` off, or riding to `cityName`, its depot `meters` off; or nobody (`stage` 'none'). */
  show(stage: 'none' | 'waiting' | 'riding', cityName: string, meters: number): void {
    const steps = Number.isFinite(meters) ? Math.round(meters / STEP_METERS) * STEP_METERS : -1;
    if (stage === this.shownStage && cityName === this.shownCity && steps === this.shownMeters) {
      return;
    }
    this.shownStage = stage;
    this.shownCity = cityName;
    this.shownMeters = steps;
    this.node.dataset.stage = stage;
    this.node.hidden = !this.enabled || stage === 'none';
    if (stage === 'none') {
      return;
    }
    const distance = this.strings.distance(Math.max(0, steps));
    setText(this.label, stage === 'waiting' ? this.strings.t('road.hitchWaiting', { distance }) : this.strings.t('road.hitchRiding', { city: cityName, distance }));
  }
}
