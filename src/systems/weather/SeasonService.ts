import type { EventBus } from '../../core/events/EventBus';
import type { Clock } from '../../core/time/Clock';
import type { Season } from '../../data/definitions/Season';
import type { Fraction } from '../../data/units';
import { seasonOf } from '../../domain/calendar/seasons';
import type { GameEvents } from '../GameEvents';

/** The calendar is looked at this often, seconds: a season turns over rarely. */
const CHECK_SECONDS = 10;
/** In winter this much of the ground stays white between snowfalls. */
const WINTER_GROUND_SNOW = 0.7;

/** The season, for what follows it (the weather, how the land looks). */
export interface SeasonSource {
  readonly season: Season;
  /** How much of the ground snow covers whatever the weather, 0..1 (some in winter). */
  readonly groundSnow: Fraction;
}

/**
 * The season: the calendar's (the northern hemisphere's, from the game's
 * Clock: the real date, or `?date=`), unless the player holds one in
 * Settings (hold). Emits SeasonChanged when it turns, either way. Call
 * update() every fixed step; it looks at the calendar every few seconds.
 */
export class SeasonService implements SeasonSource {
  private calendarSeason: Season;
  private heldSeason: Season | null = null;
  private untilCheckSeconds = CHECK_SECONDS;

  constructor(
    private readonly clock: Clock,
    private readonly events: EventBus<GameEvents>,
  ) {
    this.calendarSeason = seasonOf(clock.now());
  }

  get season(): Season {
    return this.heldSeason ?? this.calendarSeason;
  }

  /** The season the player holds, or null while it follows the calendar. */
  get held(): Season | null {
    return this.heldSeason;
  }

  get groundSnow(): Fraction {
    return this.season === 'winter' ? WINTER_GROUND_SNOW : 0;
  }

  /** Holds `season` from now on (it turns at once), or follows the calendar again (null). */
  hold(season: Season | null): void {
    const before = this.season;
    this.heldSeason = season;
    this.announce(before);
  }

  /** Looks at the calendar every few seconds. Allocation-free. */
  update(dt: number): void {
    this.untilCheckSeconds -= dt;
    if (this.untilCheckSeconds > 0) {
      return;
    }
    this.untilCheckSeconds = CHECK_SECONDS;
    const before = this.season;
    this.calendarSeason = seasonOf(this.clock.now());
    this.announce(before);
  }

  private announce(before: Season): void {
    if (this.season !== before) {
      this.events.emit('SeasonChanged', { season: this.season, previous: before });
    }
  }
}
