import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workflow = readFileSync(
  resolve(import.meta.dir, "../.github/workflows/typescript-foundation.yml"),
  "utf8",
);
const workerDockerfile = readFileSync(
  resolve(import.meta.dir, "../apps/worker/Dockerfile"),
  "utf8",
);

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
    expect(workflow).toMatch(
      /deploy-railway:[\s\S]*?needs:\s*\n\s+- production-migrations/,
    );
    expect(workflow).toMatch(
      /deploy-vercel:[\s\S]*?needs:\s*\n\s+- deploy-railway/,
    );
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

  test("keeps production credentials in GitHub secrets", () => {
    const productionRelease = workflow.slice(
      workflow.indexOf("  production-migrations:"),
    );

    expect(workflow).toContain(
      "SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}",
    );
    expect(workflow).toContain("RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}");
    expect(workflow).toContain("VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}");
    expect(productionRelease).not.toMatch(/postgres(?:ql)?:\/\/[^$\s]+/);
  });
});
