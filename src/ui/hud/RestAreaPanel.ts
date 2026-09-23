import { STOPPED_SPEED_METERS_PER_SECOND } from '../../domain/missions/loadingBay';
import type { DrivingService } from '../../systems/driving/DrivingService';
import type { EconomyService } from '../../systems/economy/EconomyService';
import type { DamageService } from '../../systems/vehicles/DamageService';
import type { FuelService } from '../../systems/vehicles/FuelService';
import { button, element, setText } from '../dom';
import type { Strings } from '../i18n';

/** What the panel reads. It only reads them; changes go through the actions. */
export interface RestAreaPanelServices {
  readonly driving: DrivingService;
  readonly fuel: FuelService;
  readonly damage: DamageService;
  readonly economy: EconomyService;
}

export interface RestAreaPanelActions {
  readonly onRefuel: () => void;
  readonly onRepair: () => void;
}

/**
 * The rest area's counter (spec §25: fuel, repair, continue). It opens while
 * the truck stands still on a rest area's lot, and Continue closes it until
 * the truck has left the lot. Prices are those of the pump and workshop.
 */
export class RestAreaPanel {
  private readonly root: HTMLDivElement;
  private readonly refuelButton: HTMLButtonElement;
  private readonly repairButton: HTMLButtonElement;
  private enabled = false;
  /** Continue was pressed: stay closed until the truck leaves the lot. */
  private dismissed = false;

  constructor(
    parent: HTMLElement,
    private readonly strings: Strings,
    private readonly services: RestAreaPanelServices,
    actions: RestAreaPanelActions,
  ) {
    const document = parent.ownerDocument;
    this.root = element(document, 'div', 'rest-area-panel');
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.refuelButton = button(document, 'button--primary rest-area-panel__action', '', 'rest-refuel', actions.onRefuel);
    this.repairButton = button(document, 'button--secondary rest-area-panel__action', '', 'rest-repair', actions.onRepair);
    const buttons = element(document, 'div', 'rest-area-panel__buttons');
    buttons.append(
      this.refuelButton,
      this.repairButton,
      button(document, 'button--ghost rest-area-panel__action', strings.t('rest.continue'), 'rest-continue', () => {
        this.dismissed = true;
        this.root.hidden = true;
      }),
    );
    this.root.append(element(document, 'h2', 'rest-area-panel__title', strings.t('rest.title')), buttons);
    parent.append(this.root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Off while not driving (menus, pause). Cheap to set every frame: it acts only on a change. */
  set visible(visible: boolean) {
    if (visible === this.enabled) {
      return;
    }
    this.enabled = visible;
    if (!visible) {
      this.root.hidden = true;
    }
  }

  /**
   * Opens or closes the panel as the truck stops on or leaves a rest area's
   * lot. Call every frame while driving: it touches the DOM only when the
   * panel opens or closes, and builds no strings.
   */
  update(): void {
    const { driving } = this.services;
    const atRestArea = this.enabled && driving.isDriving && driving.servicePoint?.kind === 'restArea';
    if (!atRestArea) {
      this.dismissed = false;
    }
    const open = atRestArea && !this.dismissed && Math.abs(driving.vehicle.speed) < STOPPED_SPEED_METERS_PER_SECOND;
    if (open && this.root.hidden) {
      this.refresh();
      this.root.hidden = false;
    } else if (!open && !this.root.hidden) {
      this.root.hidden = true;
    }
  }

  /** Redraws the prices (after a purchase). Not per frame. */
  refresh(): void {
    const { fuel, damage, economy } = this.services;
    const strings = this.strings;
    const tankFull = fuel.missingLiters < 0.5;
    this.refuelButton.disabled = tankFull || (economy.credits === 0 && !fuel.isEmpty);
    setText(this.refuelButton, tankFull ? strings.t('hq.tankFull') : strings.t('rest.refuel', { cost: strings.money(fuel.fillUpCost()) }));
    const undamaged = damage.damage <= 0;
    this.repairButton.disabled = undamaged || !economy.canAfford(damage.repairCost);
    setText(this.repairButton, undamaged ? strings.t('hq.noDamage') : strings.t('rest.repair', { cost: strings.money(damage.repairCost) }));
  }

  dispose(): void {
    this.root.remove();
  }
}
