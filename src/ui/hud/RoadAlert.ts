import { element, setText } from '../dom';
import type { Strings } from '../i18n';
import { icon } from '../icons';

/** The distance to a camera is shown in steps of this many meters. */
const STEP_METERS = 50;

/**
 * Under the minimap, what the road asks of the driver just now
 * (RoadEventService): in road works, their limit; a speed camera (or works)
 * ahead, its limit and how far it is. A round limit sign beside a camera's
 * or a works' picture. Cheap every frame: it touches the DOM only when what
 * it shows changes.
 */
export class RoadAlert {
  private readonly node: HTMLDivElement;
  private readonly camera: SVGSVGElement;
  private readonly works: SVGSVGElement;
  private readonly limit: HTMLSpanElement;
  private readonly label: HTMLSpanElement;
  private enabled = false;
  /** What is shown: 'works', 'camera' or '' for nothing; the limit; the meters (in steps). */
  private shown = '';
  private shownLimit = -1;
  private shownMeters = -1;

  constructor(
    parent: HTMLElement,
    private readonly strings: Strings,
  ) {
    const document = parent.ownerDocument;
    this.node = element(document, 'div', 'road-alert');
    this.node.setAttribute('role', 'status');
    this.node.hidden = true;
    this.camera = icon(document, 'camera', 'road-alert__icon');
    this.works = icon(document, 'roadWorks', 'road-alert__icon');
    this.limit = element(document, 'span', 'road-alert__limit');
    this.label = element(document, 'span', 'road-alert__label');
    this.node.append(this.camera, this.works, this.limit, this.label);
    parent.append(this.node);
  }

  /** Off while not driving. Cheap to set every frame. */
  set visible(visible: boolean) {
    if (visible !== this.enabled) {
      this.enabled = visible;
      this.apply();
    }
  }

  /**
   * In road works at `worksLimitKmh` (0: not in any), or a camera ahead at
   * `aheadLimitKmh`, `aheadMeters` off (-1: none near), road works' if
   * `aheadIsWorks`. Cheap every frame.
   */
  show(worksLimitKmh: number, aheadLimitKmh: number, aheadMeters: number, aheadIsWorks: boolean): void {
    const what = worksLimitKmh > 0 ? 'works' : aheadMeters < 0 ? '' : aheadIsWorks ? 'worksAhead' : 'camera';
    const limit = what === 'works' ? worksLimitKmh : what === '' ? -1 : aheadLimitKmh;
    const meters = what === 'camera' || what === 'worksAhead' ? Math.max(STEP_METERS, Math.round(aheadMeters / STEP_METERS) * STEP_METERS) : -1;
    if (what === this.shown && limit === this.shownLimit && meters === this.shownMeters) {
      return;
    }
    this.shown = what;
    this.shownLimit = limit;
    this.shownMeters = meters;
    this.apply();
  }

  private apply(): void {
    const on = this.enabled && this.shown !== '';
    this.node.hidden = !on;
    if (!on) {
      return;
    }
    this.node.dataset.alert = this.shown;
    this.camera.style.display = this.shown === 'camera' ? '' : 'none';
    this.works.style.display = this.shown === 'camera' ? 'none' : '';
    setText(this.limit, this.strings.number(this.shownLimit));
    setText(this.label, this.shown === 'works' ? this.strings.t('road.works') : this.strings.distance(this.shownMeters));
  }
}
