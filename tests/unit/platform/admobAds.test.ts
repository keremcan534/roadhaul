import { beforeEach, describe, expect, it, vi } from 'vitest';
import { admobAds as startAds, TEST_AD_UNITS, type Schedule } from '../../../src/platform/native/admobAds';
import { MemoryLogger } from '../../support/MemoryLogger';

/** The AdMob plugin as the test drives it: its events, its consent answers, and its ads' promises. */
const plugin = vi.hoisted(() => {
  const state = {
    listeners: new Map<string, () => void>(),
    consent: {
      status: 'NOT_REQUIRED',
      isConsentFormAvailable: false,
      canRequestAds: true,
      privacyOptionsRequirementStatus: 'NOT_REQUIRED',
    } as Record<string, unknown>,
    afterForm: null as Record<string, unknown> | null,
    calls: [] as string[],
    failLoads: 0,
    /** Settles the rewarded ad's show call: with the reward, or with a refusal. */
    showRewarded: null as { resolve: () => void; reject: (error: Error) => void } | null,
    reset(): void {
      state.listeners.clear();
      state.consent = {
        status: 'NOT_REQUIRED',
        isConsentFormAvailable: false,
        canRequestAds: true,
        privacyOptionsRequirementStatus: 'NOT_REQUIRED',
      };
      state.afterForm = null;
      state.calls = [];
      state.failLoads = 0;
      state.showRewarded = null;
    },
    emit(event: string): void {
      state.listeners.get(event)?.();
    },
  };
  return state;
});

vi.mock('@capacitor-community/admob', async (importActual) => {
  const actual = await importActual<typeof import('@capacitor-community/admob')>();
  const load = (name: string) => () => {
    plugin.calls.push(name);
    if (plugin.failLoads > 0) {
      plugin.failLoads--;
      return Promise.reject(new Error('No fill'));
    }
    return Promise.resolve({ adUnitId: name });
  };
  return {
    ...actual,
    AdMob: {
      addListener: (event: string, listener: () => void) => {
        plugin.listeners.set(event, listener);
        return Promise.resolve({ remove: () => Promise.resolve() });
      },
      requestConsentInfo: () => {
        plugin.calls.push('requestConsentInfo');
        return Promise.resolve(plugin.consent);
      },
      showConsentForm: () => {
        plugin.calls.push('showConsentForm');
        return Promise.resolve(plugin.afterForm ?? plugin.consent);
      },
      showPrivacyOptionsForm: () => {
        plugin.calls.push('showPrivacyOptionsForm');
        return Promise.resolve();
      },
      initialize: () => {
        plugin.calls.push('initialize');
        return Promise.resolve();
      },
      prepareRewardVideoAd: load('prepareRewardVideoAd'),
      prepareInterstitial: load('prepareInterstitial'),
      showRewardVideoAd: () =>
        new Promise<void>((resolve, reject) => {
          plugin.calls.push('showRewardVideoAd');
          plugin.showRewarded = { resolve, reject };
        }),
      showInterstitial: () => {
        plugin.calls.push('showInterstitial');
        return Promise.resolve();
      },
    },
  };
});

const REWARDED = 'onRewardedVideoAdReward';
const REWARDED_CLOSED = 'onRewardedVideoAdDismissed';
const REWARDED_FAILED = 'onRewardedVideoAdFailedToShow';
const INTERSTITIAL_CLOSED = 'interstitialAdDismissed';

/** Lets the plugin's resolved promises run. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn++) {
    await Promise.resolve();
  }
}

/** A clock the test moves: what the ads schedule runs when its time comes. */
const clock = { nowMs: 0, due: [] as { atMs: number; run: () => void; cancelled: boolean }[] };
const schedule: Schedule = (run, ms) => {
  const entry = { atMs: clock.nowMs + ms, run, cancelled: false };
  clock.due.push(entry);
  return () => {
    entry.cancelled = true;
  };
};

async function advance(ms: number): Promise<void> {
  const untilMs = clock.nowMs + ms;
  for (;;) {
    await settle();
    const next = clock.due.filter((entry) => !entry.cancelled && entry.atMs <= untilMs).sort((a, b) => a.atMs - b.atMs)[0];
    if (next === undefined) {
      break;
    }
    clock.due.splice(clock.due.indexOf(next), 1);
    clock.nowMs = next.atMs;
    next.run();
  }
  clock.nowMs = untilMs;
  await settle();
}

const admobAds = () => startAds(TEST_AD_UNITS, new MemoryLogger(), schedule);

describe('admobAds', () => {
  beforeEach(() => {
    plugin.reset();
    clock.nowMs = 0;
    clock.due = [];
  });

  it('asks for consent where it is required, then starts the ads and loads one of each', async () => {
    plugin.consent = {
      status: 'REQUIRED',
      isConsentFormAvailable: true,
      canRequestAds: false,
      privacyOptionsRequirementStatus: 'REQUIRED',
    };
    plugin.afterForm = { status: 'OBTAINED', canRequestAds: true, privacyOptionsRequirementStatus: 'REQUIRED' };

    const ads = await admobAds();
    await settle();

    expect(plugin.calls).toEqual([
      'requestConsentInfo',
      'showConsentForm',
      'initialize',
      'prepareRewardVideoAd',
      'prepareInterstitial',
    ]);
    expect(ads.enabled).toBe(true);
    expect(ads.rewardedReady()).toBe(true);
    expect(ads.privacyOptionsRequired()).toBe(true);
  });

  it('starts no ads without the consent they need', async () => {
    plugin.consent = { status: 'REQUIRED', isConsentFormAvailable: false, canRequestAds: false, privacyOptionsRequirementStatus: 'UNKNOWN' };

    const ads = await admobAds();
    await settle();

    expect(plugin.calls).toEqual(['requestConsentInfo']);
    expect(ads.rewardedReady()).toBe(false);
    expect(await ads.showRewarded()).toBe('unavailable');
    expect(await ads.showInterstitial()).toBe(false);
  });

  it('gives the reward of a rewarded ad watched to its end, then loads the next', async () => {
    const ads = await admobAds();
    await settle();

    const shown = ads.showRewarded();
    expect(ads.rewardedReady()).toBe(false);
    plugin.emit(REWARDED);
    plugin.showRewarded?.resolve();
    plugin.emit(REWARDED_CLOSED);

    expect(await shown).toBe('rewarded');
    await settle();
    expect(plugin.calls.filter((call) => call === 'prepareRewardVideoAd')).toHaveLength(2);
    expect(ads.rewardedReady()).toBe(true);
  });

  it('gives nothing for a rewarded ad closed early, waiting a moment for a late reward', async () => {
    const ads = await admobAds();
    await settle();

    const skipped = ads.showRewarded();
    plugin.emit(REWARDED_CLOSED);
    await advance(1000);
    expect(await skipped).toBe('skipped');

    await settle();
    const late = ads.showRewarded();
    plugin.emit(REWARDED_CLOSED);
    await advance(300);
    plugin.emit(REWARDED);
    expect(await late).toBe('rewarded');
  });

  it('says a rewarded ad that failed to show was unavailable', async () => {
    const ads = await admobAds();
    await settle();

    const failed = ads.showRewarded();
    plugin.emit(REWARDED_FAILED);
    expect(await failed).toBe('unavailable');

    await settle();
    const refused = ads.showRewarded();
    plugin.showRewarded?.reject(new Error('Not prepared'));
    expect(await refused).toBe('unavailable');
  });

  it('shows an interstitial until it closes', async () => {
    const ads = await admobAds();
    await settle();

    let closed = false;
    const shown = ads.showInterstitial().then((result) => {
      closed = true;
      return result;
    });
    await settle();
    expect(closed).toBe(false);
    plugin.emit(INTERSTITIAL_CLOSED);
    expect(await shown).toBe(true);
    await settle();
    expect(plugin.calls.filter((call) => call === 'prepareInterstitial')).toHaveLength(2);
  });

  it('never shows two ads at once', async () => {
    const ads = await admobAds();
    await settle();

    const rewarded = ads.showRewarded();
    expect(await ads.showInterstitial()).toBe(false);
    expect(await ads.showRewarded()).toBe('unavailable');
    plugin.emit(REWARDED_FAILED);
    expect(await rewarded).toBe('unavailable');
  });

  it('asks again for an ad that did not load, waiting longer each time', async () => {
    plugin.failLoads = 3;
    const ads = await admobAds();
    await settle();
    const rewardedLoads = () => plugin.calls.filter((call) => call === 'prepareRewardVideoAd').length;

    expect(rewardedLoads()).toBe(1);
    await advance(30_000);
    expect(rewardedLoads()).toBe(2);
    await advance(59_000);
    expect(rewardedLoads()).toBe(2);
    await advance(1000);
    expect(rewardedLoads()).toBe(3);
    expect(ads.rewardedReady()).toBe(true);
  });

  it('opens the privacy choices and reads the consent again', async () => {
    const ads = await admobAds();
    await ads.showPrivacyOptions();

    expect(plugin.calls.slice(-2)).toEqual(['showPrivacyOptionsForm', 'requestConsentInfo']);
  });
});
