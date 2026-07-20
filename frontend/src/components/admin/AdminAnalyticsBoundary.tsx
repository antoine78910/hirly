import type { ReactNode } from "react";
import { Database, ExternalLink, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";

import AdminShell from "./AdminShell";

interface AdminAnalyticsBoundaryProps {
  children: ReactNode;
}

function flagEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function allowedPostHogHost(hostname: string): boolean {
  if (hostname === "posthog.com" || hostname.endsWith(".posthog.com")) {
    return true;
  }
  const configuredHost = process.env.REACT_APP_POSTHOG_HOST?.trim();
  if (!configuredHost) return false;
  try {
    return new URL(configuredHost).hostname === hostname;
  } catch {
    return false;
  }
}

export function validatedAdminPostHogUrl(
  value: string | undefined,
): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !allowedPostHogHost(url.hostname)
    ) {
      return null;
    }
    for (const key of url.searchParams.keys()) {
      if (/(?:api[_-]?)?(?:key|token)|secret|password|authorization/i.test(key)) {
        return null;
      }
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function adminPostHogMigrationEnabled(): boolean {
  return flagEnabled(process.env.REACT_APP_ADMIN_POSTHOG_ANALYTICS_ENABLED);
}

export default function AdminAnalyticsBoundary({
  children,
}: AdminAnalyticsBoundaryProps) {
  const dashboardUrl = validatedAdminPostHogUrl(
    process.env.REACT_APP_POSTHOG_ADMIN_DASHBOARD_URL,
  );
  if (!adminPostHogMigrationEnabled() || !dashboardUrl) {
    return <>{children}</>;
  }

  return (
    <AdminShell
      title="Analytics"
      subtitle="Behavioral analytics migrated; operational controls remain database-backed."
    >
      <div className="space-y-6">
        <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="rounded-full bg-emerald-50 p-3 text-emerald-700">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-xl font-bold text-zinc-900">
                Open role-restricted PostHog analytics
              </h2>
              <p className="mt-2 max-w-3xl text-sm text-zinc-600">
                Product funnels, engagement, retention, and revenue analysis are
                available in the role-restricted PostHog workspace.
              </p>
              <a
                className="mt-5 inline-flex items-center gap-2 rounded-lg bg-linkedin px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
                href={dashboardUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                Open PostHog
                <ExternalLink className="h-4 w-4" />
              </a>
              <p className="mt-3 text-xs text-zinc-500">
                Access is enforced by PostHog workspace membership. Hirly does not
                embed or proxy this dashboard and sends no personal API key.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="rounded-full bg-zinc-100 p-3 text-zinc-700">
              <Database className="h-6 w-6" />
            </div>
            <div>
              <h2 className="font-display text-lg font-bold text-zinc-900">
                Operational admin remains in Hirly
              </h2>
              <p className="mt-2 text-sm text-zinc-600">
                User details, billing and account controls, fulfillment repair,
                attention queues, and canonical database writers are unchanged.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                {[
                  { label: "Open operational overview", to: "/admin/overview" },
                  {
                    label: "Open application operations",
                    to: "/admin/applications",
                  },
                  { label: "Open user operations", to: "/admin/users" },
                ].map((link) => (
                  <Link
                    className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
                    key={link.to}
                    to={link.to}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </AdminShell>
  );
}
