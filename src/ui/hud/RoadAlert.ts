import { element, setText } from '../dom';
import type { Strings } from '../i18n';
import { icon } from '../icons';

/** The distance to a camera or a convoy is shown in steps of this many meters. */
const STEP_METERS = 50;

type Shown = '' | 'works' | 'worksAhead' | 'camera' | 'convoy' | 'riding';

/**
 * Over the speedometer, what the road asks of the driver just now
 * (RoadEventService), else the convoy near (ConvoyService): in road works,
 * their limit; a speed camera or works ahead, its limit and how far it is,
 * a round limit sign beside its picture; a convoy, how far it is, or how far
 * the truck has ridden with it. Cheap every frame: it touches the DOM only
 * when what it shows changes.
 */
export class RoadAlert {
  private readonly node: HTMLDivElement;
  private readonly camera: SVGSVGElement;
  private readonly works: SVGSVGElement;
  private readonly truck: SVGSVGElement;
  private readonly limit: HTMLSpanElement;
  private readonly label: HTMLSpanElement;
  private enabled = false;
  // What the road asks: works, works ahead or a camera; its limit and meters (in steps).
  private road: Shown = '';
  private roadLimit = -1;
  private roadMeters = -1;
  // The convoy: near or ridden with, and the meters (in steps).
  private convoy: Shown = '';
  private convoyMeters = -1;
  /** What is on show, to touch the DOM only on a change (no string built per frame). */
  private shownWhat: Shown | null = null;
  private shownLimit = -1;
  private shownMeters = -1;
  private shownEnabled = false;

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
    this.truck = icon(document, 'truck', 'road-alert__icon');
    this.limit = element(document, 'span', 'road-alert__limit');
    this.label = element(document, 'span', 'road-alert__label');
    this.node.append(this.camera, this.works, this.truck, this.limit, this.label);
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
    this.road = worksLimitKmh > 0 ? 'works' : aheadMeters < 0 ? '' : aheadIsWorks ? 'worksAhead' : 'camera';
    this.roadLimit = this.road === 'works' ? worksLimitKmh : this.road === '' ? -1 : aheadLimitKmh;
    this.roadMeters = this.road === 'camera' || this.road === 'worksAhead' ? steps(aheadMeters) : -1;
    this.apply();
  }

  /** A convoy on the road (`active`): ridden with (`riding`, `meters` so far), or `meters` off. Cheap every frame. */
  showConvoy(active: boolean, riding: boolean, meters: number): void {
    this.convoy = !active ? '' : riding ? 'riding' : 'convoy';
    this.convoyMeters = active && Number.isFinite(meters) ? steps(meters) : -1;
    this.apply();
  }

  private apply(): void {
    // The road's limits first: a convoy waits behind them.
    const what = this.road !== '' ? this.road : this.convoy;
    const limit = this.road !== '' ? this.roadLimit : -1;
    const meters = this.road !== '' ? this.roadMeters : this.convoyMeters;
    if (what === this.shownWhat && limit === this.shownLimit && meters === this.shownMeters && this.enabled === this.shownEnabled) {
      return;
    }
    this.shownWhat = what;
    this.shownLimit = limit;
    this.shownMeters = meters;
    this.shownEnabled = this.enabled;
    const on = this.enabled && what !== '';
    this.node.hidden = !on;
    if (!on) {
      return;
    }
    this.node.dataset.alert = what;
    this.camera.style.display = what === 'camera' ? '' : 'none';
    this.works.style.display = what === 'works' || what === 'worksAhead' ? '' : 'none';
    this.truck.style.display = what === 'convoy' || what === 'riding' ? '' : 'none';
    this.limit.hidden = limit < 0;
    setText(this.limit, limit < 0 ? '' : this.strings.number(limit));
    const distance = meters < 0 ? '' : this.strings.distance(meters);
    setText(
      this.label,
      what === 'works'
        ? this.strings.t('road.works')
        : what === 'convoy'
          ? this.strings.t('road.convoyNear', { distance })
          : what === 'riding'
            ? this.strings.t('road.convoyRiding', { distance })
            : distance,
    );
  }
}

/** Meters in steps of STEP_METERS, at least one step. */
function steps(meters: number): number {
  return Math.max(STEP_METERS, Math.round(meters / STEP_METERS) * STEP_METERS);
}
