import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

import { useAuth } from "@/context/AuthContext";
import {
  capturePostHogPageview,
  identifyPostHogUser,
  resetPostHog,
  syncPostHogReplay,
} from "@/lib/posthogClient";

export default function PostHogLifecycle() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const previousPath = useRef<string | null>(null);
  const previousUserId = useRef<string | null>(null);

  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    capturePostHogPageview(pathname);
  }, [pathname]);

  useEffect(() => {
    const nextUserId = typeof user?.user_id === "string" ? user.user_id : null;
    if (previousUserId.current === nextUserId) return;
    if (previousUserId.current) resetPostHog();
    previousUserId.current = nextUserId;
    if (nextUserId) identifyPostHogUser(nextUserId);
  }, [user?.user_id]);

  useEffect(() => {
    syncPostHogReplay();
  }, []);

  return null;
}
