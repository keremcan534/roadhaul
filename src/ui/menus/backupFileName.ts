/** The longest the company's name runs in a backup's file name. */
const NAME_CHARS = 32;

/**
 * A company backup's file name: the company's name in plain letters and
 * the day it was made (the device's local time), as
 * `roadhaul-kuzey-lojistik-20261101.json`; `company` where the name has no
 * plain letters (Cyrillic, say).
 */
export function backupFileName(companyName: string, madeAt: Date): string {
  const name =
    companyName
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/ı/g, 'i')
      .replace(/ß/g, 'ss')
      .replace(/[łŁ]/g, 'l')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+/, '')
      .slice(0, NAME_CHARS)
      .replace(/-+$/, '') || 'company';
  const two = (value: number): string => String(value).padStart(2, '0');
  return `roadhaul-${name}-${madeAt.getFullYear()}${two(madeAt.getMonth() + 1)}${two(madeAt.getDate())}.json`;
}
