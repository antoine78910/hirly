import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workflow = readFileSync(
  resolve(import.meta.dir, "../.github/workflows/typescript-foundation.yml"),
  "utf8",
);
const biomeConfig = JSON.parse(readFileSync(resolve(import.meta.dir, "../biome.json"), "utf8")) as {
  css?: { parser?: { tailwindDirectives?: boolean } };
};
const workerDockerfile = readFileSync(
  resolve(import.meta.dir, "../apps/worker/Dockerfile"),
  "utf8",
);
const workerOperations = readFileSync(
  resolve(import.meta.dir, "../apps/worker/OPERATIONS.md"),
  "utf8",
);
const workerPackage = JSON.parse(
  readFileSync(resolve(import.meta.dir, "../apps/worker/package.json"), "utf8"),
) as { scripts?: Record<string, string> };

describe("main production release workflow", () => {
  test("copies every app manifest required by the frozen worker install", () => {
    expect(workerDockerfile).toContain(
      "COPY apps/analytics-backfill/package.json apps/analytics-backfill/package.json",
    );
  });

  test("serializes migration, backend readiness, and frontend promotion", () => {
    expect(workflow).toContain("production-migrations:");
    expect(workflow).toContain("deploy-railway:");
    expect(workflow).toContain("deploy-vercel:");
    expect(workflow).toMatch(/deploy-railway:[\s\S]*?needs:\s*\n\s+- production-migrations/);
    expect(workflow).toMatch(/deploy-vercel:[\s\S]*?needs:\s*\n\s+- deploy-railway/);
  });

  test("blocks Railway on migration success and verifies the deployed commit", () => {
    expect(workflow).toContain('supabase db push --db-url "$SUPABASE_DB_URL"');
    expect(workflow).toContain('[ "$deployed_sha" = "$EXPECTED_SHA" ]');
    expect(workflow).toContain('"${RAILWAY_BACKEND_URL%/}/api/health"');
  });

  test("stages Vercel before promotion", () => {
    expect(workflow).toContain("--skip-domain");
    expect(workflow).toContain("vercel@56.4.0 curl /");
    expect(workflow).toContain('vercel@56.4.0 promote "$DEPLOYMENT_URL"');
    expect(workflow.indexOf("--skip-domain")).toBeLessThan(
      workflow.indexOf('vercel@56.4.0 promote "$DEPLOYMENT_URL"'),
    );
  });

  test("preflights Vercel Production package-token metadata before deployment", () => {
    const preflightIndex = workflow.indexOf("Require Vercel production package token metadata");
    const deployIndex = workflow.indexOf("Create a staged production deployment");
    const preflight = workflow.slice(preflightIndex, deployIndex);

    expect(preflightIndex).toBeGreaterThan(-1);
    expect(preflightIndex).toBeLessThan(deployIndex);
    expect(preflight).toContain("vercel@56.4.0 env ls production");
    expect(preflight).not.toContain("env ls production --yes");
    expect(preflight).toContain("grep --quiet --fixed-strings 'CONTRACTSPEC_NPM_TOKEN'");
    expect(preflight).not.toContain("env pull");
    expect(preflight).not.toContain("CONTRACTSPEC_NPM_TOKEN=");
  });

  test("keeps production credentials in GitHub secrets", () => {
    const productionRelease = workflow.slice(workflow.indexOf("  production-migrations:"));

    expect(workflow).toContain("SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}");
    expect(workflow).toContain("RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}");
    expect(workflow).toContain("VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}");
    expect(productionRelease).not.toMatch(/postgres(?:ql)?:\/\/[^$\s]+/);
  });

  test("maps the package token into every CI dependency installer job", () => {
    const bunWorkspaces = workflow.slice(
      workflow.indexOf("  bun-workspaces:"),
      workflow.indexOf("  legacy-frontend:"),
    );
    const legacyFrontend = workflow.slice(
      workflow.indexOf("  legacy-frontend:"),
      workflow.indexOf("  stack-policy:"),
    );
    const secretMapping = "CONTRACTSPEC_NPM_TOKEN: ${{ secrets.CONTRACTSPEC_NPM_TOKEN }}";

    expect(bunWorkspaces).toContain(secretMapping);
    expect(legacyFrontend).toContain(secretMapping);
  });

  test("uses non-mutating changed-file validation for Bun workspaces", () => {
    const bunWorkspaces = workflow.slice(
      workflow.indexOf("  bun-workspaces:"),
      workflow.indexOf("  legacy-frontend:"),
    );

    expect(bunWorkspaces).toContain("bun run check:changed");
    expect(bunWorkspaces).not.toContain("bun run format\n");
  });

  test("parses Tailwind directives in frontend styles", () => {
    expect(biomeConfig.css?.parser?.tailwindDirectives).toBe(true);
  });

  test("uses a BuildKit secret for the worker dependency install", () => {
    expect(workerDockerfile.startsWith("# syntax=docker/dockerfile:1.7\n")).toBe(true);
    expect(workerDockerfile).toContain(
      "COPY package.json bun.lock bunfig.toml tsconfig.base.json .npmrc ./",
    );
    expect(workerDockerfile).toContain(
      "RUN --mount=type=secret,id=CONTRACTSPEC_NPM_TOKEN,env=CONTRACTSPEC_NPM_TOKEN,required=true bun install --frozen-lockfile",
    );
    expect(workerDockerfile).not.toMatch(/^(?:ARG|ENV)\s+CONTRACTSPEC_NPM_TOKEN/m);

    const finalStage = workerDockerfile.slice(
      workerDockerfile.indexOf("FROM oven/bun:1.3.14-slim"),
    );
    expect(finalStage).not.toContain("CONTRACTSPEC_NPM_TOKEN");
    expect(finalStage).not.toMatch(/\b\.npmrc\b/);
  });

  test("forwards the local Docker token as a BuildKit secret, never a build arg", () => {
    const command = workerPackage.scripts?.["docker:build"];

    expect(command).toContain("DOCKER_BUILDKIT=1 docker build");
    expect(command).toContain("--secret id=CONTRACTSPEC_NPM_TOKEN,env=CONTRACTSPEC_NPM_TOKEN");
    expect(command).not.toContain("--build-arg");
  });

  test("blocks a Railway worker release without BuildKit secret support", () => {
    expect(workerOperations).toContain("CONTRACTSPEC_NPM_TOKEN` as a BuildKit secret");
    expect(workerOperations).toContain("block the release");
    expect(workerOperations).toContain("Never substitute a Docker build argument.");
  });
});
