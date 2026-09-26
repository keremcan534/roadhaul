import { element } from '../dom';
import { DOCK_TABS, type DockTab, type HqTab } from '../hq/hqTabs';
import type { Strings } from '../i18n';
import { icon, type IconName } from '../icons';

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
  private shownBusy: boolean | null = null;

  constructor(parent: HTMLElement, strings: Strings, onOpen: (tab: HqTab) => void) {
    const document = parent.ownerDocument;
    this.root = element(document, 'nav', 'hud-dock');
    this.root.setAttribute('aria-label', strings.t('dock.label'));
    this.root.hidden = true;
    const buttons = DOCK_TABS.map((tab) => {
      const node = element(document, 'button', `hud-dock__button hud-dock__button--${tab}`);
      node.type = 'button';
      node.dataset.action = `dock-${tab}`;
      node.dataset.tab = tab;
      node.setAttribute('aria-label', strings.t(`dock.${tab}`));
      node.append(icon(document, TAB_ICONS[tab], 'hud-dock__icon'), element(document, 'span', 'hud-dock__label', strings.t(`dock.${tab}`)));
      node.addEventListener('click', () => onOpen(tab));
      return node;
    });
    this.jobsButton = buttons[DOCK_TABS.indexOf('jobs')]!;
    this.root.append(...buttons);
    parent.append(this.root);
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
  }

  dispose(): void {
    this.root.remove();
  }
}
