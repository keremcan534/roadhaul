import { element } from '../dom';
import { DOCK_TABS, type DockTab, type HqTab } from '../hq/hqTabs';
import type { Strings } from '../i18n';
import { icon, type IconName } from '../icons';
import { LabelFitter } from '../LabelFitter';

const TAB_ICONS: Readonly<Record<DockTab, IconName>> = {
  jobs: 'jobs',
  truck: 'truck',
  garage: 'garage',
  events: 'events',
};

/**
 * The company's pages from the road: a button for each tab of the company
 * panel (the job board, the truck, the garage and the events), each with its
 * picture and name. Without a contract they sit where the mission HUD would,
 * "take a job" first and lit; with a contract under way the job board's
 * button goes and the others shrink to round buttons out of the driver's way.
 */
export class HudDock {
  private readonly root: HTMLElement;
  private readonly jobsButton: HTMLButtonElement;
  /** Keeps the buttons' names whole in the upright row, where the buttons share its width. */
  private readonly names: LabelFitter;
  private shownBusy: boolean | null = null;

  constructor(parent: HTMLElement, strings: Strings, onOpen: (tab: HqTab) => void) {
    const document = parent.ownerDocument;
    this.root = element(document, 'nav', 'hud-dock');
    this.root.setAttribute('aria-label', strings.t('dock.label'));
    this.root.hidden = true;
    const labels: HTMLElement[] = [];
    const buttons = DOCK_TABS.map((tab) => {
      const node = element(document, 'button', `hud-dock__button hud-dock__button--${tab}`);
      node.type = 'button';
      node.dataset.action = `dock-${tab}`;
      node.dataset.tab = tab;
      node.setAttribute('aria-label', strings.t(`dock.${tab}`));
      const label = element(document, 'span', 'hud-dock__label', strings.t(`dock.${tab}`));
      labels.push(label);
      node.append(icon(document, TAB_ICONS[tab], 'hud-dock__icon'), label);
      node.addEventListener('click', () => onOpen(tab));
      return node;
    });
    this.jobsButton = buttons[DOCK_TABS.indexOf('jobs')]!;
    this.root.append(...buttons);
    parent.append(this.root);
    this.names = new LabelFitter(this.root, labels);
  }

  set visible(visible: boolean) {
    this.root.hidden = !visible;
  }

  /**
   * Whether a contract is under way: the job board's button goes and the rest
   * shrink. Cheap to call every frame: it touches the DOM only on a change.
   */
  set busy(busy: boolean) {
    if (busy === this.shownBusy) {
      return;
    }
    this.shownBusy = busy;
    this.root.dataset.mode = busy ? 'compact' : 'full';
    this.jobsButton.hidden = busy;
    if (!busy) {
      // The names show again, in buttons of another width than the round ones.
      this.names.refit();
    }
  }

  dispose(): void {
    this.names.dispose();
    this.root.remove();
  }
}
