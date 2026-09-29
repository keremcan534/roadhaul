/** A blow shaking the view less than this (CameraRig.shake's strength) is not worth a buzz. */
const LEAST_STRENGTH = 0.1;
/** A buzz lasts this long per unit of strength (a full blow), and at most this long. */
const MILLISECONDS_PER_STRENGTH = 55;
const LONGEST_MILLISECONDS = 80;

/** What Haptics needs of the browser: the Vibration API and whether the page has been touched. */
export interface HapticsHost {
  vibrate?(pattern: number): boolean;
  readonly userActivation?: { readonly hasBeenActive: boolean };
}

/**
 * Short buzzes of the phone when the truck hits something (the Vibration
 * API), as strong as the blow shakes the view. Nothing happens where there is
 * no vibration motor, when the player switched it off (Settings), or before
 * the page was first touched (browsers refuse it then, with a warning).
 */
export class Haptics {
  enabled = true;

  constructor(private readonly host: HapticsHost) {}

  /** A buzz for a blow that shakes the view this hard (0..1.5, CameraRig.shake's strength). */
  pulse(strength: number): void {
    if (!this.enabled || strength < LEAST_STRENGTH || typeof this.host.vibrate !== 'function') {
      return;
    }
    // Browsers without navigator.userActivation get their chance every time.
    if (this.host.userActivation?.hasBeenActive === false) {
      return;
    }
    try {
      this.host.vibrate(Math.round(Math.min(LONGEST_MILLISECONDS, strength * MILLISECONDS_PER_STRENGTH)));
    } catch {
      // Refused (a sandboxed frame): the buzz is only a touch.
    }
  }
}
