const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * RoadHaul's mark, 100 units square: an R whose leg is a road running
 * toward the viewer, its centre line dashed. Original art (spec §85);
 * scripts/androidIcons.mjs draws the same shapes for the launcher icon.
 */
const MARK_INK =
  'M18 12a2 2 0 0 1 2-2h20v80H20a2 2 0 0 1-2-2zM40 10h16a24 24 0 0 1 0 48H40V43h14a9 9 0 0 0 0-18H40zM42.5 58H65l31 32H44.5z';
const MARK_DASHES = 'M53.99 60.5h2.1l2.58 4.5h-2.63zM57.87 69h3.11L65 76h-3.94zM63.12 80.5h4.47l5.46 9.5h-5.6z';

/** The wordmark's letters, heavy and square-shouldered, 40 units tall: ROAD, then HAUL. */
const WORD_ROAD = [
  [0, 'M0 0h21a12 12 0 0 1 4.6 23.1L34 40H22.2l-7.1-15.4H11V40H0zm11 9.4v6.2h9a3.1 3.1 0 0 0 0-6.2z'],
  [38.5, 'M13 0h10a13 13 0 0 1 13 13v14a13 13 0 0 1-13 13H13A13 13 0 0 1 0 27V13A13 13 0 0 1 13 0zm1 10a3 3 0 0 0-3 3v14a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3V13a3 3 0 0 0-3-3z'],
  [79, 'M11.2 0h13.6L36 40H24.4l-1.7-6.4h-9.4L11.6 40H0zm4.4 23.8h4.8L18 14.2z'],
  [119.5, 'M0 0h21a14 14 0 0 1 14 14v12a14 14 0 0 1-14 14H0zm11 10v20h8.5a4.5 4.5 0 0 0 4.5-4.5v-11a4.5 4.5 0 0 0-4.5-4.5z'],
] as const;
const WORD_HAUL = [
  [159, 'M0 0h11v14.6h13V0h11v40H24V24.8H11V40H0z'],
  [198.5, 'M11.2 0h13.6L36 40H24.4l-1.7-6.4h-9.4L11.6 40H0zm4.4 23.8h4.8L18 14.2z'],
  [239, 'M0 0h11v25.5a3.5 3.5 0 0 0 3.5 3.5h6a3.5 3.5 0 0 0 3.5-3.5V0h11v26a14 14 0 0 1-14 14h-7A14 14 0 0 1 0 26z'],
  [278.5, 'M0 0h11v30h19v10H0z'],
] as const;
const WORD_WIDTH = 308.5;

function letters(word: readonly (readonly [number, string])[]): string {
  return word.map(([x, d]) => `<path transform="translate(${x} 0)" d="${d}"/>`).join('');
}

function drawing(document: Document, className: string, viewBox: string, markup: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = markup;
  return svg;
}

/** The mark: in the text colour, its dashes amber (or `--rh-brand-dash`). Decorative; sized by CSS. */
export function brandMark(document: Document, className = 'brand-mark'): SVGSVGElement {
  return drawing(
    document,
    className,
    '0 0 100 100',
    `<path fill="currentColor" d="${MARK_INK}"/><path style="fill:var(--rh-brand-dash,#f2a33a)" d="${MARK_DASHES}"/>`,
  );
}

/** The wordmark: ROAD in the text colour, HAUL in amber. Decorative; sized by CSS. */
export function brandWordmark(document: Document, className = 'brand-wordmark'): SVGSVGElement {
  return drawing(
    document,
    className,
    `-1 -1 ${WORD_WIDTH + 2} 42`,
    `<g fill="currentColor">${letters(WORD_ROAD)}</g><g style="fill:var(--rh-accent,#f2a33a)">${letters(WORD_HAUL)}</g>`,
  );
}
