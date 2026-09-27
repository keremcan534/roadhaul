import { FACILITY_EFFECTS, type FacilityEffect } from '../../data/definitions/FacilityDefinition';
import type { Credits } from '../../data/units';
import type { FacilityPerks } from '../../domain/company/facilities';
import type { FacilityOffer } from '../../systems/company/FacilityService';
import { button, element } from '../dom';
import type { Strings } from '../i18n';
import { facilityIcon, icon } from '../icons';

/** What the company page shows: the facilities as the head office offers them, and what they give now. */
export interface CompanyPageView {
  readonly offers: readonly FacilityOffer[];
  readonly perks: FacilityPerks;
  readonly canAfford: (price: Credits) => boolean;
}

/**
 * The company's own page: what it builds for itself at the head office, a
 * level at a time. At the top, all that its facilities give it now; then a
 * card for each facility, with its effect at the level built, the next
 * level's and its price, or the company level that unlocks it.
 */
export function companyPage(
  document: Document,
  strings: Strings,
  view: CompanyPageView,
  onBuild: (facilityId: string) => void,
): HTMLElement[] {
  const section = (name: string, title: string, ...content: HTMLElement[]): HTMLElement => {
    const node = element(document, 'section', `hq__section hq__section--${name}`);
    node.append(element(document, 'h3', 'hq__section-title', title), ...content);
    return node;
  };

  const given = FACILITY_EFFECTS.filter((effect) => view.perks[effect] > 0);
  const perks = element(document, 'div', 'hq__perks');
  perks.dataset.value = 'perks';
  if (given.length === 0) {
    perks.append(element(document, 'p', 'hq__note', strings.t('hq.company.noPerks')));
  } else {
    for (const effect of given) {
      const perk = element(document, 'span', 'hq__perk');
      perk.dataset.effect = effect;
      perk.append(icon(document, facilityIcon(effect)), element(document, 'span', '', facilityEffectText(strings, effect, view.perks[effect])));
      perks.append(perk);
    }
  }

  const cards = element(document, 'div', 'hq__cards');
  cards.append(
    ...view.offers.map((offer) => facilityCard(document, strings, offer, offer.next !== null && view.canAfford(offer.next.cost), onBuild)),
  );
  return [
    element(document, 'p', 'hq__note', strings.t('hq.company.note')),
    section('perks', strings.t('hq.company.perks'), perks),
    section('facilities', strings.t('hq.company.facilities'), cards),
  ];
}

/**
 * A facility at the head office: what it is for, the level built and its
 * effect, and the next level with its effect and price, or what unlocks it.
 */
export function facilityCard(
  document: Document,
  strings: Strings,
  offer: FacilityOffer,
  canAfford: boolean,
  onBuild: (facilityId: string) => void,
): HTMLElement {
  const { definition, level, next, locked } = offer;
  const card = element(document, 'article', 'upgrade-card facility-card');
  card.dataset.facilityId = definition.id;
  card.dataset.level = String(level);

  const top = element(document, 'div', 'upgrade-card__top');
  const picture = element(document, 'span', 'upgrade-card__icon');
  picture.append(icon(document, facilityIcon(definition.effect)));
  const pips = element(document, 'span', 'upgrade-card__pips');
  pips.setAttribute('aria-label', strings.t('hq.upgrades.level', { level, max: definition.levels.length }));
  for (let pip = 1; pip <= definition.levels.length; pip++) {
    pips.append(element(document, 'span', pip <= level ? 'pip is-on' : 'pip'));
  }
  top.append(picture, element(document, 'h3', 'upgrade-card__title', strings.facilityName(definition.id)), pips);

  const about = element(document, 'p', 'facility-card__about', strings.t(`facility.${definition.id}.description`));
  const now = element(
    document,
    'p',
    'upgrade-card__effect',
    level === 0 ? strings.t('hq.company.notBuilt') : facilityEffectText(strings, definition.effect, definition.levels[level - 1]!.value),
  );
  card.append(top, about, now);
  const bottom = element(document, 'div', 'upgrade-card__bottom');
  if (next === null) {
    bottom.append(element(document, 'span', 'upgrade-card__status', strings.t('hq.upgrades.maxed')));
  } else {
    card.append(
      element(
        document,
        'p',
        'upgrade-card__next',
        strings.t('hq.upgrades.next', { level: level + 1, effect: facilityEffectText(strings, definition.effect, next.value) }),
      ),
    );
    if (locked) {
      bottom.append(element(document, 'span', 'upgrade-card__price', strings.money(next.cost)));
      bottom.append(element(document, 'span', 'upgrade-card__status', strings.t('hq.locked', { level: next.requiredCompanyLevel ?? 1 })));
    } else {
      const build = button(
        document,
        'button--primary upgrade-card__action',
        strings.t(level === 0 ? 'hq.company.build' : 'hq.company.expand', { cost: strings.money(next.cost) }),
        'build-facility',
        () => onBuild(definition.id),
      );
      build.disabled = !canAfford;
      bottom.append(build);
    }
  }
  card.append(bottom);
  return card;
}

/** What a facility's `value` gives the company: "Repair costs −15%", "Garage space +2". */
export function facilityEffectText(strings: Strings, effect: FacilityEffect, value: number): string {
  return strings.t(`facility.effect.${effect}`, { percent: strings.percent(value), count: strings.number(value) });
}
