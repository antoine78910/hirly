import { act } from "react";
import { createRoot } from "react-dom/client";
import { trainingLocaleUnavailableCopy } from "../lib/trainingLocaleAvailability";
import { TrainingLocaleProvider, useTrainingLocale } from "./TrainingLocaleContext";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ translationKey = "academy" }) {
  const { t } = useTrainingLocale();
  return <output>{t(translationKey)}</output>;
}

describe("TrainingLocaleProvider", () => {
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

  test("updates translations when the route locale changes", () => {
    act(() =>
      root.render(
        <TrainingLocaleProvider locale="fr">
          <Probe />
        </TrainingLocaleProvider>,
      ),
    );
    expect(container.textContent).toBe("Académie");

    act(() =>
      root.render(
        <TrainingLocaleProvider locale="en">
          <Probe />
        </TrainingLocaleProvider>,
      ),
    );
    expect(container.textContent).toBe("Academy");
  });

  test("translates training welcome chrome with the route locale", () => {
    act(() =>
      root.render(
        <TrainingLocaleProvider locale="en">
          <Probe translationKey="welcome.title" />
        </TrainingLocaleProvider>,
      ),
    );
    expect(container.textContent).toBe("Welcome to the training");

    act(() =>
      root.render(
        <TrainingLocaleProvider locale="fr">
          <Probe translationKey="welcome.title" />
        </TrainingLocaleProvider>,
      ),
    );
    expect(container.textContent).toBe("Bienvenue dans la formation");
  });

  test("uses a neutral unavailable message for an unsupported route prefix", () => {
    const copy = trainingLocaleUnavailableCopy("pt");
    expect(copy.title).toBe("Training is unavailable for this locale.");
    expect(copy.title).not.toContain("Diese Schulung");
  });
});
