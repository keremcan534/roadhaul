import { lensDisplacementPixels, type GlassMode } from './glassMode';

/** The lens filter's id, referenced from styles.css as `url(#rh-glass-lens)`. */
export const GLASS_LENS_FILTER_ID = 'rh-glass-lens';
/** The share of each side, from the rim inward, where the lens bends: the thickness of its rounded edge. */
const LENS_EDGE = 0.12;
/** The displacement map's side in pixels: stretched over each glass surface, it only needs to be smooth. */
const LENS_MAP_SIZE = 128;
/** How far the rim shifts what shows through, as a share of the surface's width or height. */
const LENS_STRENGTH = 0.05;
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Marks the page's glass (`<html data-glass>`), and for `lens` adds the SVG
 * filter the stylesheet draws it with: the displacement map stretched over
 * each glass surface (object bounding box units), so one filter serves
 * surfaces of any size.
 */
export function installGlass(document: Document, mode: GlassMode): void {
  document.documentElement.dataset.glass = mode;
  if (mode !== 'lens' || document.getElementById(GLASS_LENS_FILTER_ID) !== null) {
    return;
  }
  const map = lensMapUrl(document);
  if (map === null) {
    document.documentElement.dataset.glass = 'blur';
    return;
  }
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'glass-defs');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const filter = document.createElementNS(SVG_NS, 'filter');
  filter.id = GLASS_LENS_FILTER_ID;
  for (const [name, value] of [
    ['filterUnits', 'objectBoundingBox'],
    ['primitiveUnits', 'objectBoundingBox'],
    ['x', '0'],
    ['y', '0'],
    ['width', '1'],
    ['height', '1'],
    ['color-interpolation-filters', 'sRGB'],
  ] as const) {
    filter.setAttribute(name, value);
  }
  const image = document.createElementNS(SVG_NS, 'feImage');
  for (const [name, value] of [
    ['href', map],
    ['x', '0'],
    ['y', '0'],
    ['width', '1'],
    ['height', '1'],
    ['preserveAspectRatio', 'none'],
    ['result', 'lens'],
  ] as const) {
    image.setAttribute(name, value);
  }
  const displace = document.createElementNS(SVG_NS, 'feDisplacementMap');
  for (const [name, value] of [
    ['in', 'SourceGraphic'],
    ['in2', 'lens'],
    ['scale', String(LENS_STRENGTH * 2)],
    ['xChannelSelector', 'R'],
    ['yChannelSelector', 'G'],
  ] as const) {
    displace.setAttribute(name, value);
  }
  filter.append(image, displace);
  svg.append(filter);
  document.body.append(svg);
}

/** The displacement map as a PNG data URL, or null where the page cannot draw one. */
function lensMapUrl(document: Document): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = LENS_MAP_SIZE;
  canvas.height = LENS_MAP_SIZE;
  const context = canvas.getContext('2d');
  if (context === null) {
    return null;
  }
  const image = context.createImageData(LENS_MAP_SIZE, LENS_MAP_SIZE);
  image.data.set(lensDisplacementPixels(LENS_MAP_SIZE, LENS_EDGE));
  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}
