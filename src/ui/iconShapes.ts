import type { CargoCategory } from '../data/definitions/CargoDefinition';
import type { FacilityEffect } from '../data/definitions/FacilityDefinition';
import type { UpgradeLook } from '../data/definitions/UpgradeDefinition';

/**
 * The accent's parts: amber, or the colour a parent sets `--rh-icon-accent`
 * to (a selected button's own ink, say).
 */
const ACCENT = 'style="fill:var(--rh-icon-accent,#f2a33a)"';
/** Cut-outs: a shape's inner outlines are holes. */
const HOLES = 'fill-rule="evenodd"';

/** A stroked part, `width` units wide, in the glyph's ink or the accent's. */
function line(width: number): string {
  return `fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`;
}
function accentLine(width: number): string {
  return `fill="none" style="stroke:var(--rh-icon-accent,#f2a33a)" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`;
}

/**
 * RoadHaul's icons (24×24), after the brand sheet: solid glyphs in the text
 * colour with an amber accent, chunky enough to read at 18 px on a phone.
 * The company panel's pages, what the truck carries, its parts, the
 * events' terms and the menus. The shapes as SVG markup, apart from the
 * DOM (icons.ts draws them).
 */
const ICONS = {
  // The panel's pages and tools.
  jobs: `<path ${HOLES} d="M9 2.2h6a1 1 0 0 1 1 1V5H8V3.2a1 1 0 0 1 1-1zM6.2 4H7v2.4h10V4h.8A2.2 2.2 0 0 1 20 6.2v13.6a2.2 2.2 0 0 1-2.2 2.2H6.2A2.2 2.2 0 0 1 4 19.8V6.2A2.2 2.2 0 0 1 6.2 4zM7.5 9.8v1.9h9V9.8zm0 3.7v1.9h9v-1.9zm0 3.7v1.9h6v-1.9z"/>`,
  truck: `<path d="M1.5 5.2a1 1 0 0 1 1-1h11.3a1 1 0 0 1 1 1v9.3H1.5z"/><path d="M16 7.6h3.9a1 1 0 0 1 .8.4l2.1 2.9a1 1 0 0 1 .2.6v3H16z"/><path ${ACCENT} d="M17.3 8.9h2.4l1.5 2.1h-3.9z"/><path ${HOLES} d="M3.4 17.6a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0 -5.2 0ZM5.05 17.6a0.95 0.95 0 1 0 1.9 0a0.95 0.95 0 1 0 -1.9 0Z"/><path ${HOLES} d="M16 17.6a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0 -5.2 0ZM17.65 17.6a0.95 0.95 0 1 0 1.9 0a0.95 0.95 0 1 0 -1.9 0Z"/>`,
  garage: `<path ${HOLES} d="M1.8 9.6L12 2.6l10.2 7V21a.8.8 0 0 1-.8.8H2.6a.8.8 0 0 1-.8-.8zM5.8 11v10.8h12.4V11z"/><rect x="7.3" y="12.4" width="9.4" height="1.9" rx=".4"/><rect x="7.3" y="15.4" width="9.4" height="1.9" rx=".4"/><rect ${ACCENT} x="7.3" y="18.4" width="9.4" height="1.9" rx=".4"/>`,
  events: `<path d="M12 2.2L14.7 8.88L21.89 9.39L16.37 14.02L18.11 21.01L12 17.2L5.89 21.01L7.63 14.02L2.11 9.39L9.3 8.88Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>`,
  fleet: `<circle cx="12" cy="6.4" r="3.4"/><path d="M5.6 20.5v-2.3a4.6 4.6 0 0 1 4.6-4.6h3.6a4.6 4.6 0 0 1 4.6 4.6v2.3a.8.8 0 0 1-.8.8H6.4a.8.8 0 0 1-.8-.8z"/><circle cx="4.6" cy="9.2" r="2.4"/><path d="M.8 18.6v-1.4a3.4 3.4 0 0 1 3.4-3.4h1.9a6.6 6.6 0 0 0-1.9 4.6v.9H1.5a.7.7 0 0 1-.7-.7z"/><circle cx="19.4" cy="9.2" r="2.4"/><path d="M23.2 18.6v-1.4a3.4 3.4 0 0 0-3.4-3.4h-1.9a6.6 6.6 0 0 1 1.9 4.6v.9h2.7a.7.7 0 0 0 .7-.7z"/>`,
  // A cup: the league of the region's companies.
  rivals: `<path d="M6.5 2.5h11V9a5.5 5.5 0 0 1-11 0z"/><path d="M6.4 4.4H3.2a.8.8 0 0 0-.8.8v1.3a4.4 4.4 0 0 0 4.7 4.4M17.6 4.4h3.2a.8.8 0 0 1 .8.8v1.3a4.4 4.4 0 0 1-4.7 4.4" ${line(1.9)}/><path d="M10.6 14.2h2.8v3.6h-2.8z"/><path ${ACCENT} d="M7 18.6h10a.8.8 0 0 1 .8.8v1.8a.8.8 0 0 1-.8.8H7a.8.8 0 0 1-.8-.8v-1.8a.8.8 0 0 1 .8-.8z"/>`,
  // The head office, where the company builds its facilities: a block of offices, its door lit.
  office: `<path ${HOLES} d="M4 3.2A1.2 1.2 0 0 1 5.2 2h9.6A1.2 1.2 0 0 1 16 3.2V22H4zM6.6 4.8v2.4h2.2V4.8zm4.6 0v2.4h2.2V4.8zM6.6 9.2v2.4h2.2V9.2zm4.6 0v2.4h2.2V9.2zm-4.6 4.4V16h2.2v-2.4zm4.6 0V16h2.2v-2.4z"/><path d="M17.4 8.4h2.4a1.2 1.2 0 0 1 1.2 1.2V22h-3.6z"/><path ${ACCENT} d="M8.4 18h3.2v4H8.4z"/>`,
  // A loudhailer: the company making itself known (the marketing office).
  megaphone: `<path d="M3 9.4A1.4 1.4 0 0 1 4.4 8H7l8.6-4.6a.8.8 0 0 1 1.2.7v15.8a.8.8 0 0 1-1.2.7L7 16H4.4A1.4 1.4 0 0 1 3 14.6z"/><path d="M7.4 16.6l1.4 4.2a1 1 0 0 0 1 .7h1.4a.7.7 0 0 0 .7-.9l-1.2-4z"/><path d="M19.4 8.6a4.6 4.6 0 0 1 0 6.8" ${accentLine(2)}/>`,
  // A mortarboard: learning the trade (the training centre).
  school: `<path d="M12 3.4l10.4 5-10.4 5-10.4-5z"/><path d="M6 11.6v4.6c0 1.6 2.7 3.2 6 3.2s6-1.6 6-3.2v-4.6l-6 2.9z"/><path d="M20.6 9.4v6.2" ${accentLine(1.6)}/><circle ${ACCENT} cx="20.6" cy="16.6" r="1.4"/>`,
  // A pennant: a tender, raced for.
  flag: `<rect x="3.6" y="2" width="2.3" height="20" rx="1.1"/><path ${ACCENT} d="M7.4 3.4h12.3a.6.6 0 0 1 .5.9l-2.6 4.2 2.6 4.2a.6.6 0 0 1-.5.9H7.4z"/>`,
  map: `<path d="M2 6.3a.8.8 0 0 1 .5-.7l5.6-2.4v15.4l-5 2.1a.8.8 0 0 1-1.1-.7z"/><path d="M9.6 3.2l4.8 2.4v15.2l-4.8-2.4z"/><path ${ACCENT} d="M15.9 5.6l5-2.1a.8.8 0 0 1 1.1.7v13.5a.8.8 0 0 1-.5.7l-5.6 2.4z"/>`,
  close: `<path d="M6 6l12 12M18 6L6 18" ${line(3)}/>`,
  eye: `<path ${HOLES} d="M12 4.5c5.6 0 9.4 4.4 10.7 6.7a1.6 1.6 0 0 1 0 1.6C21.4 15.1 17.6 19.5 12 19.5S2.6 15.1 1.3 12.8a1.6 1.6 0 0 1 0-1.6C2.6 8.9 6.4 4.5 12 4.5zm0 3.6a3.9 3.9 0 1 0 0 7.8 3.9 3.9 0 0 0 0-7.8z"/><circle ${ACCENT} cx="12" cy="12" r="1.9"/>`,
  // Figures.
  coins: `<ellipse cx="12" cy="5.4" rx="7.6" ry="3"/><path ${ACCENT} d="M12 3.9l1.5 1.5-1.5 1.5-1.5-1.5z"/><path d="M4.4 8.4c1.4 1.4 4.3 2.2 7.6 2.2s6.2-.8 7.6-2.2v2.2c0 1.7-3.4 3-7.6 3s-7.6-1.3-7.6-3z"/><path d="M4.4 13c1.4 1.4 4.3 2.2 7.6 2.2s6.2-.8 7.6-2.2v2.2c0 1.7-3.4 3-7.6 3s-7.6-1.3-7.6-3z"/><path d="M4.4 17.6c1.4 1.4 4.3 2.2 7.6 2.2s6.2-.8 7.6-2.2v1.4c0 1.7-3.4 3-7.6 3s-7.6-1.3-7.6-3z"/>`,
  reputation: `<path d="M12 21.2S2.4 15.9 2.4 9A5.1 5.1 0 0 1 12 6.4 5.1 5.1 0 0 1 21.6 9c0 6.9-9.6 12.2-9.6 12.2z"/>`,
  pin: `<path ${HOLES} d="M12 1.8a7.6 7.6 0 0 1 7.6 7.6c0 5.4-6.1 11.2-7 12.1a.9.9 0 0 1-1.2 0c-.9-.9-7-6.7-7-12.1A7.6 7.6 0 0 1 12 1.8zm0 4.6a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>`,
  route: `<path ${HOLES} d="M6 11.2a4.2 4.2 0 0 1 4.2 4.2c0 3-3.3 6-3.8 6.5a.6.6 0 0 1-.8 0c-.5-.5-3.8-3.5-3.8-6.5A4.2 4.2 0 0 1 6 11.2zm0 2.6a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z"/><path d="M9.8 19.2h3.4a2.4 2.4 0 0 0 2.4-2.4v-2.6a2.4 2.4 0 0 1 2.4-2.4h1" ${accentLine(2.2)}/><path ${ACCENT} ${HOLES} d="M18.6 1.8a3.9 3.9 0 0 1 3.9 3.9c0 2.7-3 5.5-3.5 6a.6.6 0 0 1-.8 0c-.5-.5-3.5-3.3-3.5-6a3.9 3.9 0 0 1 3.9-3.9zm0 2.4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/>`,
  clock: `<path d="M8.56 3.7L15.44 3.7L20.3 8.56L20.3 15.44L15.44 20.3L8.56 20.3L3.7 15.44L3.7 8.56Z" ${line(2.6)}/><path d="M12 7.6V12l3.1 2.4" ${line(2.4)}/>`,
  fuel: `<path ${HOLES} d="M5.8 2.5h7.4A1.8 1.8 0 0 1 15 4.3V20H4V4.3a1.8 1.8 0 0 1 1.8-1.8z"/><rect ${ACCENT} x="6.2" y="5" width="6.6" height="4.4" rx=".7"/><rect x="2.8" y="19.4" width="13.4" height="2.4" rx=".8"/><path d="M15 9.8h1.6a1.4 1.4 0 0 1 1.4 1.4v5.2a1.6 1.6 0 0 0 3.2 0V8.7l-2.6-2.9" ${line(1.9)}/>`,
  wrench: `<path d="M21.6 6.8a5.7 5.7 0 0 1-7.7 5.4l-7.4 7.5a2.4 2.4 0 0 1-3.4-3.4l7.5-7.4a5.7 5.7 0 0 1 5.4-7.7c.5 0 1 .1 1.5.2l-3.1 3.1.5 3 3 .5 3.1-3.1c.1.5.2 1 .2 1.5z"/>`,
  cargo: `<path d="M12 2.2l9.2 4.6-9.2 4.6-9.2-4.6z"/><path d="M2.4 8.5l8.8 4.4v9.4l-8.2-4.1a1 1 0 0 1-.6-.9z"/><path d="M21.6 8.5l-8.8 4.4v9.4l8.2-4.1a1 1 0 0 0 .6-.9z"/><path ${ACCENT} d="M6.2 4.3l9.2 4.6-2.8 1.4-9.2-4.6z"/><path ${ACCENT} d="M15.4 10.6l2.8-1.4v3.6l-2.8 1.4z"/>`,
  trophy: `<path ${HOLES} d="M6.5 2.5h11V9a5.5 5.5 0 0 1-11 0zM12 4.4l1.1 2.3 2.5.3-1.8 1.7.4 2.5L12 10l-2.2 1.2.4-2.5-1.8-1.7 2.5-.3z"/><path d="M6.4 4.4H3.2a.8.8 0 0 0-.8.8v1.3a4.4 4.4 0 0 0 4.7 4.4M17.6 4.4h3.2a.8.8 0 0 1 .8.8v1.3a4.4 4.4 0 0 1-4.7 4.4" ${accentLine(1.9)}/><path d="M10.6 14.2h2.8v3.6h-2.8zM7 18.6h10a.8.8 0 0 1 .8.8v1.8a.8.8 0 0 1-.8.8H7a.8.8 0 0 1-.8-.8v-1.8a.8.8 0 0 1 .8-.8z"/>`,
  // The events' terms: fast, careful, heavy.
  express: `<rect x="9.4" y="1.6" width="5.2" height="2.3" rx=".8"/><path ${HOLES} d="M12 4.6a8.7 8.7 0 1 1 0 17.4 8.7 8.7 0 0 1 0-17.4zm0 2.5a6.2 6.2 0 1 0 0 12.4 6.2 6.2 0 0 0 0-12.4z"/><path ${ACCENT} d="M13 8.4l-4.2 5.4h3l-1 4 4.4-5.6h-3.1z"/><path d="M18.3 4.6l1.8 1.8" ${line(2)}/>`,
  careful: `<path ${HOLES} d="M12 1.8l8.4 3.1a.9.9 0 0 1 .6.9v6.1c0 5.4-5.5 8.9-8.6 10.2a1 1 0 0 1-.8 0C8.5 20.8 3 17.3 3 11.9V5.8a.9.9 0 0 1 .6-.9zm4.1 6.7L10.7 14l-2.8-2.8-1.6 1.6 4.4 4.4 7-7z"/>`,
  heavy: `<path ${HOLES} d="M12 2.4a3.8 3.8 0 0 1 3.4 5.5h2.4a1.4 1.4 0 0 1 1.4 1.1l2.5 11.1a1.4 1.4 0 0 1-1.4 1.7H3.7a1.4 1.4 0 0 1-1.4-1.7L4.8 9a1.4 1.4 0 0 1 1.4-1.1h2.4A3.8 3.8 0 0 1 12 2.4zm0 2.2a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z"/><path ${ACCENT} d="M3.6 14.4h16.8l.6 2.8H3z"/>`,
  // What the truck carries (cargo categories).
  food: `<path d="M5.2 2.2a.9.9 0 0 1 1.8 0v4.4h.7V2.2a.9.9 0 0 1 1.8 0v4.4h.7V2.2a.9.9 0 0 1 1.8 0v6.4a3.3 3.3 0 0 1-2.4 3.2v9a1.4 1.4 0 0 1-2.8 0v-9A3.3 3.3 0 0 1 5.2 8.6z"/><path ${ACCENT} d="M18.8 2.1c-2.4.5-4.2 3.2-4.2 7.4v3.4h2.2v7.9a1.4 1.4 0 0 0 2.8 0V2.8a.7.7 0 0 0-.8-.7z"/>`,
  frozenFood: `<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9.2 3.6L12 5.6l2.8-2M9.2 20.4l2.8-2 2.8 2M3 10.6l3.2-.9-.9-3.2M21 13.4l-3.2.9.9 3.2M3 13.4l3.2.9-.9 3.2M21 10.6l-3.2-.9.9-3.2" ${line(2)}/>`,
  electronics: `<path ${HOLES} d="M4 3.5h16a2 2 0 0 1 2 2v10.2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2zm.5 2.4v9.4h15V5.9z"/><path ${ACCENT} d="M6.2 13.4l3.2-3.6 2.4 2.2 3.4-4.2 2.6 5.6z"/><path d="M8 19.6h8a.9.9 0 0 1 0 1.8H8a.9.9 0 0 1 0-1.8z"/>`,
  furniture: `<path d="M6.2 3.5h11.6a2 2 0 0 1 2 2v4.3a3.4 3.4 0 0 0-2.8 3.3v.6H7v-.6a3.4 3.4 0 0 0-2.8-3.3V5.5a2 2 0 0 1 2-2z"/><path d="M1.8 12.8a2.4 2.4 0 0 1 4.8 0v2.4h10.8v-2.4a2.4 2.4 0 0 1 4.8 0v5.6a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1z"/><rect ${ACCENT} x="3.4" y="19.4" width="2.4" height="2.6" rx=".6"/><rect ${ACCENT} x="18.2" y="19.4" width="2.4" height="2.6" rx=".6"/>`,
  construction: `<rect x="2" y="3.5" width="9.2" height="4.6" rx=".6"/><rect x="12.8" y="3.5" width="9.2" height="4.6" rx=".6"/><rect ${ACCENT} x="2" y="9.7" width="4.4" height="4.6" rx=".6"/><rect x="8" y="9.7" width="8" height="4.6" rx=".6"/><rect x="17.6" y="9.7" width="4.4" height="4.6" rx=".6"/><rect x="2" y="15.9" width="9.2" height="4.6" rx=".6"/><rect x="12.8" y="15.9" width="9.2" height="4.6" rx=".6"/>`,
  agriculture: `<rect x="11" y="7.4" width="2" height="14.6" rx="1"/><ellipse ${ACCENT} cx="12" cy="4.3" rx="1.9" ry="3"/><ellipse ${ACCENT} cx="8.5" cy="9.2" rx="1.9" ry="3.3" transform="rotate(-42 8.5 9.2)"/><ellipse ${ACCENT} cx="15.5" cy="9.2" rx="1.9" ry="3.3" transform="rotate(42 15.5 9.2)"/><ellipse ${ACCENT} cx="8.5" cy="14.4" rx="1.9" ry="3.3" transform="rotate(-42 8.5 14.4)"/><ellipse ${ACCENT} cx="15.5" cy="14.4" rx="1.9" ry="3.3" transform="rotate(42 15.5 14.4)"/>`,
  automotive: `<path d="M5.2 8.6l1.6-3.4a2 2 0 0 1 1.8-1.2h6.8a2 2 0 0 1 1.8 1.2l1.6 3.4h.9A2.3 2.3 0 0 1 22 10.9v4.3a1.4 1.4 0 0 1-1.4 1.4H3.4A1.4 1.4 0 0 1 2 15.2v-4.3a2.3 2.3 0 0 1 2.3-2.3z"/><path ${ACCENT} d="M8 5.8h8l1.3 2.8H6.7z"/><circle ${ACCENT} cx="5.6" cy="12.2" r="1.3"/><circle ${ACCENT} cx="18.4" cy="12.2" r="1.3"/><path ${HOLES} d="M4 18.2a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0 -5.2 0ZM5.7 18.2a0.9 0.9 0 1 0 1.8 0a0.9 0.9 0 1 0 -1.8 0Z"/><path ${HOLES} d="M14.8 18.2a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0 -5.2 0ZM16.5 18.2a0.9 0.9 0 1 0 1.8 0a0.9 0.9 0 1 0 -1.8 0Z"/>`,
  medical: `<path ${HOLES} d="M9 2.4h6a1.2 1.2 0 0 1 1.2 1.2V6h-2V4.4h-4.4V6h-2V3.6A1.2 1.2 0 0 1 9 2.4zM4 6.8h16a2 2 0 0 1 2 2v10.4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.8a2 2 0 0 1 2-2z"/><path ${ACCENT} d="M10.6 9.6h2.8v2.6H16V15h-2.6v2.6h-2.8V15H8v-2.8h2.6z"/>`,
  fragile: `<path d="M5.6 2.4h12.8l-.5 5.8a5.9 5.9 0 0 1-4.7 5.3v5.5h3.4a1 1 0 0 1 0 2H7.4a1 1 0 0 1 0-2h3.4v-5.5a5.9 5.9 0 0 1-4.7-5.3z"/><path d="M13 3.2l-1.6 2.6 2 1.6-1.3 2.4" ${accentLine(1.4)}/>`,
  hazardous: `<path ${ACCENT} ${HOLES} d="M10.3 3.2a2 2 0 0 1 3.4 0l8.6 15a2 2 0 0 1-1.7 3H3.4a2 2 0 0 1-1.7-3zM10.8 8.6v5.8h2.4V8.6zm1.2 7.2a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8z"/>`,
  oversized: `<rect x="5.4" y="5.5" width="13.2" height="13" rx="1.4"/><path ${ACCENT} d="M.8 12l3.6-3.4v6.8zM23.2 12l-3.6-3.4v6.8z"/>`,
  // The truck's parts (upgrade looks).
  // The engine (the upgrade that shows as a bigger exhaust stack): a block with a spark.
  engine: `<path d="M7 4.4h6.4v2.2H11v1.6h3.4l2.2 2.2h1.6V8.6h2.2A1.6 1.6 0 0 1 22 10.2v6a1.6 1.6 0 0 1-1.6 1.6h-2.2v-1.8h-1.6l-2.4 2.8H8.6L6.4 16H4.6v2.4H2V10h2.6V8.2H9V6.6H7z"/><path ${ACCENT} d="M13.2 9.4l-3.6 4.6h2.6l-.8 3.4 3.8-4.8h-2.6z"/>`,
  brakes: `<path ${HOLES} d="M12 2.6a9.4 9.4 0 1 1 0 18.8 9.4 9.4 0 0 1 0-18.8zm0 6.4a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM7.4 11.2a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8zm9.2 0a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8zM12 16.8a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8z"/><path ${ACCENT} d="M13.4 1.4a10.8 10.8 0 0 1 9.2 9.2l-3.2.5a7.5 7.5 0 0 0-6.5-6.5z"/>`,
  wheels: `<path ${HOLES} d="M12 1.6a10.4 10.4 0 1 1 0 20.8 10.4 10.4 0 0 1 0-20.8zm0 4.6a5.8 5.8 0 1 0 0 11.6 5.8 5.8 0 0 0 0-11.6z"/><path ${ACCENT} ${HOLES} d="M12 7.6a4.4 4.4 0 1 1 0 8.8 4.4 4.4 0 0 1 0-8.8zm0 2.8a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z"/>`,
  stance: `<rect x="3.5" y="2" width="17" height="2.6" rx="1"/><rect x="3.5" y="19.4" width="17" height="2.6" rx="1"/><path d="M12 4.6L6.8 7.2l10.4 2.6-10.4 2.6 10.4 2.6-10.4 2.6L12 19.4" ${accentLine(2.2)}/>`,
  fuelTank: `<path ${HOLES} d="M8.6 2.2h3.6a.8.8 0 0 1 .8.8v1.2h1.6l4.8 4.8v11.4a1.6 1.6 0 0 1-1.6 1.6H6.2a1.6 1.6 0 0 1-1.6-1.6V5.8a1.6 1.6 0 0 1 1.6-1.6h1.6V3a.8.8 0 0 1 .8-.8zm-2 4.4h3.6V5.2H6.6z"/><path d="M8.8 10.8l6.4 6.4M15.2 10.8l-6.4 6.4" ${accentLine(2.2)}/>`,
  // The menus and the HUD.
  play: `<path d="M7.2 3.6a1.2 1.2 0 0 1 1.8-1l11.4 8.4a1.2 1.2 0 0 1 0 2L9 21.4a1.2 1.2 0 0 1-1.8-1z"/>`,
  // A gamepad: the controls page.
  controls: `<path ${HOLES} d="M7.2 6.2h9.6a5 5 0 0 1 4.9 4.1l1 5.6a2.9 2.9 0 0 1-5 2.4l-2.1-2.3H8.4l-2.1 2.3a2.9 2.9 0 0 1-5-2.4l1-5.6a5 5 0 0 1 4.9-4.1zM6.4 9.4v1.8H4.6v2h1.8V15h2v-1.8h1.8v-2H8.4V9.4z"/><circle ${ACCENT} cx="16.2" cy="10.4" r="1.3"/><circle ${ACCENT} cx="18.6" cy="13" r="1.3"/>`,
  // How the truck is steered: the wheel on the screen, turning the phone, or left and right buttons.
  steering: `<path ${HOLES} d="M12 2.4a9.6 9.6 0 1 1 0 19.2 9.6 9.6 0 0 1 0-19.2zm0 2.5a7.1 7.1 0 1 0 0 14.2 7.1 7.1 0 0 0 0-14.2z"/><rect x="4.4" y="10.8" width="15.2" height="2.6" rx="1"/><rect x="10.8" y="12" width="2.4" height="7.4" rx="1"/><circle ${ACCENT} cx="12" cy="12.1" r="2.8"/>`,
  tilt: `<rect x="7.6" y="3" width="8.8" height="18" rx="2.2" transform="rotate(24 12 12)"/><rect ${ACCENT} x="9.2" y="5.4" width="5.6" height="11.6" rx=".8" transform="rotate(24 12 12)"/><path d="M2.4 9.4a9.6 9.6 0 0 0 1.4 7.4" ${line(2)}/><path d="M21.6 14.6a9.6 9.6 0 0 0-1.4-7.4" ${line(2)}/>`,
  arrows: `<rect x="1.6" y="5.6" width="9.8" height="12.8" rx="2.6"/><rect x="12.6" y="5.6" width="9.8" height="12.8" rx="2.6"/><path ${ACCENT} d="M8.4 8.8L4.6 12l3.8 3.2z"/><path ${ACCENT} d="M15.6 8.8l3.8 3.2-3.8 3.2z"/>`,
  camera: `<rect x="1.8" y="6.2" width="14" height="11.6" rx="2.4"/><path d="M17 10.4l5.2-3.2v9.6L17 13.6z"/><circle ${ACCENT} cx="6.2" cy="10" r="1.7"/>`,
  keyboard: `<path ${HOLES} d="M3 5.2h18a1.8 1.8 0 0 1 1.8 1.8v10a1.8 1.8 0 0 1-1.8 1.8H3A1.8 1.8 0 0 1 1.2 17V7A1.8 1.8 0 0 1 3 5.2zM4.4 8v2.2h2.2V8zm3.7 0v2.2h2.2V8zm3.7 0v2.2H14V8zm3.7 0v2.2h2.2V8zM4.4 11.4v2.2h2.2v-2.2zm13 0v2.2h2.2v-2.2zM7.6 14.6v1.8h8.8v-1.8z"/><rect ${ACCENT} x="17.4" y="8" width="2.2" height="2.2" rx=".4"/>`,
  plus: `<path d="M12 4v16M4 12h16" ${line(3)}/>`,
  home: `<path ${HOLES} d="M11.2 2.6a1.2 1.2 0 0 1 1.6 0l9 7.6a.8.8 0 0 1-.5 1.4H19.6v8.8a1.2 1.2 0 0 1-1.2 1.2H5.6a1.2 1.2 0 0 1-1.2-1.2v-8.8H2.7a.8.8 0 0 1-.5-1.4zM9.8 14v7.6h4.4V14z"/>`,
  settings: `<path ${HOLES} d="M10.13 4.22L10.34 1.53L13.66 1.53L13.87 4.22L16.18 5.18L18.23 3.42L20.58 5.77L18.82 7.82L19.78 10.13L22.47 10.34L22.47 13.66L19.78 13.87L18.82 16.18L20.58 18.23L18.23 20.58L16.18 18.82L13.87 19.78L13.66 22.47L10.34 22.47L10.13 19.78L7.82 18.82L5.77 20.58L3.42 18.23L5.18 16.18L4.22 13.87L1.53 13.66L1.53 10.34L4.22 10.13L5.18 7.82L3.42 5.77L5.77 3.42L7.82 5.18ZM8.7 12a3.3 3.3 0 1 0 6.6 0a3.3 3.3 0 1 0 -6.6 0Z"/>`,
} as const;

export type IconName = keyof typeof ICONS;

/** The icon's shapes, as the markup inside a `<svg viewBox="0 0 24 24" fill="currentColor">`. */
export function iconMarkup(name: IconName): string {
  return ICONS[name];
}

/** The icon of a cargo category (spec §11). */
export function cargoIcon(category: CargoCategory): IconName {
  return category;
}

/** Each truck part's icon, by how its upgrade shows on the truck. */
const UPGRADE_ICONS: Readonly<Record<UpgradeLook, IconName>> = {
  exhaust: 'engine',
  brakes: 'brakes',
  wheels: 'wheels',
  stance: 'stance',
  fuelTank: 'fuelTank',
};

/** The icon of a truck part an upgrade improves. */
export function upgradeIcon(look: UpgradeLook): IconName {
  return UPGRADE_ICONS[look];
}

/** Each facility's icon, by what it does for the company (one facility per effect). */
const FACILITY_ICONS: Readonly<Record<FacilityEffect, IconName>> = {
  repairDiscount: 'wrench',
  fuelDiscount: 'fuel',
  garageSlots: 'garage',
  fleetPayBonus: 'route',
  marketShareBonus: 'megaphone',
  xpBonus: 'school',
  extraContracts: 'jobs',
};

/** The icon of a facility at the head office, by its effect. */
export function facilityIcon(effect: FacilityEffect): IconName {
  return FACILITY_ICONS[effect];
}
