import { element } from '../dom';
import type { Strings } from '../i18n';

/** How the crossing is shown: casting off (before the game starts again), or coming into port (while it starts). */
export type FerryCrossingStage = 'departing' | 'arriving';

const SVG = 'http://www.w3.org/2000/svg';
/** It fades out over this long once the region is ready, ms (as its CSS transition). */
const FADE_MS = 450;
/** Coming into port, it goes after this long whatever happens, ms. */
const GIVE_UP_MS = 40_000;

/**
 * The ferry crossing between regions, over the whole screen: the boat
 * riding the swell across the sea, the region it crosses to and what is
 * happening (casting off, coming into port). Shown as the company boards,
 * while the game starts again (FERRY_BOARDING_MS), and on the other side
 * from the first moment until the region is built, over the boot screen.
 * Its motion is CSS transforms, run off the main thread, so it keeps
 * moving while the world is built.
 */
export class FerryCrossing {
  private readonly root: HTMLDivElement;

  constructor(document: Document, strings: Strings, stage: FerryCrossingStage, regionName: string) {
    this.root = element(document, 'div', `ferry-crossing ferry-crossing--${stage}`);
    this.root.setAttribute('role', 'status');
    this.root.dataset.stage = stage;
    const scene = element(document, 'div', 'ferry-crossing__scene');
    scene.setAttribute('aria-hidden', 'true');
    const boat = element(document, 'div', 'ferry-crossing__boat');
    boat.append(ferrySvg(document));
    scene.append(element(document, 'div', 'ferry-crossing__waves ferry-crossing__waves--far'), boat, element(document, 'div', 'ferry-crossing__waves'));
    this.root.append(
      scene,
      element(document, 'p', 'ferry-crossing__title', strings.t('ferry.title', { region: regionName })),
      element(document, 'p', 'ferry-crossing__note', strings.t(`ferry.crossing.${stage}`, { region: regionName })),
    );
    document.body.append(this.root);
    if (stage === 'arriving') {
      // Should the game not start (an error screen under it), it does not stay over it.
      document.defaultView?.setTimeout(() => this.hide(), GIVE_UP_MS);
    }
  }

  /** Fades away and is gone: the region is ready. */
  hide(): void {
    this.root.classList.add('is-leaving');
    this.root.ownerDocument.defaultView?.setTimeout(() => this.root.remove(), FADE_MS);
  }
}

/** A side view of a small car ferry: a red hull, a white deck house with windows, a funnel. */
function ferrySvg(document: Document): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 120 60');
  const shapes: readonly (readonly [string, Readonly<Record<string, string>>])[] = [
    ['path', { d: 'M4 34h112l-12 18H16z', fill: '#c4372d' }],
    ['rect', { x: '6', y: '30', width: '108', height: '5', fill: '#f2f4f6' }],
    ['rect', { x: '26', y: '16', width: '62', height: '14', rx: '2', fill: '#f2f4f6' }],
    ['rect', { x: '40', y: '7', width: '30', height: '10', rx: '2', fill: '#e6e9ec' }],
    ['rect', { x: '74', y: '2', width: '8', height: '14', fill: '#f2a33a' }],
    ['path', { d: 'M31 20h52v5H31z', fill: '#1f3a4d' }],
    ['path', { d: 'M44 10h22v4H44z', fill: '#1f3a4d' }],
  ];
  for (const [tag, attributes] of shapes) {
    const shape = document.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attributes)) {
      shape.setAttribute(name, value);
    }
    svg.append(shape);
  }
  return svg;
}
