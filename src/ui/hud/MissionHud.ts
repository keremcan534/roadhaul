import type { DrivingService } from '../../systems/driving/DrivingService';
import type { MissionService } from '../../systems/missions/MissionService';
import type { NavigationService } from '../../systems/navigation/NavigationService';
import type { RivalService } from '../../systems/rivals/RivalService';
import { element, setText } from '../dom';
import type { Strings } from '../i18n';
import { arrowRotationDegrees } from './arrowRotation';

/** The HUD redraws at most this often; the DOM is touched only when a shown value changes. */
const REFRESH_INTERVAL_SECONDS = 0.1;
/** Within this distance of the target the HUD tells the driver to stop in the bay. */
const STOP_HINT_METERS = 45;
/** How long the cargo readout flashes after a hit. */
const DAMAGE_FLASH_SECONDS = 1.2;
/** Closer to a turn than this, the HUD says to turn now. */
const TURN_NOW_METERS = 30;
/** Turns further away than this are not announced yet. */
const TURN_ANNOUNCE_METERS = 2500;
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Where the HUD learns of a tender's race (RivalService). */
export type RaceSource = Pick<RivalService, 'racing' | 'raceSeconds' | 'colorOf'>;

/**
 * The mission part of the HUD (spec §12, §30, §63): where to go (an arrow
 * towards the route ahead and the distance by road), the next turn, the
 * arrival time, the stop-in-the-bay hint and loading progress, the delivery
 * clock and the cargo's condition, and in a tender, how the race with the
 * rival stands. The speed readout stays on the touch controls. It reads
 * MissionService, NavigationService, DrivingService and RivalService and
 * never changes them.
 */
export class MissionHud {
  private readonly root: HTMLDivElement;
  private readonly arrow: SVGSVGElement;
  private readonly distance: HTMLSpanElement;
  private readonly objective: HTMLParagraphElement;
  private readonly turn: HTMLParagraphElement;
  private readonly turnText: HTMLSpanElement;
  private readonly hint: HTMLParagraphElement;
  private readonly progress: HTMLDivElement;
  private readonly progressFill: HTMLDivElement;
  private readonly timer: HTMLSpanElement;
  private readonly cargo: HTMLSpanElement;
  private readonly eta: HTMLSpanElement;
  private readonly race: HTMLParagraphElement;
  private readonly raceText: HTMLSpanElement;
  private readonly raceFill: HTMLSpanElement;
  private sinceRefresh = REFRESH_INTERVAL_SECONDS;
  private flashSeconds = 0;
  private shownArrowDegrees = Number.NaN;
  private shownProgress = -1;
  /** What the shown texts were built from: they are rebuilt only when these change. */
  private shownTargetKey = '';
  private shownDistanceStep = -1;
  private shownHint = '';
  private shownClock = Number.NaN;
  private shownCargoPercent = -1;
  private shownTurnKind = '';
  private shownTurnStep = -1;
  private shownEta = Number.NaN;
  private shownEtaLate = false;
  /** The race shown: its tender and stage ('' for none), the seconds left and the rival's progress. */
  private shownRaceKey = '';
  private shownRaceClock = Number.NaN;
  private shownRaceProgress = -1;
  private enabled = false;

  constructor(
    parent: HTMLElement,
    private readonly strings: Strings,
    private readonly missions: MissionService,
    private readonly navigation: NavigationService,
    private readonly driving: DrivingService,
    private readonly rivals: RaceSource | null = null,
  ) {
    const document = parent.ownerDocument;
    this.root = element(document, 'div', 'mission-hud');
    this.root.hidden = true;

    const direction = element(document, 'div', 'mission-hud__direction');
    this.arrow = document.createElementNS(SVG_NS, 'svg');
    this.arrow.setAttribute('class', 'mission-hud__arrow');
    this.arrow.setAttribute('viewBox', '0 0 40 40');
    this.arrow.setAttribute('aria-hidden', 'true');
    this.arrow.innerHTML =
      '<circle cx="20" cy="20" r="18"/><path d="M 20 6 L 30 26 L 20 21 L 10 26 Z"/>';
    this.distance = element(document, 'span', 'mission-hud__distance');
    direction.append(this.arrow, this.distance);

    const text = element(document, 'div', 'mission-hud__text');
    this.objective = element(document, 'p', 'mission-hud__objective');
    // The next turn: an arrow (bent right, mirrored for left, or a U) and when to take it.
    this.turn = element(document, 'p', 'mission-hud__turn');
    this.turn.hidden = true;
    const turnIcon = document.createElementNS(SVG_NS, 'svg');
    turnIcon.setAttribute('class', 'mission-hud__turn-icon');
    turnIcon.setAttribute('viewBox', '0 0 24 24');
    turnIcon.setAttribute('aria-hidden', 'true');
    turnIcon.innerHTML =
      '<path class="mission-hud__turn-bend" d="M7 22V12q0-4 4-4h4V3l7 7-7 7v-5h-4v10z"/>' +
      '<path class="mission-hud__turn-back" d="M17 22V9q0-6-6-6T5 9v4H2l5 6 5-6H9V9q0-2 2-2t2 2v13z"/>';
    this.turnText = element(document, 'span', 'mission-hud__turn-text');
    this.turn.append(turnIcon, this.turnText);
    this.hint = element(document, 'p', 'mission-hud__hint');
    this.progress = element(document, 'div', 'mission-hud__progress');
    this.progressFill = element(document, 'div', 'mission-hud__progress-fill');
    this.progress.append(this.progressFill);
    // A tender's race: the rival's colour, how long until it unloads, and how far it has got.
    this.race = element(document, 'p', 'mission-hud__race');
    this.race.hidden = true;
    this.raceText = element(document, 'span', 'mission-hud__race-text');
    const raceBar = element(document, 'span', 'mission-hud__race-bar');
    this.raceFill = element(document, 'span', 'mission-hud__race-fill');
    raceBar.append(this.raceFill);
    this.race.append(element(document, 'span', 'company-swatch'), this.raceText, raceBar);
    text.append(this.objective, this.turn, this.hint, this.progress, this.race);

    const stats = element(document, 'div', 'mission-hud__stats');
    this.timer = element(document, 'span', 'mission-hud__timer');
    this.cargo = element(document, 'span', 'mission-hud__cargo');
    this.eta = element(document, 'span', 'mission-hud__eta');
    stats.append(this.timer, this.cargo, this.eta);

    this.root.append(direction, text, stats);
    parent.append(this.root);
  }

  /** Whether the HUD may show at all (it still hides itself without a mission). */
  set visible(visible: boolean) {
    this.enabled = visible;
    this.sinceRefresh = REFRESH_INTERVAL_SECONDS;
    // Rebuild every text the next time it shows: the language of shown values may be stale.
    this.shownTargetKey = '';
    this.shownDistanceStep = -1;
    this.shownClock = Number.NaN;
    this.shownCargoPercent = -1;
    this.shownTurnKind = '';
    this.shownTurnStep = -1;
    this.shownEta = Number.NaN;
    this.shownRaceKey = '';
    this.shownRaceClock = Number.NaN;
    this.shownRaceProgress = -1;
    if (!visible) {
      this.root.hidden = true;
    }
  }

  /** Flashes the cargo readout after a collision damaged the cargo. */
  flashCargoDamage(): void {
    this.flashSeconds = DAMAGE_FLASH_SECONDS;
    this.root.classList.add('is-damaged');
  }

  /** Per frame. Recomputes at most every 0.1 s and writes the DOM only when something shown changed. */
  update(deltaSeconds: number): void {
    if (this.flashSeconds > 0) {
      this.flashSeconds -= deltaSeconds;
      if (this.flashSeconds <= 0) {
        this.root.classList.remove('is-damaged');
      }
    }
    this.sinceRefresh += deltaSeconds;
    if (!this.enabled || this.sinceRefresh < REFRESH_INTERVAL_SECONDS) {
      return;
    }
    this.sinceRefresh = 0;

    const mission = this.missions.active;
    const definition = this.missions.activeDefinition;
    const target = this.missions.target;
    const navigation = this.navigation;
    if (mission === null || definition === null || target === null || !navigation.hasRoute) {
      this.root.hidden = true;
      return;
    }
    this.root.hidden = false;
    const strings = this.strings;
    const pickup = target.kind === 'pickup';

    // Texts are rebuilt only when what they show changes, so steady driving allocates nothing here.
    const targetKey = pickup ? target.depot.id : `>${target.depot.id}`;
    if (targetKey !== this.shownTargetKey) {
      this.shownTargetKey = targetKey;
      this.root.classList.toggle('is-delivery', !pickup);
      const depot = strings.t('depot.name', { city: strings.cityName(target.depot.cityId) });
      setText(this.objective, strings.t(pickup ? 'hud.pickup' : 'hud.deliver', { depot }));
      this.timer.hidden = pickup;
      this.cargo.hidden = pickup;
      this.shownHint = '\u0000'; // Force the hint to refresh for the new target.
    }
    const distanceStep = Math.round(navigation.distanceMeters / 5);
    if (distanceStep !== this.shownDistanceStep) {
      this.shownDistanceStep = distanceStep;
      setText(this.distance, strings.distance(navigation.distanceMeters));
    }
    this.updateTurn();

    const truck = this.driving.vehicle;
    const degrees = Math.round(arrowRotationDegrees(truck.x, truck.z, truck.heading, navigation.aimX, navigation.aimZ));
    if (degrees !== this.shownArrowDegrees) {
      this.shownArrowDegrees = degrees;
      this.arrow.style.transform = `rotate(${degrees}deg)`;
    }

    const progress = this.missions.handlingProgress;
    const handling = progress > 0;
    const hint = handling
      ? pickup
        ? 'hud.loading'
        : 'hud.unloading'
      : navigation.distanceMeters < STOP_HINT_METERS
        ? pickup
          ? 'hud.stopToLoad'
          : 'hud.stopToUnload'
        : '';
    if (hint !== this.shownHint) {
      this.shownHint = hint;
      setText(this.hint, hint === '' ? '' : strings.t(hint));
      this.hint.hidden = hint === '';
      this.progress.hidden = !handling;
    }
    if (handling) {
      const percent = Math.round(progress * 100);
      if (percent !== this.shownProgress) {
        this.shownProgress = percent;
        this.progressFill.style.transform = `scaleX(${percent / 100})`;
      }
    }

    const secondsLeft = definition.timeLimitSeconds - mission.deliverySeconds;
    const eta = Math.ceil(navigation.etaSeconds);
    const etaLate = !pickup && navigation.etaSeconds > secondsLeft;
    if (eta !== this.shownEta || etaLate !== this.shownEtaLate) {
      this.shownEta = eta;
      this.shownEtaLate = etaLate;
      this.eta.classList.toggle('is-late', etaLate);
      setText(this.eta, strings.t('hud.eta', { time: strings.duration(navigation.etaSeconds) }));
    }

    this.updateRace(mission.state);

    if (!pickup) {
      const clock = Math.ceil(secondsLeft);
      if (clock !== this.shownClock) {
        this.shownClock = clock;
        const late = secondsLeft < 0;
        this.timer.classList.toggle('is-late', late);
        setText(
          this.timer,
          late ? `+${strings.duration(-secondsLeft)} ${strings.t('hud.late')}` : strings.duration(secondsLeft),
        );
      }
      const cargoPercent = Math.round((1 - mission.cargoDamage) * 100);
      if (cargoPercent !== this.shownCargoPercent) {
        this.shownCargoPercent = cargoPercent;
        setText(this.cargo, `${strings.t('hud.cargo')} ${strings.percent(1 - mission.cargoDamage)}`);
      }
    }
  }

  /** How the race for a tender stands: waiting for the load, the rival's time left, or lost. */
  private updateRace(state: string): void {
    const race = this.rivals?.racing ?? null;
    const missionId = this.missions.active?.missionId;
    if (race === null || race.contract.id !== missionId) {
      if (this.shownRaceKey !== '') {
        this.shownRaceKey = '';
        this.race.hidden = true;
      }
      return;
    }
    const started = state === 'loaded' || state === 'delivering';
    const elapsed = this.rivals!.raceSeconds();
    const left = race.rivalSeconds - elapsed;
    const stage = !started ? 'waiting' : left > 0 ? 'running' : 'lost';
    const key = `${race.contract.id}:${stage}`;
    const strings = this.strings;
    if (key !== this.shownRaceKey) {
      this.shownRaceKey = key;
      this.shownRaceClock = Number.NaN;
      this.race.hidden = false;
      this.race.dataset.stage = stage;
      // The rival's colour and name: the line itself is short, to fit beside the arrival time.
      const color = this.rivals!.colorOf(race.rivalId);
      this.race.style.setProperty('--company-color', color === null ? '' : `#${color.toString(16).padStart(6, '0')}`);
      this.race.title = strings.rivalName(race.rivalId);
      if (stage !== 'running') {
        setText(this.raceText, strings.t(stage === 'waiting' ? 'hud.race.waiting' : 'hud.race.lost'));
      }
    }
    if (stage === 'running') {
      const clock = Math.ceil(left);
      if (clock !== this.shownRaceClock) {
        this.shownRaceClock = clock;
        setText(this.raceText, strings.t('hud.race.running', { time: strings.duration(left) }));
      }
    }
    const progress = Math.round(Math.min(1, elapsed / race.rivalSeconds) * 100);
    if (progress !== this.shownRaceProgress) {
      this.shownRaceProgress = progress;
      this.raceFill.style.transform = `scaleX(${progress / 100})`;
    }
  }

  /** The next turn and how far to it; hidden when the next thing is arriving. */
  private updateTurn(): void {
    const manoeuvre = this.navigation.manoeuvre;
    const announce = manoeuvre.kind !== 'arrive' && manoeuvre.distanceMeters < TURN_ANNOUNCE_METERS;
    const now = manoeuvre.distanceMeters < TURN_NOW_METERS;
    const kind = announce ? manoeuvre.kind : '';
    // Rebuild the text only when the turn or its rounded distance changes.
    const step = !announce || manoeuvre.kind === 'turnAround' || now ? -2 : Math.round(manoeuvre.distanceMeters / 10);
    if (kind === this.shownTurnKind && step === this.shownTurnStep) {
      return;
    }
    this.shownTurnKind = kind;
    this.shownTurnStep = step;
    this.turn.hidden = !announce;
    if (!announce) {
      return;
    }
    this.turn.dataset.turn = manoeuvre.kind;
    const strings = this.strings;
    const distance = strings.distance(manoeuvre.distanceMeters);
    switch (manoeuvre.kind) {
      case 'left':
        setText(this.turnText, now ? strings.t('nav.leftNow') : strings.t('nav.left', { distance }));
        break;
      case 'right':
        setText(this.turnText, now ? strings.t('nav.rightNow') : strings.t('nav.right', { distance }));
        break;
      case 'turnAround':
        setText(this.turnText, strings.t('nav.turnAround'));
        break;
      case 'arrive':
        break;
    }
  }

  dispose(): void {
    this.root.remove();
  }
}
