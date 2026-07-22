import { act } from "react";
import { createRoot } from "react-dom/client";

import { UpgradeModalProvider, useUpgradeModal } from "./UpgradeModalContext";
import { backendHasNewerFrontend } from "../lib/frontendVersion";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../components/upgrade/DesktopUpgradeModal", () => ({
  __esModule: true,
  default: ({ open }) => (open ? <div data-testid="upgrade-modal" /> : null),
}));

jest.mock("./AppLocaleContext", () => ({
  useAppLocale: () => ({ t: (key) => key }),
}));

jest.mock("../lib/frontendVersion", () => ({
  backendHasNewerFrontend: jest.fn(),
}));

jest.mock(
  "react-router-dom",
  () => ({
    useLocation: () => ({ pathname: "/swipe", search: "" }),
    useNavigate: () => jest.fn(),
  }),
  { virtual: true },
);

function UpgradeTrigger() {
  const { openUpgrade } = useUpgradeModal();
  return (
    <button type="button" onClick={() => void openUpgrade()}>
      Upgrade
    </button>
  );
}

describe("UpgradeModalProvider", () => {
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

  it("keeps the modal closed while the matching frontend is not deployed", async () => {
    backendHasNewerFrontend.mockResolvedValue(true);
    await act(async () => {
      root.render(
        <UpgradeModalProvider>
          <UpgradeTrigger />
        </UpgradeModalProvider>,
      );
    });

    await act(async () => {
      container.querySelector("button").click();
      await Promise.resolve();
    });

    expect(backendHasNewerFrontend).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-testid='upgrade-modal']")).toBeNull();
  });

  it("opens the modal when the deployed frontend matches the backend", async () => {
    backendHasNewerFrontend.mockResolvedValue(false);
    await act(async () => {
      root.render(
        <UpgradeModalProvider>
          <UpgradeTrigger />
        </UpgradeModalProvider>,
      );
    });

    await act(async () => {
      container.querySelector("button").click();
      await Promise.resolve();
    });

    expect(container.querySelector("[data-testid='upgrade-modal']")).not.toBeNull();
  });
});
