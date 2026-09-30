import type { AdService, RewardedOutcome } from '../../systems/monetization/AdService';
import { simulatedSheet } from './simulatedSheet';

/** How long a simulated rewarded ad runs before its reward is earned. */
const REWARDED_MS = 2000;

/**
 * Simulated ads, for development and the end-to-end tests (`?ads=simulated`): a sheet stands in for each ad. A
 * rewarded ad can be skipped at any time, for nothing; after `rewardedMs` its reward is earned and it can be closed
 * with it. An interstitial shows until closed. The ad privacy choices are always offered, so Settings shows them.
 */
export function simulatedAds(document: Document, rewardedMs = REWARDED_MS): AdService {
  let showing = false;
  return {
    enabled: true,
    rewardedReady: () => !showing,
    showRewarded: () =>
      new Promise<RewardedOutcome>((resolve) => {
        showing = true;
        const sheet = simulatedSheet(document, 'Simulated rewarded ad');
        sheet.status.textContent = 'Watch to the end for the reward.';
        const end = (outcome: RewardedOutcome): void => {
          clearTimeout(timer);
          showing = false;
          resolve(outcome);
        };
        sheet.button('Skip', 'skip-ad', () => end('skipped'));
        const timer = setTimeout(() => {
          sheet.root.dataset.rewarded = 'true';
          sheet.status.textContent = 'Reward earned.';
          sheet.button('Close', 'close-ad', () => end('rewarded'));
        }, rewardedMs);
      }),
    showInterstitial: () =>
      new Promise<boolean>((resolve) => {
        showing = true;
        simulatedSheet(document, 'Simulated interstitial ad').button('Close', 'close-ad', () => {
          showing = false;
          resolve(true);
        });
      }),
    privacyOptionsRequired: () => true,
    showPrivacyOptions: () =>
      new Promise<void>((resolve) => {
        simulatedSheet(document, 'Simulated ad privacy choices').button('Close', 'close-ad', resolve);
      }),
  };
}
