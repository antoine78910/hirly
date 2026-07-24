import { act } from "react";
import { createRoot } from "react-dom/client";

import AdminApplications from "./AdminApplications";
import { api } from "../lib/api";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../lib/api", () => ({ api: { get: jest.fn() } }));
jest.mock("../lib/adminApi", () => ({ adminApiErrorMessage: () => "Could not load applications" }));
jest.mock(
  "react-router-dom",
  () => {
    const React = jest.requireActual("react");
    return {
      Link: ({ children, to, ...props }) => (
        <a href={to} {...props}>
          {children}
        </a>
      ),
      useSearchParams: () => {
        const [params, setParamsState] = React.useState(
          () => new URLSearchParams(globalThis.location.search),
        );
        const setParams = (next) => setParamsState(new URLSearchParams(next));
        return [params, setParams];
      },
    };
  },
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
jest.mock("../components/admin/AdminPipelineSteps", () => ({
  AdminPipelineSteps: () => <div>Pipeline</div>,
}));

const page = (overrides = {}) => ({
  applications: [],
  total: 0,
  has_previous: false,
  has_next: false,
  previous_cursor: null,
  next_cursor: null,
  queue: { active_count: 0, items: [] },
  ...overrides,
});

describe("AdminApplications server pagination state", () => {
  let container;
  let root;

  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState({}, "", "/admin/applications");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("clears stale queue, rows, and pagination after refresh failure", async () => {
    api.get.mockResolvedValueOnce({
      data: page({
        applications: [{ application_id: "a1", user_id: "u1", user_email: "user@example.com" }],
        total: 1,
        queue: {
          active_count: 1,
          items: [
            { application_id: "q1", company: "Queued Co", auto_apply_queue_status: "queued" },
          ],
        },
      }),
    });
    await act(async () => root.render(<AdminApplications />));
    expect(container.textContent).toContain("user@example.com");
    expect(container.textContent).toContain("Queued Co");
    expect(container.textContent).toContain("1 active");

    api.get.mockRejectedValueOnce(new Error("database unavailable"));
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((item) => item.textContent.includes("Refresh"))
        .click();
    });

    expect(container.textContent).not.toContain("user@example.com");
    expect(container.textContent).not.toContain("Queued Co");
    expect(container.textContent).toContain("0 active");
    expect(container.textContent).toContain("No applications found.");
  });

  it("keeps the active filter in the URL when requesting the next cursor", async () => {
    api.get
      .mockResolvedValueOnce({
        data: page({ total: 101, has_next: true, next_cursor: "signed-next" }),
      })
      .mockResolvedValueOnce({
        data: page({ total: 101, has_previous: true, previous_cursor: "signed-previous" }),
      });
    window.history.replaceState({}, "", "/admin/applications?filter=prepared");
    await act(async () => root.render(<AdminApplications />));
    await act(async () => {
      [...container.querySelectorAll("button")].find((item) => item.textContent === "Next").click();
    });
    expect(api.get).toHaveBeenLastCalledWith("/admin/applications", {
      params: { cursor: "signed-next", limit: 100, filter: "prepared" },
    });
  });

  it("places the wide applications table inside a horizontal scroll container", async () => {
    api.get.mockResolvedValueOnce({ data: page() });

    await act(async () => root.render(<AdminApplications />));

    const table = container.querySelector("table");
    expect(table.parentElement.className).toContain("overflow-x-auto");
  });
});
