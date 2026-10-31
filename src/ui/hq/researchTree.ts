import type { Credits } from '../../data/units';
import { RESEARCH_BRANCHES, type ResearchBranch } from '../../data/definitions/ResearchDefinition';
import type { ResearchOffer } from '../../systems/company/ResearchService';
import { button, element } from '../dom';
import type { Strings } from '../i18n';
import { facilityIcon, icon, type IconName } from '../icons';
import { facilityEffectText } from './companyPage';

/** What the research tree shows: each step and where it stands, the points held, and what the company can pay. */
export interface ResearchTreeView {
  readonly offers: readonly ResearchOffer[];
  readonly points: number;
  /** Points a delivery earns, and a perfect one. */
  readonly pointsPerDelivery: number;
  readonly pointsPerPerfectDelivery: number;
  readonly canAfford: (price: Credits) => boolean;
}

const BRANCH_ICONS: Readonly<Record<ResearchBranch, IconName>> = {
  logistics: 'route',
  engineering: 'wrench',
  business: 'coins',
};

/**
 * The company page's research tree: the points held and how deliveries
 * earn them, then a column for each branch, its steps from the first tier
 * down, joined by a line that lights up as they are researched. Each step
 * shows its perk and its price in points and credits, a button when it can
 * be researched, or what it waits for.
 */
export function researchTree(
  document: Document,
  strings: Strings,
  view: ResearchTreeView,
  onResearch: (researchId: string) => void,
): HTMLElement {
  const section = element(document, 'section', 'hq__section hq__section--research');
  const head = element(document, 'div', 'research__head');
  const points = element(document, 'span', 'research__points');
  points.append(icon(document, 'research'), element(document, 'span', '', strings.t('hq.research.points', { count: strings.number(view.points) })));
  points.dataset.value = 'research-points';
  head.append(element(document, 'h3', 'hq__section-title', strings.t('hq.research.title')), points);
  const note = element(
    document,
    'p',
    'hq__note',
    strings.t('hq.research.note', {
      points: strings.number(view.pointsPerDelivery),
      perfect: strings.number(view.pointsPerPerfectDelivery),
    }),
  );

  const branches = element(document, 'div', 'research__branches');
  for (const branch of RESEARCH_BRANCHES) {
    const steps = view.offers.filter((offer) => offer.definition.branch === branch);
    if (steps.length === 0) {
      continue;
    }
    const column = element(document, 'div', 'research__branch');
    column.dataset.branch = branch;
    const title = element(document, 'h4', 'research__branch-title');
    title.append(icon(document, BRANCH_ICONS[branch]), element(document, 'span', '', strings.t(`hq.research.branch.${branch}`)));
    column.append(title);
    for (const offer of steps) {
      column.append(researchNode(document, strings, offer, view, onResearch));
    }
    branches.append(column);
  }
  section.append(head, note, branches);
  return section;
}

function researchNode(
  document: Document,
  strings: Strings,
  offer: ResearchOffer,
  view: ResearchTreeView,
  onResearch: (researchId: string) => void,
): HTMLElement {
  const { definition, state } = offer;
  const node = element(document, 'article', 'research-node');
  node.dataset.researchId = definition.id;
  node.dataset.state = state;
  const badge = element(document, 'span', 'research-node__icon');
  badge.append(icon(document, facilityIcon(definition.effect)));
  const body = element(document, 'div', 'research-node__body');
  body.append(
    element(document, 'h5', 'research-node__name', strings.researchName(definition.id)),
    element(document, 'p', 'research-node__effect', facilityEffectText(strings, definition.effect, definition.value)),
  );
  const price = strings.t('hq.research.cost', { points: strings.number(definition.points), cost: strings.money(definition.cost) });
  switch (state) {
    case 'researched':
      body.append(element(document, 'span', 'research-node__status is-done', strings.t('hq.research.done')));
      break;
    case 'available': {
      const research = button(
        document,
        'button--primary research-node__action',
        `${strings.t('hq.research.do')} · ${price}`,
        'research',
        () => onResearch(definition.id),
      );
      research.disabled = view.points < definition.points || !view.canAfford(definition.cost);
      body.append(research);
      break;
    }
    case 'needsPrevious':
      body.append(
        element(document, 'span', 'research-node__price', price),
        element(document, 'span', 'research-node__status', strings.t('hq.research.needsPrevious')),
      );
      break;
    case 'locked':
      body.append(
        element(document, 'span', 'research-node__price', price),
        element(document, 'span', 'research-node__status', strings.t('hq.locked', { level: definition.requiredCompanyLevel ?? 1 })),
      );
      break;
  }
  node.append(badge, body);
  return node;
}
