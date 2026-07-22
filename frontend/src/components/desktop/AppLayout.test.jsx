import { act } from "react";
import { createRoot } from "react-dom/client";

import AppLayout from "./AppLayout";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock(
  "react-router-dom",
  () => ({
    Outlet: () => <main>App route</main>,
    useLocation: () => ({ pathname: "/swipe" }),
  }),
  { virtual: true },
);

jest.mock("../../hooks/useIsDesktop", () => ({
  useIsDesktop: () => false,
}));

jest.mock("../../context/UpgradeModalContext", () => ({
  UpgradeModalProvider: ({ children }) => (
    <div data-testid="upgrade-modal-provider">{children}</div>
  ),
}));

jest.mock("../maintenance/MaintenanceBanner", () => () => (
  <aside data-testid="maintenance-banner">Maintenance</aside>
));

jest.mock("./DesktopAppShell", () => ({ children }) => <div>{children}</div>);

describe("AppLayout", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders the maintenance banner with real app routes", () => {
    act(() => root.render(<AppLayout />));

    expect(container.querySelector("[data-testid='maintenance-banner']")).not.toBeNull();
    expect(container.querySelector("[data-testid='upgrade-modal-provider']")).not.toBeNull();
    expect(container.textContent).toContain("App route");
  });
});
