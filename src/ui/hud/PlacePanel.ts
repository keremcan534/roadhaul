import type { PlaceDefinition } from '../../data/definitions/MapDefinition';
import type { Credits } from '../../data/units';
import type { CoachLineKind } from '../../domain/coach/coachLine';
import { MATCH_PHASES, type MatchPhase } from '../../domain/coach/matchDay';
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

/** A coach station's lines, as the panel tells them (CoachLineService). */
export interface PlacePanelCoaches {
  /**
   * The `kind` line from a coach station: the stops it calls at (the
   * intercity line's towns, the city line's shelters), the town named
   * (the intercity line's last, the city line's own) and the timetable's
   * minutes; null for none. The fans' charter: the fans it carries, the
   * stadium's name and the timetable's minutes.
   */
  lineOf(place: PlaceDefinition, kind: CoachLineKind): { readonly stops: number; readonly town: string; readonly minutes: number } | null;
  /** Where the stadiums' day stands: quiet, the fans' charter running, or the match on. */
  readonly matchPhase: MatchPhase;
  /** The match's hours as the panel says them: the charter's first and kick-off ("13:00", "19:00"). */
  readonly charterFrom: string;
  readonly kickOff: string;
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
  /** The coach station: a run of its coach line through the towns, or of its city line. */
  readonly onCoach: (kind: CoachLineKind) => void;
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
  /** A coach station's second line: its city line. */
  private readonly cityLine: HTMLParagraphElement;
  private readonly action: HTMLButtonElement;
  /** A coach station's city line's button. */
  private readonly cityAction: HTMLButtonElement;
  /** A coach station's fans' charter, before a match: its line and button. */
  private readonly charterLine: HTMLParagraphElement;
  private readonly charterAction: HTMLButtonElement;
  private enabled = false;
  /** Continue was pressed at this place: stay closed until the truck leaves it. */
  private dismissedAt: PlaceDefinition | null = null;
  private shown: PlaceDefinition | null = null;
  /** What the shown lines were written for: done today (for a race club whether it can race and how many left; for a coach station −1 with a contract under way). */
  private shownDone: boolean | number = false;

  constructor(
    parent: HTMLElement,
    private readonly strings: Strings,
    private readonly places: PlacePanelSource,
    private readonly rewards: PlaceRewards,
    private readonly actions: PlacePanelActions,
    private readonly races: PlacePanelRaces,
    private readonly coaches: PlacePanelCoaches,
  ) {
    const document = parent.ownerDocument;
    this.root = element(document, 'div', 'place-panel');
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.name = element(document, 'h2', 'place-panel__name');
    this.kind = element(document, 'p', 'place-panel__kind');
    this.line = element(document, 'p', 'place-panel__line');
    this.cityLine = element(document, 'p', 'place-panel__city');
    this.cityLine.dataset.value = 'place-city-line';
    this.cityLine.hidden = true;
    this.action = button(document, 'button--primary place-panel__action', '', 'place-action', () => this.act());
    this.cityAction = button(document, 'button--secondary place-panel__action', strings.t('place.coach.startCity'), 'place-action-city', () =>
      this.actions.onCoach('city'),
    );
    this.cityAction.hidden = true;
    this.charterLine = element(document, 'p', 'place-panel__city place-panel__charter');
    this.charterLine.dataset.value = 'place-charter-line';
    this.charterLine.hidden = true;
    this.charterAction = button(document, 'button--secondary place-panel__action', strings.t('place.coach.startCharter'), 'place-action-charter', () =>
      this.actions.onCoach('charter'),
    );
    this.charterAction.hidden = true;
    const buttons = element(document, 'div', 'place-panel__buttons');
    buttons.append(
      this.action,
      this.cityAction,
      this.charterAction,
      button(document, 'button--ghost place-panel__continue', strings.t('rest.continue'), 'place-continue', () => {
        this.dismissedAt = this.places.current;
        this.root.hidden = true;
      }),
    );
    this.root.append(this.kind, this.name, this.line, this.cityLine, this.charterLine, buttons);
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
    if (place.kind === 'busStation') {
      // The fans' charter shows only in the hours before a match.
      return this.races.contractUnderWay ? -1 : this.coaches.matchPhase === 'charter' ? 2 : 1;
    }
    if (place.kind === 'stadium') {
      return MATCH_PHASES.indexOf(this.coaches.matchPhase);
    }
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
    const station = place.kind === 'busStation';
    this.cityLine.hidden = true;
    this.cityAction.hidden = !station;
    this.charterLine.hidden = true;
    this.charterAction.hidden = true;
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
      case 'busStation': {
        const line = this.coaches.lineOf(place, 'intercity');
        const city = this.coaches.lineOf(place, 'city');
        setText(
          this.line,
          done === -1
            ? strings.t('place.coach.contract')
            : line === null && city === null
              ? strings.t('place.coach.none')
              : line === null
                ? ''
                : strings.t('place.coach.line', { count: line.stops, city: line.town, minutes: line.minutes }),
        );
        if (done !== -1 && city !== null) {
          setText(this.cityLine, strings.t('place.coach.city', { count: city.stops, city: city.town, minutes: city.minutes }));
          this.cityLine.hidden = false;
        }
        setText(this.action, strings.t('place.coach.start'));
        this.action.disabled = done === -1 || line === null;
        this.action.hidden = line === null && city !== null;
        this.cityAction.disabled = done === -1 || city === null;
        this.cityAction.hidden = city === null;
        const charter = done === 2 ? this.coaches.lineOf(place, 'charter') : null;
        if (charter !== null) {
          setText(
            this.charterLine,
            strings.t('place.coach.charter', { count: charter.stops, city: charter.town, minutes: charter.minutes, time: this.coaches.kickOff }),
          );
          this.charterLine.hidden = false;
          this.charterAction.hidden = false;
        }
        return;
      }
      case 'stadium': {
        const phase = MATCH_PHASES[Number(done)] ?? 'quiet';
        setText(this.line, strings.t(`place.stadium.${phase}`, { from: this.coaches.charterFrom, time: this.coaches.kickOff }));
        // Nothing to do at the stadium itself: its fans come by the coach stations' charter.
        this.action.hidden = true;
        return;
      }
    }
    this.action.hidden = false;
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
    } else if (place.kind === 'busStation') {
      this.actions.onCoach('intercity');
    } else if (place.kind === 'stadium') {
      return;
    } else {
      this.actions.onPhoto();
    }
  }
}
