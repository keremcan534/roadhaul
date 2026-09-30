import {
  AdMob,
  AdmobConsentStatus,
  InterstitialAdPluginEvents,
  MaxAdContentRating,
  RewardAdPluginEvents,
  type AdmobConsentInfo,
} from '@capacitor-community/admob';
import type { Logger } from '../../core/logging/Logger';
import type { AdService, RewardedOutcome } from '../../systems/monetization/AdService';

/** The ad units the app shows, and whether they are Google's test ads. */
export interface AdUnits {
  readonly rewarded: string;
  readonly interstitial: string;
  /** Google's test ads: they never pay, and are safe to tap while the game is made and tested. */
  readonly testing: boolean;
}

/** Runs `run` after `ms` and returns what cancels it: the browser's timers in the app, a test's own clock in tests. */
export type Schedule = (run: () => void, ms: number) => () => void;

/** Google's sample ad units: every build shows these until the game's own are set (docs/RELEASE.md). */
export const TEST_AD_UNITS: AdUnits = Object.freeze({
  rewarded: 'ca-app-pub-3940256099942544/5224354917',
  interstitial: 'ca-app-pub-3940256099942544/1033173712',
  testing: true,
});

type AdKind = 'rewarded' | 'interstitial';

/** The consent's "privacy options required" (UMP's PrivacyOptionsRequirementStatus, which the plugin does not export). */
const PRIVACY_OPTIONS_REQUIRED: string = 'REQUIRED';

/** A failed ad is asked for again after this long, then twice as long each time, up to the longest. */
const RETRY_FIRST_MS = 30_000;
const RETRY_LONGEST_MS = 10 * 60_000;
/** The reward can come a moment after the ad closes: the close waits this long for it. */
const REWARD_GRACE_MS = 1000;

/**
 * AdMob in the Android app (@capacitor-community/admob), for MonetizationService. It asks for the consent the law
 * asks for first (Google's consent form, in the EEA and the UK), starts the ads SDK only once ads may be requested,
 * and keeps a rewarded ad and an interstitial loaded, asking again after each is shown or fails to load.
 *
 * The entry point loads this module only in the Android app with ads switched on (ROADHAUL_ADS, docs/RELEASE.md).
 */
export async function admobAds(units: AdUnits, logger: Logger, schedule: Schedule): Promise<AdService> {
  const ads = new AdMobAds(units, logger, schedule);
  await ads.start();
  return ads;
}

class AdMobAds implements AdService {
  readonly enabled = true;
  private readonly loaded: Record<AdKind, boolean> = { rewarded: false, interstitial: false };
  private readonly loading: Record<AdKind, boolean> = { rewarded: false, interstitial: false };
  private readonly retryMs: Record<AdKind, number> = { rewarded: RETRY_FIRST_MS, interstitial: RETRY_FIRST_MS };
  private privacyRequired = false;
  /** The ad on the screen, told what happens to it; null when none is. */
  private rewardedShowing: ((event: 'rewarded' | 'closed' | 'failed') => void) | null = null;
  private interstitialShowing: ((shown: boolean) => void) | null = null;

  constructor(
    private readonly units: AdUnits,
    private readonly logger: Logger,
    private readonly schedule: Schedule,
  ) {}

  async start(): Promise<void> {
    await Promise.all([
      AdMob.addListener(RewardAdPluginEvents.Rewarded, () => this.rewardedShowing?.('rewarded')),
      AdMob.addListener(RewardAdPluginEvents.Dismissed, () => this.rewardedShowing?.('closed')),
      AdMob.addListener(RewardAdPluginEvents.FailedToShow, () => this.rewardedShowing?.('failed')),
      AdMob.addListener(InterstitialAdPluginEvents.Dismissed, () => this.interstitialShowing?.(true)),
      AdMob.addListener(InterstitialAdPluginEvents.FailedToShow, () => this.interstitialShowing?.(false)),
    ]);
    if (!(await this.gatherConsent())) {
      this.logger.info('Ads may not be requested (no consent yet): none this time.');
      return;
    }
    await AdMob.initialize({ initializeForTesting: this.units.testing, maxAdContentRating: MaxAdContentRating.ParentalGuidance });
    this.load('rewarded');
    this.load('interstitial');
  }

  rewardedReady(): boolean {
    return this.loaded.rewarded && this.rewardedShowing === null && this.interstitialShowing === null;
  }

  showRewarded(): Promise<RewardedOutcome> {
    if (!this.rewardedReady()) {
      return Promise.resolve('unavailable');
    }
    this.loaded.rewarded = false;
    return new Promise((resolve) => {
      let earned = false;
      let settled = false;
      let cancelGrace: (() => void) | null = null;
      const settle = (outcome: RewardedOutcome): void => {
        if (settled) {
          return;
        }
        settled = true;
        cancelGrace?.();
        this.rewardedShowing = null;
        resolve(outcome);
        this.load('rewarded');
      };
      const onEvent = (event: 'rewarded' | 'closed' | 'failed'): void => {
        if (event === 'rewarded') {
          earned = true;
          if (cancelGrace !== null) {
            settle('rewarded'); // The reward came just after the close.
          }
        } else if (earned) {
          settle('rewarded');
        } else if (event === 'failed') {
          settle('unavailable');
        } else {
          cancelGrace = this.schedule(() => settle('skipped'), REWARD_GRACE_MS);
        }
      };
      this.rewardedShowing = onEvent;
      // Resolves only when the reward is earned; the close and a failure to show come as events.
      AdMob.showRewardVideoAd().then(
        () => onEvent('rewarded'),
        (error: unknown) => {
          this.logger.warn('The rewarded ad did not show.', error);
          onEvent('failed');
        },
      );
    });
  }

  showInterstitial(): Promise<boolean> {
    if (!this.loaded.interstitial || this.rewardedShowing !== null || this.interstitialShowing !== null) {
      return Promise.resolve(false);
    }
    this.loaded.interstitial = false;
    return new Promise((resolve) => {
      const onEnd = (shown: boolean): void => {
        if (this.interstitialShowing !== onEnd) {
          return;
        }
        this.interstitialShowing = null;
        resolve(shown);
        this.load('interstitial');
      };
      this.interstitialShowing = onEnd;
      // Resolves as the ad goes up; the close and a failure to show come as events.
      AdMob.showInterstitial().catch((error: unknown) => {
        this.logger.warn('The interstitial did not show.', error);
        onEnd(false);
      });
    });
  }

  privacyOptionsRequired(): boolean {
    return this.privacyRequired;
  }

  async showPrivacyOptions(): Promise<void> {
    try {
      await AdMob.showPrivacyOptionsForm();
      this.noteConsent(await AdMob.requestConsentInfo());
    } catch (error) {
      this.logger.warn('The ad privacy choices did not open.', error);
    }
  }

  /** Asks for consent where the law wants it (Google's form shows only there): whether ads may be requested. */
  private async gatherConsent(): Promise<boolean> {
    try {
      let consent = await AdMob.requestConsentInfo();
      if (consent.status === AdmobConsentStatus.REQUIRED && consent.isConsentFormAvailable === true) {
        consent = await AdMob.showConsentForm();
      }
      this.noteConsent(consent);
      return consent.canRequestAds;
    } catch (error) {
      this.logger.warn('The ad consent could not be asked for.', error);
      return false;
    }
  }

  private noteConsent(consent: AdmobConsentInfo): void {
    this.privacyRequired = consent.privacyOptionsRequirementStatus === PRIVACY_OPTIONS_REQUIRED;
  }

  /** Loads the next ad of `kind`; after a failure, asks again later, waiting longer each time. */
  private load(kind: AdKind): void {
    if (this.loaded[kind] || this.loading[kind]) {
      return;
    }
    this.loading[kind] = true;
    const options = { adId: this.units[kind], isTesting: this.units.testing, immersiveMode: true };
    const prepared = kind === 'rewarded' ? AdMob.prepareRewardVideoAd(options) : AdMob.prepareInterstitial(options);
    prepared.then(
      () => {
        this.loading[kind] = false;
        this.loaded[kind] = true;
        this.retryMs[kind] = RETRY_FIRST_MS;
      },
      (error: unknown) => {
        this.loading[kind] = false;
        const waitMs = this.retryMs[kind];
        this.retryMs[kind] = Math.min(RETRY_LONGEST_MS, waitMs * 2);
        this.logger.warn(`No ${kind} ad loaded; asking again in ${Math.round(waitMs / 1000)} s.`, error);
        this.schedule(() => this.load(kind), waitMs);
      },
    );
  }
}
