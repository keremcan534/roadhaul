import { button, element, setText } from '../dom';
import type { Strings } from '../i18n';

/** What the race HUD reads (RaceService). */
export interface RaceHudSource {
  readonly active: boolean;
  readonly countdownSeconds: number;
  readonly raceSeconds: number;
  readonly position: number;
  readonly field: number;
  readonly metersLeft: number;
  readonly offRoute: boolean;
}

/** It redraws at most this often, s; the DOM only where a shown value changed. */
const REFRESH_SECONDS = 0.1;

/**
 * A street race over the road (RaceService): the lights' countdown big in
 * the middle, then GO; the player's place in the field, the time and the way
 * to the line at the top; a word to come back to the route; and a button to
 * give the race up.
 */
export class RaceHud {
  private readonly root: HTMLDivElement;
  private readonly lights: HTMLDivElement;
  private readonly place: HTMLSpanElement;
  private readonly clock: HTMLSpanElement;
  private readonly left: HTMLSpanElement;
  private readonly warning: HTMLParagraphElement;
  private sinceRefresh = REFRESH_SECONDS;
  private shownLights = '';
  private shownPlace = -1;
  private shownTenths = -1;
  private shownLeft = -1;
  private shownOffRoute = false;
  /** Seconds GO stays up after the start. */
  private goSeconds = 0;

  constructor(
    parent: HTMLElement,
    private readonly strings: Strings,
    private readonly race: RaceHudSource,
    onQuit: () => void,
  ) {
    const document = parent.ownerDocument;
    this.root = element(document, 'div', 'race-hud');
    this.root.hidden = true;
    const bar = element(document, 'div', 'race-hud__bar');
    this.place = element(document, 'span', 'race-hud__place');
    this.place.dataset.value = 'race-place';
    this.clock = element(document, 'span', 'race-hud__clock');
    this.left = element(document, 'span', 'race-hud__left');
    const quit = button(document, 'button--ghost race-hud__quit', strings.t('race.quit'), 'race-quit', onQuit);
    bar.append(this.place, this.clock, this.left, quit);
    this.lights = element(document, 'div', 'race-hud__lights');
    this.lights.dataset.value = 'race-lights';
    this.warning = element(document, 'p', 'race-hud__warning', strings.t('race.offRoute'));
    this.warning.hidden = true;
    this.root.append(bar, this.lights, this.warning);
    parent.append(this.root);
  }

  /** Per frame: shown while a race is on. Writes the DOM only on a change, ten times a second at most. */
  update(deltaSeconds: number): void {
    const race = this.race;
    if (this.root.hidden === race.active) {
      this.root.hidden = !race.active;
      this.shownLights = '\\u0000';
      this.goSeconds = 0;
    }
    if (!race.active) {
      return;
    }
    this.sinceRefresh += deltaSeconds;
    if (this.sinceRefresh < REFRESH_SECONDS) {
      return;
    }
    this.goSeconds += this.sinceRefresh;
    this.sinceRefresh = 0;
    const counting = race.countdownSeconds > 0;
    if (counting) {
      this.goSeconds = 0;
    }
    const lights = counting ? String(Math.ceil(race.countdownSeconds)) : this.goSeconds < 1.2 ? 'go' : '';
    if (lights !== this.shownLights) {
      this.shownLights = lights;
      setText(this.lights, lights === 'go' ? this.strings.t('race.go') : lights);
      this.lights.hidden = lights === '';
      this.lights.dataset.light = lights;
    }
    if (race.position !== this.shownPlace) {
      this.shownPlace = race.position;
      setText(this.place, this.strings.t('race.position', { position: race.position, of: race.field }));
    }
    const tenths = Math.floor(race.raceSeconds * 10);
    if (tenths !== this.shownTenths) {
      this.shownTenths = tenths;
      setText(this.clock, `${this.strings.duration(Math.floor(tenths / 10))}.${tenths % 10}`);
    }
    const left = Math.round(race.metersLeft / 10);
    if (left !== this.shownLeft) {
      this.shownLeft = left;
      setText(this.left, this.strings.t('race.left', { distance: this.strings.distance(race.metersLeft) }));
    }
    if (race.offRoute !== this.shownOffRoute) {
      this.shownOffRoute = race.offRoute;
      this.warning.hidden = !race.offRoute;
    }
  }
}
