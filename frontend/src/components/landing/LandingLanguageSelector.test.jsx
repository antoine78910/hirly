import { act } from "react";
import { createRoot } from "react-dom/client";

import LandingLanguageSelector from "./LandingLanguageSelector";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockSetLang = jest.fn();

jest.mock("../../context/AppLocaleContext", () => ({
  useAppLocale: () => ({
    lang: "fr",
    setLang: mockSetLang,
    t: (key) =>
      ({
        "common.language": "Language",
        "common.english": "English",
        "common.french": "French",
        "common.german": "German",
        "common.spanish": "Spanish",
        "common.italian": "Italian",
      })[key],
  }),
}));

describe("LandingLanguageSelector", () => {
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

  it("exposes all five supported locales and updates the app locale", () => {
    act(() => root.render(<LandingLanguageSelector />));

    const selector = container.querySelector("[data-testid='landing-language-selector']");
    expect(selector.value).toBe("fr");
    expect([...selector.options].map(({ value }) => value)).toEqual(["en", "fr", "de", "es", "it"]);
    expect(container.querySelector("label").textContent).toBe("Language");

    act(() => {
      selector.value = "it";
      selector.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(mockSetLang).toHaveBeenCalledWith("it");
  });
});
