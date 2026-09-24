import type { VehicleDefinition } from '../../data/definitions/VehicleDefinition';

const SVG_NS = 'http://www.w3.org/2000/svg';
const BOX_WHITE = '#eef0ec';
const CHASSIS = '#23272c';
const GLASS = '#1d2a36';
const DECK = '#7a5a3c';
const BRICKS = '#a94f35';
const COOLER = '#9aa3ab';

/**
 * A side view of a truck model, facing right, as the 3D truck is built
 * (TruckView): a cab-over cab in `color`, its body (a box with a stripe in
 * `color`, a refrigerated box with its cooling unit, or a flatbed with its
 * load of bricks), and one rear axle, or two on a heavy truck. For the
 * garage's cards and the truck page.
 */
export function truckSilhouette(document: Document, definition: VehicleDefinition, color: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'truck-silhouette');
  svg.setAttribute('viewBox', '0 0 100 46');
  svg.setAttribute('aria-hidden', 'true');
  const paint = `#${color.toString(16).padStart(6, '0')}`;
  const tandem = definition.vehicleClass === 'heavy';
  const rearAxles = tandem ? [14, 26] : [19];
  let body: string;
  switch (definition.bodyType) {
    case 'flatbed':
      body =
        `<rect x="3" y="29" width="68" height="4" fill="${DECK}"/>` +
        `<rect x="67" y="13" width="4" height="17" fill="${COOLER}"/>` +
        `<rect x="7" y="19" width="17" height="10" fill="${BRICKS}"/><rect x="26" y="19" width="17" height="10" fill="${BRICKS}"/>` +
        `<rect x="45" y="19" width="17" height="10" fill="${BRICKS}"/>` +
        `<path d="M7 22h55" stroke="#ffa21c" stroke-width="1.2"/>`;
      break;
    case 'refrigerated':
      body =
        `<rect x="3" y="5" width="68" height="28" rx="1.5" fill="${BOX_WHITE}"/>` +
        `<rect x="3" y="23" width="68" height="3.5" fill="${paint}"/>` +
        `<rect x="66" y="2" width="8" height="10" rx="1" fill="${COOLER}"/>`;
      break;
    case 'box':
      body =
        `<rect x="3" y="5" width="68" height="28" rx="1.5" fill="${BOX_WHITE}"/>` +
        `<rect x="3" y="23" width="68" height="3.5" fill="${paint}"/>`;
      break;
  }
  const wheels = [...rearAxles, 85]
    .map((x) => `<circle cx="${x}" cy="37" r="6.5" fill="${CHASSIS}"/><circle cx="${x}" cy="37" r="3" fill="#b8bec5"/>`)
    .join('');
  svg.innerHTML =
    `<rect x="3" y="32" width="93" height="4" fill="${CHASSIS}"/>` +
    body +
    `<path d="M74 9a3 3 0 0 1 3-3h14a4 4 0 0 1 4 4v24H74z" fill="${paint}"/>` +
    `<path d="M80 9h11.5a2 2 0 0 1 2 2v8H80z" fill="${GLASS}"/>` +
    `<rect x="93" y="27" width="3.5" height="3" fill="#fff4d6"/>` +
    wheels;
  return svg;
}
