import { button, element, setText } from '../dom';
import type { Strings } from '../i18n';

/** What the coach HUD reads (CoachLineService). */
export interface CoachHudSource {
  readonly active: boolean;
  readonly stage: 'none' | 'atStop' | 'driving';
  /** The stop the coach is at or driving to (0: the station). */
  readonly stopIndex: number;
  readonly line: { readonly stops: readonly { readonly cityId: string | null; readonly placeId: string | null }[] } | null;
  readonly onBoard: number;
  readonly seats: number;
  readonly comfort: number;
  /** Driving: seconds until the next stop is due (negative: late). At a stop: seconds until the doors close. */
  readonly secondsLeft: number;
  readonly lastStop: { readonly off: number; readonly on: number };
}

/** It redraws at most this often, s; the DOM only where a shown value changed. */
const REFRESH_SECONDS = 0.2;
/** Early or late by no more than this, the timetable says "on time", seconds. */
const ON_TIME_SECONDS = 30;

/**
 * A run of a coach line (CoachLineService): at the top, the next stop (its
 * number and town), the timetable (due in, or how late), the people on board
 * and the ride's comfort, with a button to give the run up; at a stop, how
 * many get off and on while the doors are open.
 */
export class CoachHud {
  private readonly root: HTMLDivElement;
  private readonly stop: HTMLSpanElement;
  private readonly timetable: HTMLSpanElement;
  private readonly people: HTMLSpanElement;
  private readonly comfort: HTMLSpanElement;
  private readonly comfortFill: HTMLSpanElement;
  private readonly doors: HTMLParagraphElement;
  private sinceRefresh = REFRESH_SECONDS;
  private shown = '';

  constructor(
    parent: HTMLElement,
    private readonly strings: Strings,
    private readonly coach: CoachHudSource,
    private readonly distanceMeters: () => number,
    onQuit: () => void,
  ) {
    const document = parent.ownerDocument;
    this.root = element(document, 'div', 'coach-hud');
    this.root.hidden = true;
    const bar = element(document, 'div', 'coach-hud__bar');
    this.stop = element(document, 'span', 'coach-hud__stop');
    this.stop.dataset.value = 'coach-stop';
    this.timetable = element(document, 'span', 'coach-hud__timetable');
    this.timetable.dataset.value = 'coach-timetable';
    this.people = element(document, 'span', 'coach-hud__people');
    this.people.dataset.value = 'coach-people';
    this.comfort = element(document, 'span', 'coach-hud__comfort');
    this.comfort.dataset.value = 'coach-comfort';
    const meter = element(document, 'span', 'coach-hud__meter');
    this.comfortFill = element(document, 'span', 'coach-hud__meter-fill');
    meter.append(this.comfortFill);
    this.comfort.append(meter);
    const quit = button(document, 'button--ghost coach-hud__quit', strings.t('coach.quit'), 'coach-quit', onQuit);
    bar.append(this.stop, this.timetable, this.people, this.comfort, quit);
    this.doors = element(document, 'p', 'coach-hud__doors');
    this.doors.dataset.value = 'coach-doors';
    this.doors.hidden = true;
    this.root.append(bar, this.doors);
    parent.append(this.root);
  }

  /** Per frame: shown while a run is on. Writes the DOM only on a change, five times a second at most. */
  update(deltaSeconds: number): void {
    const coach = this.coach;
    if (this.root.hidden === coach.active) {
      this.root.hidden = !coach.active;
      this.shown = '';
    }
    if (!coach.active) {
      return;
    }
    this.sinceRefresh += deltaSeconds;
    if (this.sinceRefresh < REFRESH_SECONDS) {
      return;
    }
    this.sinceRefresh = 0;
    const { strings } = this;
    const stops = coach.line?.stops ?? [];
    const towns = Math.max(0, stops.length - 1);
    const atStop = coach.stage === 'atStop';
    const seconds = Math.round(coach.secondsLeft);
    const comfort = Math.round(coach.comfort);
    const distance = atStop ? 0 : Math.round(this.distanceMeters() / 10) * 10;
    // What is shown, in one string: the DOM is written only when it changes.
    const key = `${coach.stage}|${coach.stopIndex}|${seconds}|${coach.onBoard}|${comfort}|${distance}`;
    if (key === this.shown) {
      return;
    }
    this.shown = key;
    const cityId = stops[coach.stopIndex]?.cityId ?? null;
    const placeId = stops[coach.stopIndex]?.placeId ?? null;
    // A stop at a place (the charter's stadium) by its name; a town's by the town's; the station's as the station.
    const place = placeId !== null ? strings.t(`place.name.${placeId}`) : cityId === null ? strings.t('coach.station') : strings.cityName(cityId);
    setText(
      this.stop,
      atStop || distance === 0
        ? strings.t('coach.stop', { index: coach.stopIndex, of: towns, place })
        : strings.t('coach.stopAhead', { index: coach.stopIndex, of: towns, place, distance: strings.distance(distance) }),
    );
    if (atStop) {
      setText(this.timetable, strings.t('coach.doorsIn', { seconds: Math.max(0, seconds) }));
      this.timetable.dataset.state = 'stop';
    } else if (seconds >= -ON_TIME_SECONDS) {
      setText(this.timetable, strings.t('coach.dueIn', { time: strings.duration(Math.max(0, seconds)) }));
      this.timetable.dataset.state = seconds > ON_TIME_SECONDS ? 'early' : 'due';
    } else {
      setText(this.timetable, strings.t('coach.late', { time: strings.duration(-seconds) }));
      this.timetable.dataset.state = 'late';
    }
    setText(this.people, strings.t('coach.people', { count: coach.onBoard, seats: coach.seats }));
    this.comfortFill.style.transform = `scaleX(${comfort / 100})`;
    this.comfort.dataset.state = comfort >= 80 ? 'good' : comfort >= 50 ? 'fair' : 'poor';
    this.comfort.setAttribute('aria-label', strings.t('coach.comfort', { comfort }));
    this.doors.hidden = !atStop;
    if (atStop) {
      const { off, on } = coach.lastStop;
      setText(this.doors, coach.stopIndex === 0 ? strings.t('coach.boarding', { on }) : strings.t('coach.doors', { off, on }));
    }
  }
}
