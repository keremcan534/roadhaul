import type { StatModifier } from '../../data/definitions/UpgradeDefinition';
import type { UpgradeOffer } from '../../systems/vehicles/UpgradeService';
import { button, element } from '../dom';
import type { Strings } from '../i18n';

/**
 * An upgrade in the shop (spec §16), for the truck the player drives: the
 * fitted level and its effect, and the next level with its price, or what
 * unlocks it.
 */
export function upgradeCard(
  document: Document,
  strings: Strings,
  offer: UpgradeOffer,
  canAfford: boolean,
  onBuy: (upgradeId: string) => void,
): HTMLElement {
  const { upgrade, fittedLevel, next } = offer;
  const maxLevel = upgrade.levels.length;
  const card = element(document, 'article', 'upgrade-card');
  card.dataset.upgradeId = upgrade.id;
  card.dataset.level = String(fittedLevel);

  const top = element(document, 'div', 'upgrade-card__top');
  const pips = element(document, 'span', 'upgrade-card__pips');
  pips.setAttribute('aria-label', strings.t('hq.upgrades.level', { level: fittedLevel, max: maxLevel }));
  for (let level = 1; level <= maxLevel; level++) {
    pips.append(element(document, 'span', level <= fittedLevel ? 'pip is-on' : 'pip'));
  }
  top.append(element(document, 'h3', 'upgrade-card__title', strings.upgradeName(upgrade.id)), pips);

  const now = element(
    document,
    'p',
    'upgrade-card__effect',
    fittedLevel === 0 ? strings.t('hq.upgrades.none') : effectText(strings, offer.fittedModifiers),
  );
  const bottom = element(document, 'div', 'upgrade-card__bottom');
  if (next === null) {
    card.append(top, now);
    bottom.append(element(document, 'span', 'upgrade-card__status', strings.t('hq.upgrades.maxed')));
  } else {
    const upcoming = element(
      document,
      'p',
      'upgrade-card__next',
      strings.t('hq.upgrades.next', { level: next.level, effect: effectText(strings, next.modifiers) }),
    );
    card.append(top, now, upcoming);
    if (next.locked) {
      bottom.append(element(document, 'span', 'upgrade-card__price', strings.money(next.cost)));
      bottom.append(element(document, 'span', 'upgrade-card__status', strings.t('hq.locked', { level: next.requiredCompanyLevel })));
    } else {
      const buy = button(
        document,
        'button--primary upgrade-card__action',
        strings.t('hq.upgrades.buy', { cost: strings.money(next.cost) }),
        'buy-upgrade',
        () => onBuy(upgrade.id),
      );
      buy.disabled = !canAfford;
      bottom.append(buy);
    }
  }
  card.append(bottom);
  return card;
}

/** "Engine power +16% · Fuel use −5%". */
export function effectText(strings: Strings, modifiers: readonly StatModifier[]): string {
  return modifiers.map(({ stat, bonus }) => strings.t(`stat.${stat}`, { percent: strings.percent(bonus) })).join(' · ');
}
