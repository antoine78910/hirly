import { act } from "react";
import { createRoot } from "react-dom/client";

import LandingFaq from "./LandingFaq";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("LandingFaq localization", () => {
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

  it.each([
    ["de-DE", "Häufig gestellte Fragen"],
    ["es-ES", "Preguntas frecuentes"],
    ["it-IT", "Domande frequenti"],
  ])("renders the authored %s FAQ heading", (locale, heading) => {
    act(() => root.render(<LandingFaq lang={locale} />));

    expect(container.querySelector("h2")?.textContent).toBe(heading);
  });
});
