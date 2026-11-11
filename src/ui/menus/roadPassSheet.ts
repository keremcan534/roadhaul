import type { PassReward } from '../../data/config/GameConfig';
import type { PassTier } from '../../systems/rewards/RoadPassService';
import { button, element } from '../dom';
import type { Strings } from '../i18n';
import { icon } from '../icons';

/** The Road Pass as its page shows it: RoadPassService's season, and whether Plus is sold here. */
export interface RoadPassShown {
  readonly season: number;
  readonly endsInMs: number;
  readonly points: number;
  readonly pointsPerTier: number;
  readonly tierReached: number;
  readonly tiers: readonly PassTier[];
  readonly plus: boolean;
  /** Plus can be bought here (the store is up), and is not yet. */
  readonly plusForSale: boolean;
  /** A colour's name and look. */
  readonly paintColor: (paintId: string) => number;
}

export interface RoadPassActions {
  readonly onClaimFree: (tier: number) => void;
  readonly onClaimPremium: (tier: number) => void;
  /** Opens the shop on Road Pass Plus. */
  readonly onGetPlus: () => void;
}

/** A free reward in words: credits, a crate, upgrade parts, a booster. */
export function passRewardText(strings: Strings, reward: PassReward): string {
  switch (reward.kind) {
    case 'credits':
      return strings.money(reward.amount);
    case 'crate':
      return strings.t(`crate.name.${reward.tier}`);
    case 'parts':
      return strings.t('crates.gotParts', { count: strings.number(reward.amount) });
    case 'booster':
      return strings.t(`booster.${reward.booster}.name`);
  }
}

/**
 * The Road Pass page (the goals dialog's third tab): the season and when it
 * ends, the points to the next tier, Road Pass Plus (its colours, looks
 * only, and how to get it), then each tier: its free reward and its Plus
 * colour, each to collect once reached (Plus's with Plus).
 */
export function roadPassSheet(document: Document, strings: Strings, shown: RoadPassShown, actions: RoadPassActions): HTMLElement {
  const sheet = element(document, 'div', 'road-pass');
  const head = element(document, 'div', 'road-pass__head');
  const last = shown.tiers.length;
  const next = Math.min(last, shown.tierReached + 1);
  const into = shown.tierReached >= last ? shown.pointsPerTier : shown.points - shown.tierReached * shown.pointsPerTier;
  const meter = element(document, 'div', 'meter road-pass__meter');
  const fill = element(document, 'div', 'meter__fill');
  fill.style.transform = `scaleX(${Math.min(1, into / shown.pointsPerTier)})`;
  meter.append(fill);
  head.append(
    element(document, 'p', 'road-pass__season', strings.t('pass.season', { season: strings.number(shown.season + 1), time: strings.timeSpan(shown.endsInMs) })),
    element(
      document,
      'p',
      'road-pass__progress',
      shown.tierReached >= last
        ? strings.t('pass.allReached')
        : strings.t('pass.toNext', { tier: strings.number(next), points: strings.number(into), of: strings.number(shown.pointsPerTier) }),
    ),
    meter,
  );
  const plus = element(document, 'div', 'road-pass__plus');
  plus.classList.toggle('is-owned', shown.plus);
  plus.append(icon(document, 'star', 'road-pass__plus-icon'), element(document, 'span', 'road-pass__plus-text', strings.t(shown.plus ? 'pass.plusOwned' : 'pass.plusNote')));
  if (!shown.plus && shown.plusForSale) {
    plus.append(button(document, 'button--primary road-pass__get', strings.t('pass.getPlus'), 'get-road-pass', actions.onGetPlus));
  }
  head.append(plus);

  const list = element(document, 'ol', 'road-pass__tiers');
  for (const tier of shown.tiers) {
    const row = element(document, 'li', 'road-pass__tier');
    row.dataset.tier = String(tier.tier);
    row.classList.toggle('is-reached', tier.reached);
    const free = element(document, 'div', 'road-pass__reward');
    free.append(element(document, 'span', 'road-pass__reward-text', passRewardText(strings, tier.free)));
    if (tier.freeClaimed) {
      free.append(element(document, 'span', 'road-pass__done', strings.t('achievements.collected')));
    } else if (tier.reached) {
      free.append(button(document, 'button--primary road-pass__claim', strings.t('pass.collect'), 'claim-pass-free', () => actions.onClaimFree(tier.tier)));
    }
    const premium = element(document, 'div', 'road-pass__reward road-pass__reward--plus');
    if (tier.premium !== null) {
      const swatch = element(document, 'span', 'road-pass__swatch');
      swatch.style.background = `#${shown.paintColor(tier.premium.id).toString(16).padStart(6, '0')}`;
      premium.append(swatch, element(document, 'span', 'road-pass__reward-text', strings.t(`paint.${tier.premium.id}.name`)));
      if (tier.premiumClaimed) {
        premium.append(element(document, 'span', 'road-pass__done', strings.t('achievements.collected')));
      } else if (tier.reached && shown.plus) {
        premium.append(button(document, 'button--primary road-pass__claim', strings.t('pass.collect'), 'claim-pass-plus', () => actions.onClaimPremium(tier.tier)));
      } else if (!shown.plus) {
        premium.append(icon(document, 'close', 'road-pass__lock'));
      }
    }
    row.append(element(document, 'span', 'road-pass__number', strings.number(tier.tier)), free, premium);
    list.append(row);
  }
  sheet.append(head, list);
  return sheet;
}
