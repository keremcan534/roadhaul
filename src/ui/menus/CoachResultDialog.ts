import type { Credits } from '../../data/units';
import { button, element, setText } from '../dom';
import type { Strings } from '../i18n';
import { icon } from '../icons';

/** How a run of a coach line ended (CoachLineEnded). */
export interface CoachResult {
  /** Through the towns, or round the town and back. */
  readonly kind: 'intercity' | 'city';
  readonly finished: boolean;
  readonly stopsServed: number;
  readonly stops: number;
  readonly onTimeStops: number;
  readonly comfort: number;
  readonly passengers: number;
  readonly fares: Credits;
  readonly onTimeBonus: Credits;
  readonly comfortBonus: Credits;
  readonly total: Credits;
  readonly xp: number;
  readonly stars: 0 | 1 | 2 | 3;
}

/**
 * How a run of a coach line ended (CoachLineService's CoachLineEnded), over
 * the road with the truck back at the station: its stars, the people
 * carried, the stops on time and the comfort, and what it paid (the fares,
 * a bonus for the timetable, one for comfort); back to the truck.
 */
export class CoachResultDialog {
  private readonly overlay: HTMLDivElement;
  private readonly stars: HTMLParagraphElement;
  private readonly title: HTMLHeadingElement;
  private readonly lines: HTMLUListElement;
  private readonly total: HTMLParagraphElement;

  constructor(
    parent: HTMLElement,
    private readonly strings: Strings,
    onClose: () => void,
  ) {
    const document = parent.ownerDocument;
    this.overlay = element(document, 'div', 'screen coach-result');
    this.overlay.dataset.screen = 'coachResult';
    this.overlay.hidden = true;
    const panel = element(document, 'div', 'panel coach-result__panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-labelledby', 'coach-result-title');
    this.stars = element(document, 'p', 'coach-result__stars');
    this.stars.dataset.value = 'coach-stars';
    this.title = element(document, 'h2', 'panel__title coach-result__title');
    this.title.id = 'coach-result-title';
    this.lines = element(document, 'ul', 'coach-result__lines');
    this.total = element(document, 'p', 'coach-result__total');
    this.total.dataset.value = 'coach-total';
    const back = button(document, 'button--primary', strings.t('coach.result.back'), 'coach-result-close', onClose);
    panel.append(icon(document, 'route', 'coach-result__icon'), this.stars, this.title, this.lines, this.total, back);
    this.overlay.append(panel);
    parent.append(this.overlay);
  }

  get isOpen(): boolean {
    return !this.overlay.hidden;
  }

  open(result: CoachResult): void {
    const { strings } = this;
    const document = this.overlay.ownerDocument;
    this.overlay.dataset.finished = String(result.finished);
    this.stars.hidden = !result.finished;
    setText(this.stars, '★'.repeat(result.stars) + '☆'.repeat(3 - result.stars));
    this.stars.setAttribute('aria-label', strings.t('coach.result.stars', { stars: result.stars }));
    setText(this.title, strings.t(!result.finished ? 'coach.result.gaveUp' : result.kind === 'city' ? 'coach.result.cityDone' : 'coach.result.done'));
    const line = (text: string, amount: Credits | null): HTMLLIElement => {
      const item = element(document, 'li', 'coach-result__line');
      item.append(element(document, 'span', 'coach-result__what', text));
      if (amount !== null) {
        item.append(element(document, 'span', 'coach-result__amount', strings.money(amount)));
      }
      return item;
    };
    const items = [line(strings.t('coach.result.fares', { count: result.passengers }), result.fares)];
    if (result.finished) {
      items.push(
        line(strings.t('coach.result.onTime', { count: result.onTimeStops, of: result.stops }), result.onTimeBonus),
        line(strings.t('coach.result.comfort', { comfort: result.comfort }), result.comfortBonus),
      );
    } else {
      items.push(line(strings.t('coach.result.served', { count: result.stopsServed, of: result.stops }), null));
    }
    this.lines.replaceChildren(...items);
    setText(this.total, strings.t('coach.result.total', { credits: strings.money(result.total), xp: result.xp }));
    this.overlay.hidden = false;
  }

  close(): void {
    this.overlay.hidden = true;
  }
}
