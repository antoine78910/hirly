import { act } from "react";
import { createRoot } from "react-dom/client";

import AdminUsers from "./AdminUsers";
import { api } from "../lib/api";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("../lib/adminApi", () => ({
  adminApiErrorMessage: () => "Could not load users",
  autoApplyApiUrl: (path) => path,
}));
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock(
  "react-router-dom",
  () => ({
    Link: ({ children, to, ...props }) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
  }),
  { virtual: true },
);
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
  aggregates: { matching_paying: 0 },
  ...overrides,
});

describe("AdminUsers server pagination state", () => {
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

  it("clears rows, pagination, and paying aggregate after a refresh error", async () => {
    api.get.mockResolvedValueOnce({
      data: page({
        users: [{ user_id: "u1", email: "paid@example.com", is_premium: true }],
        total: 1,
        aggregates: { matching_paying: 1 },
      }),
    });
    await act(async () => root.render(<AdminUsers />));
    expect(container.textContent).toContain("paid@example.com");
    expect(container.textContent).toContain("Paying only (1)");

    api.get.mockRejectedValueOnce(new Error("database unavailable"));
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((item) => item.textContent.includes("Refresh"))
        .click();
    });

    expect(container.textContent).not.toContain("paid@example.com");
    expect(container.textContent).toContain("Paying only (0)");
    expect(container.textContent).toContain("0 user(s) match");
  });

  it("requests the next signed server cursor without changing the limit", async () => {
    api.get
      .mockResolvedValueOnce({
        data: page({ total: 101, has_next: true, next_cursor: "signed-next" }),
      })
      .mockResolvedValueOnce({
        data: page({ total: 101, has_previous: true, previous_cursor: "signed-previous" }),
      });
    await act(async () => root.render(<AdminUsers />));
    await act(async () => {
      [...container.querySelectorAll("button")].find((item) => item.textContent === "Next").click();
    });
    expect(api.get).toHaveBeenLastCalledWith(
      "/admin/users",
      expect.objectContaining({
        params: expect.objectContaining({ cursor: "signed-next", limit: 100 }),
      }),
    );
  });
});
