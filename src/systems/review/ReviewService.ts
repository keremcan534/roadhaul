import type { EventBus, Unsubscribe } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import type { KeyValueStorage } from '../../core/storage/KeyValueStorage';
import type { Clock } from '../../core/time/Clock';
import type { GameConfig } from '../../data/config/GameConfig';
import { afterAsk, afterDelivery, parseReviewHistory, reviewDue, type ReviewHistory } from '../../domain/review/reviewRules';
import type { GameEvents } from '../GameEvents';

/** The store's own rating sheet (Google Play's in-app review), or none (a browser). */
export interface StoreReview {
  /** False where there is no store to rate the game in. */
  readonly enabled: boolean;
  /** Asks the store to show its sheet; the store decides whether it does, and never says. */
  request(): Promise<void>;
}

export const NO_STORE_REVIEW: StoreReview = Object.freeze({ enabled: false, request: () => Promise.resolve() });

const HISTORY_KEY = 'roadhaul.review';

/**
 * Asks the player to rate the game, at a good moment (GameConfig.review):
 * as a delivery's result closes, once a few deliveries in a row have
 * arrived in good order, seldom and only a few times ever. The sheet is the
 * store's own (Google Play limits it further); the game never sees what the
 * player chose and offers nothing for it. What it remembers stays on the
 * phone, out of the save.
 */
export class ReviewService {
  private store: StoreReview = NO_STORE_REVIEW;
  private history: ReviewHistory;
  private readonly unsubscribe: Unsubscribe;

  constructor(
    private readonly rules: GameConfig['review'],
    private readonly clock: Clock,
    private readonly storage: KeyValueStorage,
    events: EventBus<GameEvents>,
    private readonly logger: Logger,
  ) {
    this.history = this.load();
    this.unsubscribe = events.on('MissionCompleted', ({ cargoDamage }) => {
      this.history = afterDelivery(this.history, cargoDamage, this.rules);
      this.keep();
    });
  }

  /** The store, once it is up (the Android app). */
  attach(store: StoreReview): void {
    this.store = store;
  }

  /** Asks for a rating if one is due now (between contracts). */
  async askIfDue(): Promise<void> {
    if (!this.store.enabled || !reviewDue(this.history, this.clock.now(), this.rules)) {
      return;
    }
    this.history = afterAsk(this.history, this.clock.now());
    this.keep();
    this.logger.info(`Asking for a rating (${this.history.asks}).`);
    try {
      await this.store.request();
    } catch (error) {
      this.logger.warn('The rating sheet failed.', error);
    }
  }

  dispose(): void {
    this.unsubscribe();
  }

  private load(): ReviewHistory {
    try {
      const stored = this.storage.getItem(HISTORY_KEY);
      return parseReviewHistory(stored === null ? null : JSON.parse(stored));
    } catch {
      return parseReviewHistory(null);
    }
  }

  private keep(): void {
    try {
      this.storage.setItem(HISTORY_KEY, JSON.stringify(this.history));
    } catch (error) {
      this.logger.warn('Could not keep the rating history.', error);
    }
  }
}
