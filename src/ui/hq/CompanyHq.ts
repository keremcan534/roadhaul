import type { MissionDefinition } from '../../data/definitions/MissionDefinition';
import type { JobOffer } from '../../systems/missions/MissionService';
import { button, element } from '../dom';
import type { Strings } from '../i18n';

export interface CompanyHqActions {
  readonly onAccept: (missionId: string) => void;
  readonly onFreeDrive: () => void;
  readonly onMainMenu: () => void;
}

/**
 * The company HQ (spec §26), for now its job board (spec §28): one card per
 * contract with route, cargo, distance, time limit and pay. Taking a job goes
 * through MissionService; this screen only shows offers and reports choices.
 */
export class CompanyHq {
  private readonly root: HTMLDivElement;
  private readonly list: HTMLDivElement;

  constructor(
    parent: HTMLElement,
    private readonly strings: Strings,
    private readonly actions: CompanyHqActions,
  ) {
    const document = parent.ownerDocument;
    this.root = element(document, 'div', 'screen hq');
    this.root.dataset.screen = 'companyHq';
    this.root.hidden = true;

    const header = element(document, 'header', 'hq__header');
    const titles = element(document, 'div', 'hq__titles');
    titles.append(
      element(document, 'h2', 'hq__title', strings.t('hq.title')),
      element(document, 'p', 'hq__subtitle', strings.t('hq.jobBoard')),
    );
    const tools = element(document, 'div', 'hq__tools');
    tools.append(
      button(document, 'button--ghost', strings.t('hq.mainMenu'), 'main-menu', actions.onMainMenu),
      button(document, 'button--secondary', strings.t('hq.freeDrive'), 'free-drive', actions.onFreeDrive),
    );
    header.append(titles, tools);
    this.list = element(document, 'div', 'hq__jobs');
    this.root.append(header, this.list);
    parent.append(this.root);
  }

  /** Opens the HQ showing `offers`. The cards are rebuilt only here, not per frame. */
  show(offers: readonly JobOffer[]): void {
    const document = this.root.ownerDocument;
    const cards = offers.map((offer) => this.card(document, offer));
    if (cards.length === 0) {
      cards.push(element(document, 'p', 'hq__empty', this.strings.t('hq.noJobs')));
    }
    this.list.replaceChildren(...cards);
    this.list.scrollTop = 0;
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  dispose(): void {
    this.root.remove();
  }

  private card(document: Document, offer: JobOffer): HTMLElement {
    const { mission, cargo } = offer;
    const strings = this.strings;
    const card = element(document, 'article', 'job-card');
    card.dataset.missionId = mission.id;

    const top = element(document, 'div', 'job-card__top');
    top.append(
      element(document, 'h3', 'job-card__title', strings.missionTitle(mission.id)),
      element(document, 'span', `badge badge--${mission.difficulty}`, strings.t(`difficulty.${mission.difficulty}`)),
    );
    const route = element(document, 'p', 'job-card__route', routeText(strings, mission));
    const load = element(
      document,
      'p',
      'job-card__cargo',
      `${strings.cargoName(cargo.id)} · ${strings.tons(mission.cargoWeightTons)}`,
    );
    const facts = element(document, 'dl', 'job-card__facts');
    for (const [label, value] of [
      [strings.t('hq.distance'), strings.distance(offer.distanceMeters)],
      [strings.t('hq.timeLimit'), strings.duration(mission.timeLimitSeconds)],
    ] as const) {
      const fact = element(document, 'div', 'job-card__fact');
      fact.append(element(document, 'dt', '', label), element(document, 'dd', '', value));
      facts.append(fact);
    }
    const bottom = element(document, 'div', 'job-card__bottom');
    bottom.append(
      element(document, 'span', 'job-card__pay', strings.money(offer.basePay)),
      button(document, 'button--primary job-card__accept', strings.t('hq.accept'), 'accept', () =>
        this.actions.onAccept(mission.id),
      ),
    );
    card.append(top, route, load, facts, bottom);
    return card;
  }
}

/** "Yeniliman → Demirkent". */
export function routeText(strings: Strings, mission: MissionDefinition): string {
  return `${strings.cityName(mission.originCityId)} → ${strings.cityName(mission.destinationCityId)}`;
}
