import type { MissionDefinition } from '../../data/definitions/MissionDefinition';
import type { Credits } from '../../data/units';
import type { MissionFailureReason } from '../../domain/missions/MissionInstance';
import type { GameEvents } from '../../systems/GameEvents';
import { button, element } from '../dom';
import { routeText } from '../hq/CompanyHq';
import type { Strings } from '../i18n';

/**
 * The end of a contract (spec §12): the itemised pay of a delivery, or why
 * the contract failed. Continue returns to the HQ.
 */
export class ResultDialog {
  private readonly overlay: HTMLDivElement;
  private readonly panel: HTMLDivElement;

  constructor(
    parent: HTMLElement,
    private readonly strings: Strings,
    private readonly onContinue: () => void,
  ) {
    const document = parent.ownerDocument;
    this.overlay = element(document, 'div', 'screen result-dialog');
    this.overlay.dataset.screen = 'result';
    this.overlay.hidden = true;
    this.panel = element(document, 'div', 'panel result-dialog__panel');
    this.overlay.append(this.panel);
    parent.append(this.overlay);
  }

  get isOpen(): boolean {
    return !this.overlay.hidden;
  }

  /** The delivery's pay, XP, reputation and the new balance. */
  showCompleted(definition: MissionDefinition, delivery: GameEvents['MissionCompleted'], balance: Credits): void {
    const { strings } = this;
    const document = this.overlay.ownerDocument;
    const { reward } = delivery;
    const lines = element(document, 'dl', 'result-dialog__lines');
    const line = (label: string, amount: string, className = ''): void => {
      const row = element(document, 'div', `result-dialog__line ${className}`.trim());
      row.append(element(document, 'dt', '', label), element(document, 'dd', '', amount));
      lines.append(row);
    };
    line(strings.t('result.basePay'), strings.money(reward.basePay));
    if (reward.onTime) {
      line(strings.t('result.timeBonus'), strings.signedMoney(reward.timeBonus), 'is-bonus');
    } else {
      line(
        strings.t('result.latePenalty', { time: strings.duration(reward.lateSeconds) }),
        strings.signedMoney(-reward.latePenalty),
        'is-penalty',
      );
    }
    line(strings.t('result.conditionBonus'), strings.signedMoney(reward.conditionBonus), 'is-bonus');
    line(strings.t('result.total'), strings.money(reward.total), 'is-total');
    line(strings.t('result.xp'), `+${strings.t('format.xp', { value: delivery.xp })}`, 'is-progress');
    line(strings.t('result.reputation'), `+${delivery.reputation}`, 'is-progress');
    line(strings.t('result.balance'), strings.money(balance));

    const facts = element(
      document,
      'p',
      'result-dialog__facts',
      `${strings.t('result.deliveryTime')} ${strings.duration(delivery.deliverySeconds)} / ${strings.duration(definition.timeLimitSeconds)}` +
        ` · ${strings.t('result.cargoCondition')} ${strings.percent(1 - delivery.cargoDamage)}`,
    );
    this.show('is-success', strings.t('result.completed'), definition, [lines, facts]);
  }

  showFailed(definition: MissionDefinition, reason: MissionFailureReason, reputationLost: number): void {
    const document = this.overlay.ownerDocument;
    const why = element(document, 'p', 'result-dialog__reason', this.strings.t(`result.reason.${reason}`));
    const lines = element(document, 'dl', 'result-dialog__lines');
    const row = element(document, 'div', 'result-dialog__line is-penalty');
    row.append(element(document, 'dt', '', this.strings.t('result.reputation')), element(document, 'dd', '', `−${reputationLost}`));
    lines.append(row);
    this.show('is-failure', this.strings.t('result.failed'), definition, [why, lines]);
  }

  /** Adds the level-up banner to the open result. */
  showLevelUp(level: number): void {
    const banner = element(
      this.overlay.ownerDocument,
      'p',
      'result-dialog__level-up',
      this.strings.t('result.levelUp', { level, name: this.strings.t(`company.levelName.${level}`) }),
    );
    this.panel.insertBefore(banner, this.panel.lastElementChild);
  }

  hide(): void {
    this.overlay.hidden = true;
  }

  dispose(): void {
    this.overlay.remove();
  }

  private show(outcome: string, title: string, definition: MissionDefinition, body: HTMLElement[]): void {
    const { strings } = this;
    const document = this.overlay.ownerDocument;
    this.panel.className = `panel result-dialog__panel ${outcome}`;
    this.panel.replaceChildren(
      element(document, 'h2', 'panel__title', title),
      element(document, 'p', 'result-dialog__mission', `${strings.missionTitle(definition.id)} · ${routeText(strings, definition)}`),
      ...body,
      button(document, 'button--primary', strings.t('result.continue'), 'continue', () => {
        this.hide();
        this.onContinue();
      }),
    );
    this.overlay.hidden = false;
  }
}
