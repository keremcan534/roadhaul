/** A held screen wake lock (the Screen Wake Lock API's sentinel). */
export interface WakeLockHold {
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

/** What ScreenWake needs of the browser: the Screen Wake Lock API, where there is one. */
export interface ScreenWakeHost {
  readonly wakeLock?: { request(type: 'screen'): Promise<WakeLockHold> };
}

/**
 * Keeps the screen on while the truck is driven (the Screen Wake Lock API):
 * steering by tilting the phone touches nothing, so it would dim and lock
 * mid-drive. The lock goes when the page is hidden; `resume` asks for it
 * again when the page shows. Where the browser has no such API, or refuses,
 * the screen dims as it always does. (In the Android app the activity keeps
 * the screen on itself.)
 */
export class ScreenWake {
  private wanted = false;
  private hold: WakeLockHold | null = null;
  private asking = false;

  constructor(private readonly host: ScreenWakeHost) {}

  /** Whether the screen should stay on now. */
  set keepAwake(on: boolean) {
    if (on === this.wanted) {
      return;
    }
    this.wanted = on;
    if (on) {
      this.ask();
    } else {
      this.let();
    }
  }

  get keepAwake(): boolean {
    return this.wanted;
  }

  /** The page shows again: a lock it lost while hidden is asked for again. */
  resume(): void {
    if (this.wanted) {
      this.ask();
    }
  }

  private ask(): void {
    const wakeLock = this.host.wakeLock;
    if (wakeLock === undefined || this.hold !== null || this.asking) {
      return;
    }
    this.asking = true;
    wakeLock.request('screen').then(
      (hold) => {
        this.asking = false;
        this.hold = hold;
        hold.addEventListener('release', () => {
          if (this.hold === hold) {
            this.hold = null;
          }
        });
        if (!this.wanted) {
          this.let();
        }
      },
      () => {
        // Refused (the page is hidden, a battery saver): the screen may dim.
        this.asking = false;
      },
    );
  }

  private let(): void {
    const hold = this.hold;
    this.hold = null;
    hold?.release().catch(() => {});
  }
}
