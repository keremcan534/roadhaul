import { iconMarkup, type IconName } from './iconShapes';

export { cargoIcon, facilityIcon, upgradeIcon, type IconName } from './iconShapes';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * An icon as an `<svg>` element (iconShapes.ts): decorative (hidden from
 * screen readers), sized by CSS, in the text colour with its accent in
 * `--rh-icon-accent`. Inline SVG: nothing to download, sharp at any size.
 */
export function icon(document: Document, name: IconName, className = 'icon'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'currentColor');
  svg.innerHTML = iconMarkup(name);
  return svg;
}

/** Puts `name`'s icon before a button's label. Returns the button. */
export function withIcon<T extends HTMLElement>(node: T, name: IconName): T {
  node.prepend(icon(node.ownerDocument, name, 'button__icon'));
  node.classList.add('button--icon');
  return node;
}
