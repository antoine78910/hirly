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
  const { user } = useAuth() as unknown as { user?: { user_id?: unknown } | null };

  useEffect(() => {
    capturePostHogPageview(pathname);
  }, [pathname]);

  useEffect(() => {
    const nextUserId = typeof user?.user_id === "string" ? user.user_id : null;
    if (nextUserId) identifyPostHogUser(nextUserId);
    else resetPostHog();
  }, [user?.user_id]);

  useEffect(() => {
    syncPostHogReplay();
  }, []);

  return null;
}
