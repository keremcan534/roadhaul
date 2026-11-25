import type { CrateTier } from '../data/config/GameConfig';
import bronzeOpen from './images/crates/crate-bronze-open.webp';
import bronze from './images/crates/crate-bronze.webp';
import goldOpen from './images/crates/crate-gold-open.webp';
import gold from './images/crates/crate-gold.webp';
import silverOpen from './images/crates/crate-silver-open.webp';
import silverClosed from './images/crates/crate-silver.webp';

/**
 * The crates' chests, by tier: a wooden one banded in iron (bronze), a
 * silver one and a gold one, each with a gem on its lock, closed and burst
 * open with what it held. Painted images (320 px WebP, about 25 KB each;
 * the studio's own art, from its gem game's chests: see
 * DEVELOPMENT_ROADMAP.md), loaded only when a crate is shown. The buttons
 * keep the `crate` glyph (iconShapes.ts), which takes the text's colour.
 */
export const CRATE_ART: Readonly<Record<CrateTier, { readonly closed: string; readonly open: string }>> = {
  bronze: { closed: bronze, open: bronzeOpen },
  silver: { closed: silverClosed, open: silverOpen },
  gold: { closed: gold, open: goldOpen },
};

/** A crate's chest, closed (or `open`), as a decorative image with `className`. */
export function crateImage(document: Document, tier: CrateTier, className: string, open = false): HTMLImageElement {
  const image = document.createElement('img');
  image.className = className;
  image.alt = '';
  image.draggable = false;
  image.decoding = 'async';
  image.src = open ? CRATE_ART[tier].open : CRATE_ART[tier].closed;
  return image;
}
