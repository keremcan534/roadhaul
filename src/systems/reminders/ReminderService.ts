import type { Logger } from '../../core/logging/Logger';
import type { KeyValueStorage } from '../../core/storage/KeyValueStorage';
import type { Clock } from '../../core/time/Clock';
import {
  parseReminderPrefs,
  planReminders,
  type Reminder,
  type ReminderPrefs,
  type ReminderRules,
} from '../../domain/reminders/reminderPlan';
import type { DailyStreak } from '../../domain/rewards/dailyReward';

/** Whether the phone lets the game show notifications: allowed, refused, or not asked yet. */
export type NoticePermission = 'granted' | 'denied' | 'prompt';

/** A notification left with the phone, shown at `atMs` whether or not the game runs. */
export interface LocalNotice {
  readonly id: number;
  readonly atMs: number;
  readonly title: string;
  readonly body: string;
}

/** The phone's own notifications (the Android app's local notifications): nothing goes through a server. */
export interface LocalNotifier {
  permission(): Promise<NoticePermission>;
  /** Asks the player (Android 13 and later show the system's question); what they allow. */
  requestPermission(): Promise<NoticePermission>;
  schedule(notices: readonly LocalNotice[]): Promise<void>;
  /** Takes back every notification the game left that has not been shown yet. */
  cancelAll(): Promise<void>;
}

/** A reminder's words, in the player's language (the UI's string tables). */
export type ReminderText = (reminder: Reminder) => { readonly title: string; readonly body: string };

/** The daily reward's streak as saved (DailyRewardService). */
export interface DailyStreakSource {
  snapshot(): DailyStreak;
}

/** When the next free crate is ready (CrateService). */
export interface FreeCrateSource {
  readonly freeCrate: { readonly readyAtMs: number };
}

const PREFS_KEY = 'roadhaul.reminders';

/**
 * The phone's reminders while the game is away (GameConfig.reminders): the daily reward on the days after the player
 * leaves, and the free crate when it comes ready later that day, never more than one a day (planReminders). They are
 * planned as the player leaves (`away`) and taken back as they come back (`back`), so the ones waiting always match
 * the game. Nothing comes until the player says yes, on any phone: "Remind me" on the daily reward (`ask`), or
 * Settings (`setOn`); the phone may still refuse. Only in the Android app (`attach`); what the player chose stays on the phone, out of the
 * save.
 */
export class ReminderService {
  private notifier: LocalNotifier | null = null;
  private text: ReminderText | null = null;
  private allowed: NoticePermission = 'prompt';
  private prefs: ReminderPrefs;
  /** The phone's calls, one after the other: a leave and a return close together keep their order. */
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly rules: ReminderRules,
    private readonly daily: DailyStreakSource,
    private readonly streakDays: number,
    private readonly crates: FreeCrateSource,
    private readonly clock: Clock,
    private readonly localTimeOffsetMinutes: number,
    private readonly storage: KeyValueStorage,
    private readonly logger: Logger,
  ) {
    this.prefs = this.load();
  }

  /** The phone's notifications, once they are up (the Android app), and the words for each reminder. */
  attach(notifier: LocalNotifier, text: ReminderText): Promise<void> {
    this.notifier = notifier;
    this.text = text;
    return this.back();
  }

  /** There are reminders to offer: the Android app. */
  get available(): boolean {
    return this.notifier !== null;
  }

  /** The player wants reminders (Settings). */
  get on(): boolean {
    return this.prefs.on;
  }

  /** Whether to offer "Remind me": the player never chose, and the phone has not refused. */
  get askDue(): boolean {
    return this.notifier !== null && !this.prefs.asked && this.allowed !== 'denied';
  }

  /** The player said yes to "Remind me": the phone asks them too. True when the reminders will come. */
  ask(): Promise<boolean> {
    return this.setOn(true);
  }

  /** Settings: reminders on (the phone asked, if it has not been) or off (any waiting are taken back). */
  setOn(on: boolean): Promise<boolean> {
    this.prefs = { on, asked: true };
    this.keep();
    return this.enqueue(async (notifier) => {
      if (!on) {
        await notifier.cancelAll();
        return false;
      }
      if (this.allowed !== 'granted') {
        this.allowed = await notifier.requestPermission();
        this.logger.info(`Notifications ${this.allowed}.`);
      }
      return this.allowed === 'granted';
    }, false);
  }

  /** The player leaves the game: the reminders are planned from where it stands and left with the phone. */
  away(): Promise<void> {
    return this.enqueue(async (notifier) => {
      await notifier.cancelAll();
      if (!this.prefs.on || this.allowed !== 'granted' || this.text === null) {
        return;
      }
      const text = this.text;
      const planned = planReminders(
        {
          nowMs: this.clock.now(),
          offsetMinutes: this.localTimeOffsetMinutes,
          streak: this.daily.snapshot(),
          streakDays: this.streakDays,
          freeCrateAtMs: this.crates.freeCrate.readyAtMs,
        },
        this.rules,
      );
      await notifier.schedule(planned.map((reminder, index) => ({ id: index + 1, atMs: reminder.atMs, ...text(reminder) })));
    }, undefined);
  }

  /** The player is back: the reminders waiting go (they were for a game left alone), and the phone's answer is read again. */
  back(): Promise<void> {
    return this.enqueue(async (notifier) => {
      this.allowed = await notifier.permission();
      await notifier.cancelAll();
    }, undefined);
  }

  /** Runs `task` with the phone's notifications after the calls before it; `fallback` without them, or if it fails. */
  private enqueue<T>(task: (notifier: LocalNotifier) => Promise<T>, fallback: T): Promise<T> {
    const notifier = this.notifier;
    if (notifier === null) {
      return Promise.resolve(fallback);
    }
    const run = this.queue.then(() => task(notifier)).catch((error: unknown) => {
      this.logger.warn('The reminders could not be set.', error);
      return fallback;
    });
    this.queue = run.then(() => undefined);
    return run;
  }

  private load(): ReminderPrefs {
    try {
      const stored = this.storage.getItem(PREFS_KEY);
      return parseReminderPrefs(stored === null ? null : JSON.parse(stored));
    } catch {
      return parseReminderPrefs(null);
    }
  }

  private keep(): void {
    try {
      this.storage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch (error) {
      this.logger.warn('Could not keep the reminder settings.', error);
    }
  }
}
