import { element } from '../dom';

/** One company's share of a city's standing. */
export interface CompanyShare {
  readonly companyId: string;
  readonly share: number;
}

/**
 * A city's shares side by side, each company's in its colour (the Rivals
 * page's city cards and the map's city card). Its label reads them out.
 */
export function shareBar(
  document: Document,
  shares: readonly CompanyShare[],
  colorOf: (companyId: string) => string,
  describe: (companyId: string, share: number) => string,
): HTMLDivElement {
  const bar = element(document, 'div', 'share-bar');
  bar.setAttribute('role', 'img');
  const described: string[] = [];
  for (const { companyId, share } of shares) {
    if (share <= 0) {
      continue;
    }
    const part = element(document, 'span', 'share-bar__part');
    part.dataset.companyId = companyId;
    part.style.width = `${(share * 100).toFixed(2)}%`;
    part.style.setProperty('--company-color', colorOf(companyId));
    bar.append(part);
    described.push(describe(companyId, share));
  }
  bar.setAttribute('aria-label', described.join(', '));
  return bar;
}
