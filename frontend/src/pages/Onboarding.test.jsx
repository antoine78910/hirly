import { act } from "react";
import { createRoot } from "react-dom/client";

import Onboarding from "./Onboarding";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockSetSearchParams = jest.fn();
const mockSearchParams = new URLSearchParams("checkout=success");

jest.mock(
  "react-router-dom",
  () => ({
    useNavigate: () => jest.fn(),
    useSearchParams: () => [mockSearchParams, mockSetSearchParams],
  }),
  { virtual: true },
);

jest.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: null,
    hasProfile: false,
    hasPreferences: false,
    setHasProfile: jest.fn(),
    setHasPreferences: jest.fn(),
    checkAuth: jest.fn(),
    setHasTrainingAccess: jest.fn(),
    loading: false,
  }),
}));

jest.mock("../context/AppLocaleContext", () => ({
  useAppLocale: () => ({ lang: "fr", setLang: jest.fn() }),
}));

jest.mock("../lib/api", () => ({
  api: {
    get: jest.fn(),
    patch: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
  },
}));

jest.mock("../lib/billingSync", () => ({
  syncBillingAfterCheckout: jest.fn(),
}));

jest.mock("../lib/analytics", () => ({ trackEvent: jest.fn() }));
jest.mock("../components/ui/slider", () => ({ Slider: () => null }));
jest.mock("../components/PlacesAutocomplete", () => () => null);
jest.mock("../components/onboarding/OnboardingShell", () => ({
  __esModule: true,
  default: ({ children }) => <div data-testid="onboarding-shell">{children}</div>,
  ContinueButton: ({ children }) => <button type="button">{children}</button>,
}));
jest.mock("../components/onboarding/OnboardingSignup", () => () => (
  <div data-testid="onboarding-signup">Sign up</div>
));
jest.mock("../components/onboarding/OnboardingIllustration", () => () => null);
jest.mock("../components/onboarding/SelectionCard", () => () => null);
jest.mock("../components/onboarding/OnboardingVisuals", () => ({
  InterviewRateChart: () => null,
  Compare2xChart: () => null,
  LongTermResultsChart: () => null,
  InterviewTargetDashes: () => null,
}));
jest.mock("../components/onboarding/OnboardingContactPhoneStep", () => ({
  __esModule: true,
  default: () => null,
  getContactPhoneCopy: () => ({}),
}));
jest.mock("../components/onboarding/OnboardingFinalSteps", () => ({
  ProfileSetupStep: () => null,
  ProfileWelcomeStep: () => null,
  ShowcaseLandingStep: () => null,
  ShowcaseAllInOneStep: () => null,
  ShowcasePricingStep: () => null,
}));

describe("Onboarding checkout return", () => {
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

  it("renders a checkout-success return without reading the completion handler before initialization", async () => {
    await act(async () => {
      root.render(<Onboarding />);
      await Promise.resolve();
    });

    expect(container.querySelector("[data-testid='onboarding-shell']")).not.toBeNull();
    expect(mockSetSearchParams).toHaveBeenCalledWith({}, { replace: true });
  });
});
