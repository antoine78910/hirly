import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

type PackageJson = {
  name?: string;
  version?: string;
  private?: boolean;
  packageManager?: string;
  scripts?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
};

const repoRoot = join(import.meta.dir, "..");

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(repoRoot, relativePath), "utf8")) as T;
}

function workspacePatterns(packageJson: PackageJson): string[] {
  if (Array.isArray(packageJson.workspaces)) {
    return packageJson.workspaces;
  }

  return packageJson.workspaces?.packages ?? [];
}

describe("root Bun workspace isolation", () => {
  test("configures the root Bun installer for the private package registry", () => {
    expect(readFileSync(join(repoRoot, ".npmrc"), "utf8").trim()).toBe(
      [
        "registry=https://registry.npmjs.org/",
        "@lssm-tech:registry=https://npm.pkg.github.com/",
        "//npm.pkg.github.com/:_authToken=${CONTRACTSPEC_NPM_TOKEN}",
      ].join("\n"),
    );
  });

  test("only apps and packages participate in the root workspace", () => {
    const rootPackage = readJson<PackageJson>("package.json");
    const patterns = workspacePatterns(rootPackage);

    expect(rootPackage.private).toBe(true);
    expect(rootPackage.packageManager).toMatch(/^bun@\d+\.\d+\.\d+$/);
    expect([...patterns].sort()).toEqual(["apps/*", "packages/*"]);
    expect(patterns.some((pattern) => pattern.includes("frontend"))).toBe(false);

    const resolvedManifests = patterns.flatMap((pattern) =>
      Array.from(
        new Bun.Glob(`${pattern}/package.json`).scanSync({
          cwd: repoRoot,
          onlyFiles: true,
        }),
      ),
    );

    expect(
      resolvedManifests.every(
        (manifest) => manifest.startsWith("apps/") || manifest.startsWith("packages/"),
      ),
    ).toBe(true);
    expect(
      resolvedManifests.some(
        (manifest) => manifest === "frontend/package.json" || manifest.startsWith("frontend/"),
      ),
    ).toBe(false);
  });

  test("root quality commands stay scoped away from the legacy frontend", () => {
    const rootPackage = readJson<PackageJson>("package.json");

    for (const scriptName of ["format", "lint", "typecheck", "test", "build"]) {
      const command = rootPackage.scripts?.[scriptName];
      expect(command).toBeTruthy();
      expect(command).not.toContain("frontend");
    }

    for (const requiredFile of ["bun.lock", "bunfig.toml", "tsconfig.base.json"]) {
      expect(existsSync(join(repoRoot, requiredFile))).toBe(true);
    }
  });
});

describe("legacy frontend install and deployment contract", () => {
  test("keeps the legacy frontend on its explicit npm deployment contract", () => {
    const frontendPackage = readJson<PackageJson>("frontend/package.json");
    const frontendLock = readJson<{
      name?: string;
      version?: string;
      lockfileVersion?: number;
      packages?: Record<string, PackageJson>;
    }>("frontend/package-lock.json");

    expect(frontendPackage.name).toBe("frontend");
    expect(frontendPackage.version).toBe("0.1.0");
    expect(frontendPackage.private).toBe(true);
    // Do not advertise Yarn here: Vercel and local release verification both
    // install this isolated CRA app with npm and its package-lock.json.
    expect(frontendPackage.packageManager).toBeUndefined();
    expect(frontendPackage.scripts).toEqual({
      start: "craco start",
      build: "craco build",
      test: "craco test",
    });

    expect(frontendLock.name).toBe("frontend");
    expect(frontendLock.version).toBe("0.1.0");
    expect(frontendLock.lockfileVersion).toBe(3);
    expect(frontendLock.packages?.[""]?.name).toBe("frontend");
    expect(frontendLock.packages?.[""]?.version).toBe("0.1.0");
    expect(readFileSync(join(repoRoot, "frontend/.npmrc"), "utf8").trim()).toBe(
      [
        "legacy-peer-deps=true",
        "registry=https://registry.npmjs.org/",
        "@lssm-tech:registry=https://npm.pkg.github.com/",
        "//npm.pkg.github.com/:_authToken=${CONTRACTSPEC_NPM_TOKEN}",
      ].join("\n"),
    );
  });

  test("preserves the existing CRA install, build, and routing configuration", () => {
    const frontendVercel = readJson<{
      installCommand?: string;
      buildCommand?: string;
      outputDirectory?: string;
    }>("frontend/vercel.json");
    const rootVercel = readJson<{
      services?: Record<
        string,
        {
          root?: string;
          framework?: string;
          installCommand?: string;
          buildCommand?: string;
          outputDirectory?: string;
        }
      >;
    }>("vercel.json");

    expect(frontendVercel).toMatchObject({
      installCommand: "npm install --legacy-peer-deps",
      buildCommand: "CI=false npm run build",
      outputDirectory: "build",
    });
    expect(rootVercel.services?.frontend).toEqual({
      root: "frontend",
      framework: "create-react-app",
      installCommand: "npm install --legacy-peer-deps",
      buildCommand: "CI=false npm run build",
      outputDirectory: "build",
    });
  });
});
