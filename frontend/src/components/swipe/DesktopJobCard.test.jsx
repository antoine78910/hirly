import { act } from "react";
import { createRoot } from "react-dom/client";

import DesktopJobCard from "./DesktopJobCard";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../CompanyLogo", () => () => <div data-testid="company-logo" />);
jest.mock("./JobRomeProfile", () => () => null);
jest.mock("../../lib/localizedDisplay", () => ({
  translateLocationLabel: (location) => location,
}));
jest.mock("../../lib/jobDisplayUtils", () => ({
  formatJobSalaryLabel: () => "",
  getJobBadgeItems: () => [],
  getJobCardHighlightRows: () => [
    { key: "contract_type", label: "Type de contrat", value: "CDI" },
    { key: "contract_nature", label: "Contrat travail", value: "Contrat travail" },
    { key: "work_schedule", label: "Durée du travail", value: "Travail en journée" },
  ],
  getJobDisplayContent: () => ({ about: "", detailSections: [], snippet: "" }),
  getJobDisplayTitle: () => "Développeur",
  getJobMatchScore: () => 86,
  getJobOfferDetailRows: () => [
    { key: "contract_type", label: "Type de contrat", value: "CDI" },
    { key: "contract_nature", label: "Nature du contrat", value: "Contrat travail" },
    { key: "work_schedule", label: "Durée du travail", value: "Travail en journée" },
    { key: "experience", label: "Expérience", value: "Débutant accepté" },
  ],
}));

describe("DesktopJobCard", () => {
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

  it("shows the full offer details once without desktop highlights", () => {
    act(() => {
      root.render(
        <DesktopJobCard
          job={{ company: "Hirly", location: "Paris", posted_at: new Date().toISOString() }}
          lang="fr"
          t={(key, params) => (key === "swipe.postedDays" ? `${params.n} jours` : key)}
          theme={{
            cardAboutBody: "",
            cardAboutTitle: "",
            cardBadge: "",
            cardCompany: "",
            cardHeader: "",
            cardMeta: "",
            cardSection: "",
            cardTitle: "",
          }}
        />,
      );
    });

    expect(container.querySelector("[data-testid='job-offer-details']")).not.toBeNull();
    expect(container.querySelector("[data-testid='job-card-highlights']")).toBeNull();
    expect(container.querySelector("[data-testid='job-match-badge']")).not.toBeNull();

    const text = container.textContent;
    ["Type de contrat", "CDI", "Contrat travail", "Durée du travail", "Travail en journée", "Expérience", "Débutant accepté"].forEach((value) => {
      expect(text.split(value).length - 1).toBe(1);
    });
  });
});
