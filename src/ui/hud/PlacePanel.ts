import type { PlaceDefinition } from '../../data/definitions/MapDefinition';
import type { Credits } from '../../data/units';
import { button, element, setText } from '../dom';
import type { Strings } from '../i18n';

/** What the panel reads of the places (PlaceService). */
export interface PlacePanelSource {
  readonly current: PlaceDefinition | null;
  readonly puzzleSolvedToday: boolean;
  readonly washedToday: boolean;
  /** Street races left today at the race clubs. */
  readonly racesLeftToday: number;
}

/** Whether a contract is under way (no racing with cargo), and the name of where a club's races finish. */
export interface PlacePanelRaces {
  readonly contractUnderWay: boolean;
  /** The town a race club's races run to, by name. */
  finishName(place: PlaceDefinition): string;
}

/** What the panel's buttons do. */
export interface PlacePanelActions {
  /** The diner: the day's Yard Jam, or one for fun once it is solved. */
  readonly onPuzzle: () => void;
  /** The truck wash: the scrub. */
  readonly onWash: () => void;
  /** The lookout: a photo of the view. */
  readonly onPhoto: () => void;
  /** The race club: a street race. */
  readonly onRace: () => void;
}

/** What the day's puzzle and the wash pay, for the panel's lines. */
export interface PlaceRewards {
  readonly puzzleCredits: Credits;
  readonly washCredits: Credits;
}

/**
 * The counter of a place to visit (MapDefinition.places): its name and kind,
 * what there is to do and what it pays today, a button for it, and Continue.
 * It opens while the truck stands still on the place's lot (PlaceService
 * `current`); Continue closes it until the truck has left. Call update()
 * every frame while driving: it touches the DOM only when it opens, closes
 * or what it says changes.
 */
export class PlacePanel {
  private readonly root: HTMLDivElement;
  private readonly name: HTMLHeadingElement;
  private readonly kind: HTMLParagraphElement;
  private readonly line: HTMLParagraphElement;
  private readonly action: HTMLButtonElement;
  private enabled = false;
  /** Continue was pressed at this place: stay closed until the truck leaves it. */
  private dismissedAt: PlaceDefinition | null = null;
  private shown: PlaceDefinition | null = null;
  /** What the shown lines were written for: done today (or for a race club, whether it can race and how many left). */
  private shownDone: boolean | number = false;

  constructor(
    parent: HTMLElement,
    private readonly strings: Strings,
    private readonly places: PlacePanelSource,
    private readonly rewards: PlaceRewards,
    private readonly actions: PlacePanelActions,
    private readonly races: PlacePanelRaces,
  ) {
    const document = parent.ownerDocument;
    this.root = element(document, 'div', 'place-panel');
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.name = element(document, 'h2', 'place-panel__name');
    this.kind = element(document, 'p', 'place-panel__kind');
    this.line = element(document, 'p', 'place-panel__line');
    this.action = button(document, 'button--primary place-panel__action', '', 'place-action', () => this.act());
    const buttons = element(document, 'div', 'place-panel__buttons');
    buttons.append(
      this.action,
      button(document, 'button--ghost place-panel__continue', strings.t('rest.continue'), 'place-continue', () => {
        this.dismissedAt = this.places.current;
        this.root.hidden = true;
      }),
    );
    this.root.append(this.kind, this.name, this.line, buttons);
    parent.append(this.root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Off while not driving (menus, pause, a game open). Cheap to set every frame: it acts only on a change. */
  set visible(visible: boolean) {
    if (visible === this.enabled) {
      return;
    }
    this.enabled = visible;
    if (!visible) {
      this.root.hidden = true;
      this.shown = null;
    }
  }

  update(): void {
    const place = this.enabled ? this.places.current : null;
    if (place !== this.dismissedAt) {
      this.dismissedAt = null;
    }
    const open = place !== null && place !== this.dismissedAt;
    if (!open) {
      if (!this.root.hidden) {
        this.root.hidden = true;
      }
      this.shown = null;
      return;
    }
    const done = this.doneToday(place);
    if (place !== this.shown || done !== this.shownDone) {
      this.shown = place;
      this.shownDone = done;
      this.write(place, done);
    }
    if (this.root.hidden) {
      this.root.hidden = false;
    }
  }

  dispose(): void {
    this.root.remove();
  }

  /** What the lines depend on: done today, or for a race club its races left (−1 with a contract under way). */
  private doneToday(place: PlaceDefinition): boolean | number {
    if (place.kind === 'raceClub') {
      return this.races.contractUnderWay ? -1 : this.places.racesLeftToday;
    }
    return place.kind === 'diner' ? this.places.puzzleSolvedToday : place.kind === 'truckWash' ? this.places.washedToday : false;
  }

  /** The place's name, kind, what there is to do and its button. */
  private write(place: PlaceDefinition, done: boolean | number): void {
    const { strings, rewards } = this;
    this.root.dataset.kind = place.kind;
    setText(this.name, strings.t(`place.name.${place.id}`));
    setText(this.kind, strings.t(`place.kind.${place.kind}`));
    switch (place.kind) {
      case 'diner':
        setText(this.line, done ? strings.t('place.diner.done') : strings.t('place.diner.line', { credits: strings.money(rewards.puzzleCredits) }));
        setText(this.action, strings.t(done ? 'place.diner.playAgain' : 'place.diner.play'));
        break;
      case 'truckWash':
        setText(this.line, done ? strings.t('place.wash.done') : strings.t('place.wash.line', { credits: strings.money(rewards.washCredits) }));
        setText(this.action, strings.t('place.wash.start'));
        break;
      case 'lookout':
        setText(this.line, strings.t(`place.view.${place.id}`));
        setText(this.action, strings.t('place.lookout.photo'));
        break;
      case 'raceClub':
        setText(
          this.line,
          done === -1
            ? strings.t('place.race.contract')
            : done === 0
              ? strings.t('place.race.none')
              : strings.t('place.race.line', { city: this.races.finishName(place), count: Number(done) }),
        );
        setText(this.action, strings.t('place.race.start'));
        break;
    }
    this.action.disabled = place.kind === 'raceClub' && (done === -1 || done === 0);
  }

  private act(): void {
    const place = this.places.current;
    if (place === null) {
      return;
    }
    if (place.kind === 'diner') {
      this.actions.onPuzzle();
    } else if (place.kind === 'truckWash') {
      this.actions.onWash();
    } else if (place.kind === 'raceClub') {
      this.actions.onRace();
    } else {
      this.actions.onPhoto();
    }
  }
}
