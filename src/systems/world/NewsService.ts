import type { EventBus, Unsubscribe } from '../../core/events/EventBus';
import type { ContentCatalog } from '../../data/ContentCatalog';
import { PLAYER_COMPANY_ID } from '../../data/definitions/RivalCompanyDefinition';
import type { GameEvents } from '../GameEvents';

/** The most headlines kept: the oldest goes as a new one comes. */
export const NEWS_LIMIT = 20;
/** The quiet days' headlines (`news.flavor.<n>`), from 1. */
export const FLAVOR_HEADLINES = 8;
/** The morning paper comes out at this minute of the day (06:00): two of the quiet days' headlines. */
const MORNING_MINUTE = 6 * 60;
const MORNING_HEADLINES = 2;

/** A headline: its text's key (`news.…`) and what it names, filled in by the interface. */
export interface NewsItem {
  readonly id: number;
  readonly key: string;
  readonly cityId: string | null;
  readonly rivalId: string | null;
  /** A level or a count it tells of; 0 for none. */
  readonly count: number;
  /** The game clock's minute of the day it came at, 0 to 1439. */
  readonly minuteOfDay: number;
  /** Breaking news: something happening near the truck now. */
  readonly breaking: boolean;
}

/** What the news reads the time from: TimeOfDayService. */
export interface NewsClock {
  /** Minutes after midnight, 0 to under 1440. */
  readonly minutes: number;
}

/**
 * The region's paper, the Gazette: headlines from what happens around the
 * company, newest first. The rare happenings near the truck (breaking), the
 * rivals' bosses having their say in their own manner
 * (RivalCompanyDefinition.personality) on a tender won against the company,
 * a city led or a campaign run (the market's plain facts are the rivals
 * page's, RivalService.news), the company's levels, the weather turning and
 * the northern lights; each morning at 06:00 two of the quiet days'
 * headlines about the region's towns. Only what happens while the game
 * runs, not while it was closed; nothing is saved.
 *
 * Call update() every fixed step for the morning paper.
 */
export class NewsService {
  private readonly list: NewsItem[] = [];
  private nextId = 1;
  private lastMinute = -1;
  private readonly unsubscribe: Unsubscribe[];

  constructor(
    private readonly content: ContentCatalog,
    private readonly clock: NewsClock,
    /** Uniform in [0, 1): a seeded generator in tests. */
    private readonly random: () => number,
    private readonly events: EventBus<GameEvents>,
  ) {
    this.unsubscribe = [
      events.on('CityIncidentStarted', ({ kind, cityId }) => this.add(`news.incident.${kind}`, { cityId, breaking: true })),
      events.on('CityIncidentEnded', ({ kind, cityId, caught }) => {
        if (kind === 'building_fire') {
          this.add('news.incidentEnded.building_fire', { cityId });
        } else if (kind === 'police_chase') {
          this.add(`news.incidentEnded.police_chase.${caught ? 'caught' : 'escaped'}`, { cityId });
        }
      }),
      // The market's facts are the rivals page's (RivalService.news); here the rivals' bosses have their say.
      events.on('TenderDecided', ({ rivalId, won }) => {
        if (!won) {
          this.add(`news.tenderLost.${this.personality(rivalId)}`, { rivalId });
        }
      }),
      events.on('CityLeaderChanged', ({ cityId, leaderId, away }) => {
        if (!away && leaderId !== null && leaderId !== PLAYER_COMPANY_ID) {
          this.add(`news.rivalLeads.${this.personality(leaderId)}`, { cityId, rivalId: leaderId });
        }
      }),
      events.on('CampaignRun', ({ companyId, cityId, away }) => {
        if (!away && companyId !== PLAYER_COMPANY_ID) {
          this.add(`news.campaign.${this.personality(companyId)}`, { cityId, rivalId: companyId });
        }
      }),
      events.on('CompanyLevelUp', ({ level }) => this.add('news.levelUp', { count: level })),
      events.on('WeatherChanged', ({ weatherId }) => {
        if (weatherId === 'rain' || weatherId === 'snow') {
          this.add(`news.weather.${weatherId}`, {});
        }
      }),
      events.on('SkyWonderSighted', ({ kind }) => {
        if (kind === 'aurora') {
          this.add('news.aurora', {});
        }
      }),
    ];
  }

  /** The headlines, newest first. */
  get items(): readonly NewsItem[] {
    return this.list;
  }

  /** The newest headline, or null. */
  get latest(): NewsItem | null {
    return this.list[0] ?? null;
  }

  /** Watches the clock: the morning paper at 06:00, and on the first look of a session. Allocation-free otherwise. */
  update(): void {
    const minute = Math.floor(this.clock.minutes);
    const first = this.lastMinute < 0;
    const morning = !first && this.lastMinute < MORNING_MINUTE && minute >= MORNING_MINUTE;
    const wrappedPastMorning = !first && minute < this.lastMinute && minute >= MORNING_MINUTE;
    this.lastMinute = minute;
    if (first || morning || wrappedPastMorning) {
      // On the first look the paper is the morning's: under whatever has happened since the game started.
      this.morningPaper(first);
    }
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribe) {
      unsubscribe();
    }
  }

  private morningPaper(older: boolean): void {
    const cities = this.content.cities.all;
    for (let i = 0; i < MORNING_HEADLINES; i++) {
      const headline = 1 + Math.min(FLAVOR_HEADLINES - 1, Math.floor(this.random() * FLAVOR_HEADLINES));
      const city = cities[Math.min(cities.length - 1, Math.floor(this.random() * cities.length))];
      this.add(`news.flavor.${headline}`, { cityId: city?.id ?? null, older });
    }
  }

  private personality(rivalId: string): string {
    return this.content.rivals.find(rivalId)?.personality ?? 'steady';
  }

  private add(
    key: string,
    about: {
      readonly cityId?: string | null;
      readonly rivalId?: string | null;
      readonly count?: number;
      readonly breaking?: boolean;
      /** Older than what is there: under it, not on top. */
      readonly older?: boolean;
    },
  ): void {
    const item: NewsItem = {
      id: this.nextId++,
      key,
      cityId: about.cityId ?? null,
      rivalId: about.rivalId ?? null,
      count: about.count ?? 0,
      minuteOfDay: Math.floor(this.clock.minutes) % 1440,
      breaking: about.breaking ?? false,
    };
    if (about.older === true) {
      this.list.push(item);
    } else {
      this.list.unshift(item);
    }
    if (this.list.length > NEWS_LIMIT) {
      this.list.length = NEWS_LIMIT;
    }
    this.events.emit('NewsPublished', { item });
  }
}
