import { createRouteGuidance } from '../../domain/world/roadRoute';
import type { DrivingService } from '../../systems/driving/DrivingService';
import type { MissionService } from '../../systems/missions/MissionService';
import { element, setText } from '../dom';
import type { Strings } from '../i18n';

/** The HUD redraws at most this often; the DOM is touched only when a shown value changes. */
const REFRESH_INTERVAL_SECONDS = 0.1;
/** Within this distance of the target the HUD tells the driver to stop in the bay. */
const STOP_HINT_METERS = 45;
/** How long the cargo readout flashes after a hit. */
const DAMAGE_FLASH_SECONDS = 1.2;
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The mission part of the HUD (spec §12, §30): where to go (an arrow and the
 * distance by road), the stop-in-the-bay hint and loading progress, the
 * delivery clock and the cargo's condition. The speed readout stays on the
 * touch controls. It reads MissionService and DrivingService and never
 * changes them.
 */
export class MissionHud {
  private readonly root: HTMLDivElement;
  private readonly arrow: SVGSVGElement;
  private readonly distance: HTMLSpanElement;
  private readonly objective: HTMLParagraphElement;
  private readonly hint: HTMLParagraphElement;
  private readonly progress: HTMLDivElement;
  private readonly progressFill: HTMLDivElement;
  private readonly timer: HTMLSpanElement;
  private readonly cargo: HTMLSpanElement;
  private readonly route = createRouteGuidance();
  private sinceRefresh = REFRESH_INTERVAL_SECONDS;
  private flashSeconds = 0;
  private shownArrowDegrees = Number.NaN;
  private shownProgress = -1;
  private enabled = false;

  constructor(
    parent: HTMLElement,
    private readonly strings: Strings,
    private readonly missions: MissionService,
    private readonly driving: DrivingService,
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
    this.hint = element(document, 'p', 'mission-hud__hint');
    this.progress = element(document, 'div', 'mission-hud__progress');
    this.progressFill = element(document, 'div', 'mission-hud__progress-fill');
    this.progress.append(this.progressFill);
    text.append(this.objective, this.hint, this.progress);

    const stats = element(document, 'div', 'mission-hud__stats');
    this.timer = element(document, 'span', 'mission-hud__timer');
    this.cargo = element(document, 'span', 'mission-hud__cargo');
    stats.append(this.timer, this.cargo);

    this.root.append(direction, text, stats);
    parent.append(this.root);
  }

  /** Whether the HUD may show at all (it still hides itself without a mission). */
  set visible(visible: boolean) {
    this.enabled = visible;
    this.sinceRefresh = REFRESH_INTERVAL_SECONDS;
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
    if (mission === null || definition === null || target === null || !this.missions.guide(this.route)) {
      this.root.hidden = true;
      return;
    }
    this.root.hidden = false;
    const strings = this.strings;
    const pickup = target.kind === 'pickup';
    this.root.classList.toggle('is-delivery', !pickup);

    const depot = strings.t('depot.name', { city: strings.cityName(target.depot.cityId) });
    setText(this.objective, strings.t(pickup ? 'hud.pickup' : 'hud.deliver', { depot }));
    setText(this.distance, strings.distance(this.route.distanceMeters));

    // Screen "up" is straight ahead. Headings grow to the left, CSS rotation to the right.
    const truck = this.driving.vehicle;
    const bearing = Math.atan2(this.route.aimX - truck.x, this.route.aimZ - truck.z);
    const degrees = Math.round((((truck.heading - bearing) * 180) / Math.PI) % 360);
    if (degrees !== this.shownArrowDegrees) {
      this.shownArrowDegrees = degrees;
      this.arrow.style.transform = `rotate(${degrees}deg)`;
    }

    const progress = this.missions.handlingProgress;
    const handling = progress > 0;
    this.progress.hidden = !handling;
    if (handling) {
      setText(this.hint, strings.t(pickup ? 'hud.loading' : 'hud.unloading'));
      const percent = Math.round(progress * 100);
      if (percent !== this.shownProgress) {
        this.shownProgress = percent;
        this.progressFill.style.transform = `scaleX(${percent / 100})`;
      }
    } else {
      setText(
        this.hint,
        this.route.distanceMeters < STOP_HINT_METERS ? strings.t(pickup ? 'hud.stopToLoad' : 'hud.stopToUnload') : '',
      );
    }
    this.hint.hidden = this.hint.textContent === '';

    const aboard = !pickup;
    this.timer.hidden = !aboard;
    this.cargo.hidden = !aboard;
    if (aboard) {
      const secondsLeft = definition.timeLimitSeconds - mission.deliverySeconds;
      const late = secondsLeft < 0;
      this.timer.classList.toggle('is-late', late);
      setText(
        this.timer,
        late ? `+${strings.duration(-secondsLeft)} ${strings.t('hud.late')}` : strings.duration(secondsLeft),
      );
      setText(this.cargo, `${strings.t('hud.cargo')} ${strings.percent(1 - mission.cargoDamage)}`);
    }
  }

  dispose(): void {
    this.root.remove();
  }
}
