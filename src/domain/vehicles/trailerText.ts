/** The most letters the trailer's sides hold. */
export const TRAILER_TEXT_MAX = 14;

/** What the trailer's lettering can draw (the presentation's stroke font): capitals, Turkish ones too, digits, a few marks. */
const DRAWABLE = /[A-ZÇĞİÖŞÜ0-9 /.:-]/u;

/**
 * The company's text for its trailers, as it will be lettered: in capitals
 * (by the player's language, `locale`: "i" to "İ" in Turkish), only what
 * the lettering can draw, spaces run together and trimmed, at most
 * TRAILER_TEXT_MAX letters. Empty: null, the trailers keep the classic
 * RoadHaul.
 */
export function trailerText(raw: string, locale: string): string | null {
  let upper: string;
  try {
    upper = raw.toLocaleUpperCase(locale);
  } catch {
    upper = raw.toUpperCase();
  }
  const kept = [...upper].filter((letter) => DRAWABLE.test(letter)).join('');
  const text = kept.replace(/\s+/gu, ' ').trim().slice(0, TRAILER_TEXT_MAX).trim();
  return text === '' ? null : text;
}
