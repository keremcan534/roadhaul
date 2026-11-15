import type { CrateTier } from '../../data/config/GameConfig';
import { button, element, setText } from '../dom';
import type { Strings } from '../i18n';
import { icon } from '../icons';

/** How a street race ended (RaceEnded). */
export interface RaceResult {
  readonly position: number | null;
  readonly of: number;
  readonly seconds: number;
  readonly crate: CrateTier | null;
}

/**
 * How a street race ended (RaceService's RaceEnded), over the road with the
 * truck back at the club: the place won (or given up), the time, and the
 * crate the podium earned; back to the truck.
 */
export class RaceResultDialog {
  private readonly overlay: HTMLDivElement;
  private readonly title: HTMLHeadingElement;
  private readonly time: HTMLParagraphElement;
  private readonly prize: HTMLParagraphElement;

  constructor(parent: HTMLElement, private readonly strings: Strings, onClose: () => void) {
    const document = parent.ownerDocument;
    this.overlay = element(document, 'div', 'screen race-result');
    this.overlay.dataset.screen = 'raceResult';
    this.overlay.hidden = true;
    const panel = element(document, 'div', 'panel race-result__panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-labelledby', 'race-result-title');
    this.title = element(document, 'h2', 'panel__title race-result__title');
    this.title.id = 'race-result-title';
    this.time = element(document, 'p', 'race-result__time');
    this.prize = element(document, 'p', 'race-result__prize');
    const back = button(document, 'button--primary', strings.t('race.result.back'), 'race-result-close', onClose);
    panel.append(icon(document, 'flag', 'race-result__icon'), this.title, this.time, this.prize, back);
    this.overlay.append(panel);
    parent.append(this.overlay);
  }

  get isOpen(): boolean {
    return !this.overlay.hidden;
  }

  open(result: RaceResult): void {
    const { strings } = this;
    this.overlay.dataset.position = result.position === null ? 'none' : String(result.position);
    setText(
      this.title,
      result.position === null
        ? strings.t('race.result.gaveUp')
        : result.position === 1
          ? strings.t('race.result.won')
          : strings.t('race.result.place', { position: result.position, of: result.of }),
    );
    this.time.hidden = result.position === null;
    setText(this.time, strings.t('race.result.time', { time: `${strings.duration(Math.floor(result.seconds))}.${Math.floor((result.seconds % 1) * 10)}` }));
    setText(
      this.prize,
      result.crate !== null
        ? strings.t('race.result.crate', { crate: strings.t(`crate.name.${result.crate}`) })
        : result.position === null
          ? ''
          : strings.t('race.result.noCrate'),
    );
    this.prize.hidden = result.position === null;
    this.overlay.hidden = false;
  }

  close(): void {
    this.overlay.hidden = true;
  }
}
