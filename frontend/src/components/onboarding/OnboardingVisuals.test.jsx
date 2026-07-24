import { act } from "react";
import { createRoot } from "react-dom/client";

import { InterviewTargetDashes } from "./OnboardingVisuals";
import { ShowcaseAllInOneStep } from "./OnboardingFinalSteps";

jest.mock("../../context/AppLocaleContext", () => ({
  useAppLocale: () => ({ lang: "en" }),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("InterviewTargetDashes", () => {
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

  it("renders one dash for each target slot", () => {
    act(() => {
      root.render(<InterviewTargetDashes count={4} max={8} />);
    });

    expect(container.firstElementChild.children).toHaveLength(8);
  });
});

describe("ShowcaseAllInOneStep", () => {
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

  it("renders the scrolling pain-point rows", () => {
    act(() => {
      root.render(<ShowcaseAllInOneStep />);
    });

    expect(container.textContent).toContain("All in one place");
  });
});
