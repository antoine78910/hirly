import { useEffect } from "react";
import { useLocation } from "react-router-dom";

import { useAuth } from "../../context/AuthContext";
import {
  capturePostHogPageview,
  identifyPostHogUser,
  resetPostHog,
  syncPostHogReplay,
} from "../../lib/posthogClient";

export default function PostHogLifecycle() {
  const { pathname } = useLocation();
  const { user } = useAuth() as unknown as {
    user?: {
      analytics_user_id?: unknown;
      email?: unknown;
      name?: unknown;
    } | null;
  };

  useEffect(() => {
    const nextUserId = typeof user?.analytics_user_id === "string" ? user.analytics_user_id : null;
    if (nextUserId) {
      identifyPostHogUser(nextUserId, {
        email: user?.email,
        name: user?.name,
      });
    } else resetPostHog();
  }, [user?.analytics_user_id, user?.email, user?.name]);

  useEffect(() => {
    capturePostHogPageview(pathname);
  }, [pathname]);

  useEffect(() => {
    syncPostHogReplay();
  }, []);

  return null;
}
