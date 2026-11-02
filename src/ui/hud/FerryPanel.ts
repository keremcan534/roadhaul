import { STOPPED_SPEED_METERS_PER_SECOND } from '../../domain/missions/loadingBay';
import type { GateDefinition } from '../../data/definitions/MapDefinition';
import type { DrivingService } from '../../systems/driving/DrivingService';
import type { MissionService } from '../../systems/missions/MissionService';
import { button, element, setText } from '../dom';
import type { Strings } from '../i18n';

export interface FerryPanelActions {
  /** The player chose to cross to the region gate `gateId` leads to. */
  readonly onTravel: (gate: GateDefinition) => void;
}

/**
 * The ferry terminal's counter (MapDefinition.gates): it opens while the
 * truck stands still at a terminal and offers the crossing to the other
 * region, with the company, its trucks and drivers. With a contract under
 * way it says to finish it first (its depots are on this side). "Not now"
 * closes it until the truck has left the terminal.
 */
export class FerryPanel {
  private readonly root: HTMLDivElement;
  private readonly title: HTMLHeadingElement;
  private readonly note: HTMLParagraphElement;
  private readonly travelButton: HTMLButtonElement;
  private enabled = false;
  private dismissed = false;
  private shownGate: GateDefinition | null = null;

  constructor(
    parent: HTMLElement,
    private readonly strings: Strings,
    private readonly services: { readonly driving: DrivingService; readonly missions: MissionService },
    actions: FerryPanelActions,
  ) {
    const document = parent.ownerDocument;
    this.root = element(document, 'div', 'rest-area-panel ferry-panel');
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.title = element(document, 'h2', 'rest-area-panel__title', '');
    this.note = element(document, 'p', 'ferry-panel__note', '');
    this.travelButton = button(document, 'button--primary rest-area-panel__action', strings.t('ferry.travel'), 'ferry-travel', () => {
      if (this.shownGate !== null) {
        actions.onTravel(this.shownGate);
      }
    });
    const buttons = element(document, 'div', 'rest-area-panel__buttons');
    buttons.append(
      this.travelButton,
      button(document, 'button--ghost rest-area-panel__action', strings.t('ferry.stay'), 'ferry-stay', () => {
        this.dismissed = true;
        this.root.hidden = true;
      }),
    );
    this.root.append(this.title, this.note, buttons);
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
   * Opens or closes the panel as the truck stops at a terminal or leaves it.
   * Call every frame while driving: it touches the DOM only on a change.
   */
  update(): void {
    const { driving } = this.services;
    const gate = this.enabled && driving.isDriving ? driving.world.gateAt(driving.vehicle.x, driving.vehicle.z) : null;
    if (gate === null) {
      this.dismissed = false;
    }
    const open = gate !== null && !this.dismissed && Math.abs(driving.vehicle.speed) < STOPPED_SPEED_METERS_PER_SECOND;
    if (open && (this.root.hidden || gate !== this.shownGate)) {
      this.shownGate = gate;
      const region = this.strings.t(`region.${gate.toMapId}.name`);
      const busy = this.services.missions.active !== null;
      setText(this.title, this.strings.t('ferry.title', { region }));
      setText(this.note, this.strings.t(busy ? 'ferry.busy' : 'ferry.note', { region }));
      this.travelButton.disabled = busy;
      this.root.hidden = false;
    } else if (!open && !this.root.hidden) {
      this.root.hidden = true;
    }
  }

  dispose(): void {
    this.root.remove();
  }
}
