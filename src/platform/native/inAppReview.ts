import { InAppReview } from '@capacitor-community/in-app-review';
import type { StoreReview } from '../../systems/review/ReviewService';

/**
 * Google Play's in-app review sheet in the Android app (@capacitor-community/in-app-review), for ReviewService. Play
 * decides whether the sheet shows (it limits how often) and never tells the game what the player did. The entry point
 * loads this module only in the Android app.
 */
export function inAppReview(): StoreReview {
  return { enabled: true, request: () => InAppReview.requestReview() };
}
