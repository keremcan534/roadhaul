/** How a rewarded ad went: watched to the end (the reward is due), closed early, or none to show. */
export type RewardedOutcome = 'rewarded' | 'skipped' | 'unavailable';

/**
 * Ads (spec §35–36), behind an interface so gameplay never talks to an ad SDK: the Android app's AdMob
 * (platform/native/admobAds.ts), a simulated one for development and tests (platform/browser/simulatedAds.ts), or
 * none (NO_ADS: the web game, and builds without ads). Only MonetizationService uses it.
 */
export interface AdService {
  /** Whether this build shows ads at all. */
  readonly enabled: boolean;
  /** Whether a rewarded ad is loaded and can show now. */
  rewardedReady(): boolean;
  /** Shows a rewarded ad; resolves when it closes. */
  showRewarded(): Promise<RewardedOutcome>;
  /** Shows an interstitial if one is loaded; resolves when it closes (at once without one): whether one showed. */
  showInterstitial(): Promise<boolean>;
  /**
   * Whether the player must be able to change their ad privacy choices (consent in the EEA and the UK): Settings then
   * offers the form.
   */
  privacyOptionsRequired(): boolean;
  showPrivacyOptions(): Promise<void>;
}

/** No ads: the web game, and every build until ads are switched on (docs/RELEASE.md). */
export const NO_ADS: AdService = Object.freeze({
  enabled: false,
  rewardedReady: () => false,
  showRewarded: () => Promise.resolve<RewardedOutcome>('unavailable'),
  showInterstitial: () => Promise.resolve(false),
  privacyOptionsRequired: () => false,
  showPrivacyOptions: () => Promise.resolve(),
});
