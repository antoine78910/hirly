import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import MaintenanceBanner, { MAINTENANCE_BANNER_FLAG_KEY } from "./MaintenanceBanner";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let mockLang: "en" | "fr" = "en";
const mockUseFeatureFlagEnabled = jest.fn<boolean, [string, boolean]>();

jest.mock("@posthog/react", () => ({
  useFeatureFlagEnabled: (flag: string, defaultValue: boolean) =>
    mockUseFeatureFlagEnabled(flag, defaultValue),
}));

jest.mock("../../context/AppLocaleContext", () => ({
  useAppLocale: () => ({ lang: mockLang }),
}));

describe("MaintenanceBanner", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseFeatureFlagEnabled.mockReturnValue(false);
    mockLang = "en";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("fails closed while the flag is unavailable or disabled", () => {
    act(() => root.render(<MaintenanceBanner />));

    expect(mockUseFeatureFlagEnabled).toHaveBeenCalledWith(MAINTENANCE_BANNER_FLAG_KEY, false);
    expect(container.querySelector("[data-testid='maintenance-banner']")).toBeNull();

    act(() => root.render(<MaintenanceBanner />));
    expect(container.querySelector("[data-testid='maintenance-banner']")).toBeNull();
  });

  it("shows localized maintenance copy when PostHog enables the flag", () => {
    mockUseFeatureFlagEnabled.mockReturnValue(true);
    act(() => root.render(<MaintenanceBanner />));
    expect(container.textContent).toContain("Scheduled maintenance");
    expect(container.textContent).toContain("temporarily unavailable");

    mockLang = "fr";
    act(() => root.render(<MaintenanceBanner />));
    expect(container.textContent).toContain("Maintenance en cours");
    expect(container.textContent).toContain("temporairement indisponibles");
  });
});
