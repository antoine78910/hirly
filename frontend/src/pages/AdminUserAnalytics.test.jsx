import { act } from "react";
import { createRoot } from "react-dom/client";

import AdminUserAnalytics from "./AdminUserAnalytics";
import { api } from "../lib/api";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../lib/api", () => ({ api: { get: jest.fn() } }));
jest.mock("../lib/adminApi", () => ({
  adminApiErrorMessage: () => "Could not load analytics",
  autoApplyApiUrl: (path) => path,
}));
jest.mock("../components/ui/button", () => ({
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
}));
jest.mock("../components/admin/AdminShell", () => ({
  __esModule: true,
  default: ({ actions, children }) => (
    <main>
      {actions}
      {children}
    </main>
  ),
  AdminAccessDenied: () => <div>Admin access denied</div>,
}));

const page = (overrides = {}) => ({
  users: [],
  total: 0,
  has_previous: false,
  has_next: false,
  previous_cursor: null,
  next_cursor: null,
  summary: {
    total_users: 0,
    onboarding_completed: 0,
    onboarding_in_progress: 0,
    onboarding_never_started: 0,
    avg_time_spent_minutes: 0,
    total_swipes: 0,
    total_applications: 0,
  },
  onboarding_dropoff: { by_step: [], never_started: 0, in_progress: 0, completed: 0 },
  answer_distributions: [],
  ...overrides,
});

describe("AdminUserAnalytics server pagination state", () => {
  let container;
  let root;

  beforeEach(() => {
    jest.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("clears server-owned analytics after a refresh failure", async () => {
    api.get.mockResolvedValueOnce({
      data: page({
        users: [{ user_id: "u1", email: "analytics@example.com" }],
        total: 1,
        summary: { ...page().summary, total_users: 1 },
      }),
    });
    await act(async () => root.render(<AdminUserAnalytics />));
    expect(container.textContent).toContain("analytics@example.com");

    api.get.mockRejectedValueOnce(new Error("database unavailable"));
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((item) => item.textContent.includes("Refresh"))
        .click();
    });
    expect(container.textContent).not.toContain("analytics@example.com");
    expect(container.textContent).toContain("0 users");
  });

  it("requests the next signed cursor from the server", async () => {
    api.get
      .mockResolvedValueOnce({
        data: page({
          total: 101,
          has_next: true,
          next_cursor: "signed-next",
          summary: { ...page().summary, total_users: 101 },
        }),
      })
      .mockResolvedValueOnce({
        data: page({
          total: 101,
          has_previous: true,
          previous_cursor: "signed-previous",
          summary: { ...page().summary, total_users: 101 },
        }),
      });
    await act(async () => root.render(<AdminUserAnalytics />));
    await act(async () => {
      [...container.querySelectorAll("button")].find((item) => item.textContent === "Next").click();
    });
    expect(api.get).toHaveBeenLastCalledWith(
      "/admin/user-analytics",
      expect.objectContaining({
        params: expect.objectContaining({ cursor: "signed-next", limit: 100 }),
      }),
    );
  });
});
