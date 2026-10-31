import type { NewsItem } from '../../systems/world/NewsService';
import { element } from '../dom';
import type { Strings } from '../i18n';
import { icon } from '../icons';

/** A headline's text, with the city, the rival and its boss, the company and the count it names filled in. */
export function newsText(strings: Strings, item: NewsItem, companyName: string): string {
  return strings.t(item.key, {
    city: item.cityId === null ? '' : strings.cityName(item.cityId),
    rival: item.rivalId === null ? '' : strings.rivalName(item.rivalId),
    boss: item.rivalId === null ? '' : strings.t(`rival.${item.rivalId}.boss`),
    company: companyName,
    count: strings.number(item.count),
  });
}

/** The game clock's time a headline came at: "07:45". */
function clockText(minuteOfDay: number): string {
  const hours = Math.floor(minuteOfDay / 60);
  const minutes = minuteOfDay % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** The Gazette, newest first, each headline with the time it came: breaking news marked. */
export function gazette(document: Document, strings: Strings, items: readonly NewsItem[], companyName: string): HTMLElement {
  if (items.length === 0) {
    return element(document, 'p', 'hq__empty gazette__empty', strings.t('news.empty'));
  }
  const list = element(document, 'ul', 'gazette');
  for (const item of items) {
    const entry = element(document, 'li', 'gazette__item');
    entry.dataset.key = item.key;
    entry.classList.toggle('is-breaking', item.breaking);
    if (item.breaking) {
      entry.append(element(document, 'span', 'gazette__breaking', strings.t('news.breaking')));
    }
    entry.append(
      element(document, 'span', 'gazette__text', newsText(strings, item, companyName)),
      element(document, 'span', 'gazette__time', clockText(item.minuteOfDay)),
    );
    list.append(entry);
  }
  return list;
}

/** The newest headline in one line, over the job board: what the region is talking about. A tap opens the Gazette. */
export function newsTicker(document: Document, strings: Strings, item: NewsItem, companyName: string, onOpen: () => void): HTMLElement {
  const ticker = element(document, 'button', 'news-ticker');
  ticker.type = 'button';
  ticker.dataset.value = 'news-latest';
  ticker.dataset.action = 'open-news';
  ticker.addEventListener('click', onOpen);
  ticker.classList.toggle('is-breaking', item.breaking);
  ticker.append(
    icon(document, 'news'),
    element(document, 'span', 'news-ticker__label', item.breaking ? strings.t('news.breaking') : strings.t('news.title')),
    element(document, 'span', 'news-ticker__text', newsText(strings, item, companyName)),
  );
  return ticker;
}
