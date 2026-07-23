import { act } from "react";
import { createRoot } from "react-dom/client";
import { TrainingLocaleProvider } from "../../context/TrainingLocaleContext";
import TrainingLanguageToggle from "./TrainingLanguageToggle";

const mockNavigate = jest.fn();
const mockSetAppLang = jest.fn();

jest.mock("../../context/AppLocaleContext", () => ({
  useAppLocale: () => ({ setLang: mockSetAppLang }),
}));

jest.mock(
  "react-router-dom",
  () => ({
    useLocation: () => ({
      pathname: "/training",
      search: "?module=mod_warm_up&section=sec_wu_sop",
    }),
    useNavigate: () => mockNavigate,
  }),
  { virtual: true },
);

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("TrainingLanguageToggle", () => {
  let container;
  let root;

  beforeEach(() => {
    mockNavigate.mockReset();
    mockSetAppLang.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  test("exposes every app locale and preserves the lesson query when switching", () => {
    act(() =>
      root.render(
        <TrainingLocaleProvider locale="fr">
          <TrainingLanguageToggle />
        </TrainingLocaleProvider>,
      ),
    );

    expect([...container.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
      "en",
      "fr",
      "de",
      "es",
      "it",
    ]);

    const englishButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "en",
    );
    expect(englishButton).toBeTruthy();
    expect(englishButton.getAttribute("aria-pressed")).toBe("false");

    act(() => englishButton.click());

    expect(mockSetAppLang).toHaveBeenCalledWith("en");
    expect(mockNavigate).toHaveBeenCalledWith("/en/training?module=mod_warm_up&section=sec_wu_sop");
  });
});
