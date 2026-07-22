import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

import AdminAnalyticsBoundary, { validatedAdminPostHogUrl } from "./AdminAnalyticsBoundary";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../../lib/analytics", () => ({ trackEvent: jest.fn() }));
jest.mock("./AdminShell", () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
jest.mock(
  "react-router-dom",
  () => ({
    Link: ({
      to,
      children,
      className,
    }: {
      to: string;
      children: ReactNode;
      className?: string;
    }) => (
      <a className={className} href={to}>
        {children}
      </a>
    ),
    useLocation: () => ({ pathname: "/admin/analytics" }),
  }),
  { virtual: true },
);

describe("AdminAnalyticsBoundary", () => {
  let container: HTMLDivElement;
  let root: Root;
  const originalEnvironment = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnvironment };
    delete process.env.REACT_APP_ADMIN_POSTHOG_ANALYTICS_ENABLED;
    delete process.env.REACT_APP_POSTHOG_ADMIN_DASHBOARD_URL;
    delete process.env.REACT_APP_POSTHOG_ADMIN_USERS_URL;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    process.env = { ...originalEnvironment };
  });

  function renderBoundary() {
    act(() => {
      root.render(
        <AdminAnalyticsBoundary>
          <div data-testid="legacy">Legacy analytics</div>
        </AdminAnalyticsBoundary>,
      );
    });
  }

  test("keeps the legacy presentation as the default rollback path", () => {
    renderBoundary();
    expect(container.querySelector("[data-testid=legacy]")).not.toBeNull();
    expect(container.querySelector('a[target="_blank"]')).toBeNull();
  });

  test("replaces product analytics with an external link and operational routes", () => {
    process.env.REACT_APP_ADMIN_POSTHOG_ANALYTICS_ENABLED = "true";
    process.env.REACT_APP_POSTHOG_ADMIN_DASHBOARD_URL =
      "https://eu.posthog.com/project/228425/dashboard/834897";
    renderBoundary();

    expect(container.querySelector("[data-testid=legacy]")).toBeNull();
    const external = container.querySelector<HTMLAnchorElement>('a[target="_blank"]');
    expect(external?.href).toBe("https://eu.posthog.com/project/228425/dashboard/834897");
    expect(external?.rel).toContain("noopener");
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector('a[href="/admin/overview"]')).not.toBeNull();
    expect(container.querySelector('a[href="/admin/applications"]')).not.toBeNull();
  });

  test("fails closed to legacy for unsafe or secret-bearing URLs", () => {
    process.env.REACT_APP_ADMIN_POSTHOG_ANALYTICS_ENABLED = "true";
    for (const value of [
      "javascript:alert(1)",
      "http://eu.posthog.com/project/1",
      "https://evil.example/project/1",
      "https://eu.posthog.com/project/1?api_key=phx_secret",
      "https://user:password@eu.posthog.com/project/1",
    ]) {
      expect(validatedAdminPostHogUrl(value)).toBeNull();
    }
    process.env.REACT_APP_POSTHOG_ADMIN_DASHBOARD_URL =
      "https://eu.posthog.com/project/1?token=secret";
    renderBoundary();
    expect(container.querySelector("[data-testid=legacy]")).not.toBeNull();
  });
});
