import fs from "fs";
import path from "path";

const readFrontendFile = (relativePath) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

describe("PostHog additive rollout seams", () => {
  it("keeps DataFast markup while removing the raw PostHog bootstrap", () => {
    const html = readFrontendFile("public/index.html");
    expect(html).toContain('id="datafast-queue"');
    expect(html).toContain('src="https://datafa.st/js/script.js"');
    expect(html).not.toContain("window.posthog");
    expect(html).not.toContain("posthog.init");
  });

  it("pins the supported SDK and incremental TypeScript toolchain", () => {
    const packageJson = JSON.parse(readFrontendFile("package.json"));
    const tsconfig = JSON.parse(readFrontendFile("tsconfig.json"));
    expect(packageJson.dependencies).toMatchObject({
      "@posthog/react": "1.10.3",
      "posthog-js": "1.404.1",
    });
    expect(packageJson.devDependencies).toMatchObject({
      "@types/jest": "27.5.2",
      "@types/react": "19.0.14",
      "@types/react-dom": "19.0.6",
      typescript: "4.9.5",
    });
    expect(tsconfig.compilerOptions).toMatchObject({
      allowJs: true,
      noEmit: true,
    });
  });

  it("blocks representative CV, application, email, and phone surfaces from replay", () => {
    for (const relativePath of [
      "src/components/profile/ResumeCurrentPreview.jsx",
      "src/pages/ReviewApplicationDetail.jsx",
      "src/pages/Emails.jsx",
      "src/components/onboarding/OnboardingContactPhoneStep.jsx",
    ]) {
      expect(readFrontendFile(relativePath)).toContain("ph-no-capture");
    }
  });
});
