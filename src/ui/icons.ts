import type { CargoCategory } from '../data/definitions/CargoDefinition';
import type { UpgradeLook } from '../data/definitions/UpgradeDefinition';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Line icons drawn for RoadHaul (24×24, stroked in the text colour): the
 * company panel's pages, what the truck carries, its parts and the events'
 * terms. Inline SVG: nothing to download, sharp at any size.
 */
const ICONS = {
  // The panel's pages and tools.
  jobs: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M8.5 14l2.5 2.5 4.5-5"/>',
  truck: '<path d="M2 5h12v11H2z"/><path d="M14 9h4l4 4v3h-8z"/><circle cx="6" cy="18" r="2"/><circle cx="17.5" cy="18" r="2"/>',
  garage: '<path d="M3 21V9l9-6 9 6v12"/><path d="M7 21v-9h10v9"/><path d="M7 15h10M7 18h10"/>',
  events: '<path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9z"/>',
  fleet: '<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="2.5"/><path d="M2.8 10.5c3.1-.9 6.2-.9 9.2 0 3-.9 6.1-.9 9.2 0M9.8 13.4l-3.3 7M14.2 13.4l3.3 7"/>',
  // A cup: the league of the region's companies.
  rivals: '<path d="M7 3.5h10V9a5 5 0 0 1-10 0z"/><path d="M7 5.5H4a3 3 0 0 0 3.2 4.3M17 5.5h3a3 3 0 0 1-3.2 4.3M12 14v4M8.5 21h7M9.5 18h5"/>',
  // A pennant: a tender, raced for.
  flag: '<path d="M5.5 21.5v-18"/><path d="M5.5 4h12l-2.6 4.2 2.6 4.3h-12"/>',
  map: '<path d="M2 6v16l7-4 6 4 7-4V2l-7 4-6-4z"/><path d="M9 2v16M15 6v16"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  eye: '<path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/>',
  // Figures.
  coins: '<circle cx="9" cy="9" r="6"/><path d="M15.4 9.6a6 6 0 1 1-5.8 5.8"/><path d="M9 6.5v5"/>',
  reputation: '<path d="M12 21s-8-4.4-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6.6-8 11-8 11z"/>',
  pin: '<path d="M12 22s7-6.3 7-12a7 7 0 0 0-14 0c0 5.7 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>',
  route: '<circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="5" r="2.5"/><path d="M7.5 19H16a3.5 3.5 0 0 0 0-7H8a3.5 3.5 0 0 1 0-7h8.5"/>',
  clock: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2h5"/>',
  fuel: '<path d="M4 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16M3 21h13"/><path d="M7 7h5v4H7z"/><path d="M15 10h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V9l-3-3"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>',
  cargo: '<path d="M21 16V8l-9-5-9 5v8l9 5z"/><path d="M3.3 7.8L12 13l8.7-5.2M12 22.5V13"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 3h10v6a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  // The events' terms: fast, careful, heavy.
  express: '<circle cx="12" cy="13" r="8"/><path d="M12 13l3-3M9.5 2h5"/><path d="M19 4l1.5 1.5"/>',
  careful: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  heavy: '<path d="M8.5 8a3.5 3.5 0 1 1 7 0"/><path d="M5.5 9h13l2.5 12H3z"/>',
  // What the truck carries (cargo categories).
  food: '<path d="M12 7.5C9.8 5.6 5.2 6 4.4 10.3 3.6 14.6 6.4 20.5 9.4 20.5c1.2 0 1.6-.6 2.6-.6s1.4.6 2.6.6c3 0 5.8-5.9 5-10.2-.8-4.3-5.4-4.7-7.6-2.8z"/><path d="M12 7.5c0-2.2 1-4 3-5"/>',
  frozenFood: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7"/><path d="M9 3.5l3 2 3-2M9 20.5l3-2 3 2"/>',
  electronics: '<rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  furniture: '<path d="M5.5 11V7.5a3 3 0 0 1 3-3h7a3 3 0 0 1 3 3V11"/><path d="M3 11.5a2 2 0 0 1 4 0V14h10v-2.5a2 2 0 0 1 4 0V18H3z"/><path d="M5 18v2.5M19 18v2.5"/>',
  construction: '<path d="M2.5 5.5h19v13h-19z"/><path d="M2.5 12h19M8.5 5.5V12M15.5 5.5V12M12 12v6.5"/>',
  agriculture: '<path d="M12 22V9"/><path d="M12 13.5c-3 0-5-2-5-5 3 0 5 2 5 5zM12 13.5c3 0 5-2 5-5-3 0-5 2-5 5zM12 8c-1.8 0-3-1.6-3-4 1.8 0 3 1.6 3 4zM12 8c1.8 0 3-1.6 3-4-1.8 0-3 1.6-3 4z"/>',
  automotive: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  medical: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
  fragile: '<path d="M7.5 2.5h9L15.5 9a3.5 3.5 0 0 1-7 0z"/><path d="M12 12.5v8M8 21.5h8"/>',
  hazardous: '<path d="M10.3 3.9L1.8 18.5a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 17.5h.01"/>',
  oversized: '<path d="M3 7.5h18v11H3z"/><path d="M1 12h4M19 12h4M1 12l2-2M1 12l2 2M23 12l-2-2M23 12l-2 2"/>',
  // The truck's parts (upgrade looks).
  exhaust: '<path d="M4 21h9V9"/><path d="M13 9V4a1.5 1.5 0 0 1 3 0v5"/><path d="M13 9h3"/><path d="M18.5 5.5c1.5-1 2.5-.5 3-1.5M18.5 9c1.5-1 2.5-.5 3-1.5"/>',
  brakes: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.5"/><path d="M15.5 4.3a8.5 8.5 0 0 1 4.2 4.2" stroke-width="4"/>',
  wheels: '<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 7.5v-5M12 21.5v-5M7.5 12h-5M21.5 12h-5"/>',
  stance: '<path d="M5 3h14M5 21h14"/><path d="M12 3l-5 3 10 3-10 3 10 3-10 3 5 3"/>',
  fuelTank: '<path d="M6 3.5h8l4 4v12.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 20V5a1.5 1.5 0 0 1 1-1.5z"/><path d="M8.5 11l6 6M14.5 11l-6 6M8 3.5V2"/>',
} as const;

export type IconName = keyof typeof ICONS;

/** An icon as an `<svg>` element: decorative (hidden from screen readers), sized by CSS. */
export function icon(document: Document, name: IconName, className = 'icon'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = ICONS[name];
  return svg;
}

/** The icon of a cargo category (spec §11). */
export function cargoIcon(category: CargoCategory): IconName {
  return category;
}

/** The icon of a truck part an upgrade improves. */
export function upgradeIcon(look: UpgradeLook): IconName {
  return look;
}
