import fs from "fs";
import path from "path";

const readSource = (relativePath) =>
  fs.readFileSync(path.join(process.cwd(), "src", relativePath), "utf8");

describe("PostHog sensitive surface masking", () => {
  it.each([
    "components/onboarding/OnboardingContactPhoneStep.jsx",
    "components/profile/ResumeCurrentPreview.jsx",
    "pages/Emails.jsx",
    "pages/ReviewApplicationDetail.jsx",
  ])("marks %s with ph-no-capture", (relativePath) => {
    expect(readSource(relativePath)).toContain("ph-no-capture");
  });
});
