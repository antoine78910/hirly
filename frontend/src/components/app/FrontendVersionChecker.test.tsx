import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import FrontendVersionChecker from "./FrontendVersionChecker";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let mockLang: "en" | "fr" = "en";

jest.mock("../../context/AppLocaleContext", () => ({
  useAppLocale: () => ({ lang: mockLang }),
}));

describe("FrontendVersionChecker", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    jest.useFakeTimers();
    mockLang = "en";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    jest.useRealTimers();
  });

  it("stays out of the way when the current frontend is still latest", async () => {
    const checkForUpdate = jest.fn().mockResolvedValue(false);
    await act(async () => {
      root.render(<FrontendVersionChecker checkForUpdate={checkForUpdate} />);
    });

    expect(checkForUpdate).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-testid='frontend-update-dialog']")).toBeNull();
  });

  it("shows localized copy and refreshes only after user confirmation", async () => {
    const checkForUpdate = jest.fn().mockResolvedValue(true);
    const onRefresh = jest.fn();
    mockLang = "fr";
    await act(async () => {
      root.render(
        <FrontendVersionChecker
          checkForUpdate={checkForUpdate}
          onRefresh={onRefresh}
        />,
      );
    });

    expect(document.body.textContent).toContain("Une nouvelle version de Hirly");
    expect(document.body.textContent).toContain("OK, actualiser Hirly");
    expect(document.body.textContent).toContain("Pas maintenant");
    expect(onRefresh).not.toHaveBeenCalled();

    const button = document.querySelector(
      "[data-testid='frontend-update-refresh']",
    ) as HTMLButtonElement;
    act(() => button.click());
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("lets a user dismiss the update for this session without checking or reopening again", async () => {
    const checkForUpdate = jest.fn().mockResolvedValue(true);
    await act(async () => {
      root.render(
        <FrontendVersionChecker
          checkForUpdate={checkForUpdate}
          intervalMs={1000}
        />,
      );
    });

    const cancel = document.querySelector(
      "[data-testid='frontend-update-cancel']",
    ) as HTMLButtonElement;
    act(() => cancel.click());

    expect(document.querySelector("[data-testid='frontend-update-dialog']")).toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(1000);
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    expect(checkForUpdate).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-testid='frontend-update-dialog']")).toBeNull();
  });

  it("lets a user dismiss the update with Escape without checking or reopening again", async () => {
    const checkForUpdate = jest.fn().mockResolvedValue(true);
    await act(async () => {
      root.render(
        <FrontendVersionChecker
          checkForUpdate={checkForUpdate}
          intervalMs={1000}
        />,
      );
    });

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(document.querySelector("[data-testid='frontend-update-dialog']")).toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(1000);
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    expect(checkForUpdate).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-testid='frontend-update-dialog']")).toBeNull();
  });

  it("checks again on the polling interval without requiring navigation", async () => {
    const checkForUpdate = jest
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    await act(async () => {
      root.render(
        <FrontendVersionChecker
          checkForUpdate={checkForUpdate}
          intervalMs={1000}
        />,
      );
    });

    await act(async () => {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(checkForUpdate).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain("A new Hirly version is ready");
  });
});
