import { useFeatureFlagEnabled } from "@posthog/react";

import { isCanonicalAnalyticsUserId } from "../../lib/posthogClient";

export const FEED_V2_ROLLOUT_FLAG_KEY = "feed_v2_rollout";

/**
 * Returns a presentation-only rollout observation. The server remains the
 * authority for feed eligibility and endpoint behavior.
 */
export function useFeedV2RolloutObservation(analyticsUserId: unknown): boolean {
  const enabled = useFeatureFlagEnabled(FEED_V2_ROLLOUT_FLAG_KEY, false);

  return enabled === true && isCanonicalAnalyticsUserId(analyticsUserId);
}
