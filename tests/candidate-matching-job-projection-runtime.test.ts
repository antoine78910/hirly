import { describe, expect, test } from "bun:test";

const root = new URL("..", import.meta.url);
const migration = await Bun.file(
  new URL("backend/db/migrations/20260721002500_job_projection_runtime.sql", root),
).text();
const down = await Bun.file(
  new URL("backend/db/migrations/20260721002500_job_projection_runtime.down.sql", root),
).text();

describe("job projection runtime migration", () => {
  test("claims bounded job-only tasks with SKIP LOCKED and disabled controls", () => {
    expect(migration).toContain("FOR UPDATE SKIP LOCKED");
    expect(migration).toContain(
      "task.task_kind IN ('job.document.project', 'projection.reconcile')",
    );
    expect(migration).toContain("capability = 'job_projection' AND control.enabled");
    expect(migration).toContain("capability = 'projection_reconciliation' AND control.enabled");
  });

  test("fences stale upserts/removals and never writes canonical inventory", () => {
    expect(migration).toContain("claim_generation = p_claim_generation");
    expect(migration).toContain("v_existing.job_version > v_task.entity_version");
    expect(migration).toContain("job_version <= p_authoritative_version");
    expect(migration).toContain("v_task.source_digest IS DISTINCT FROM v_live_digest");
    expect(migration).toContain(
      "v_live_preferred_job_id IS DISTINCT FROM p_document->>'preferred_job_id'",
    );
    expect(migration).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM) public\.jobs\b/);
    expect(migration).not.toMatch(
      /(?:INSERT INTO|UPDATE|DELETE FROM) public\.canonical_job_groups\b/,
    );
  });

  test("revokes bootstrap DML and reconciles a complete canonical snapshot digest", () => {
    expect(migration).toContain(
      "REVOKE INSERT, UPDATE, DELETE ON public.matching_runtime_controls",
    );
    expect(migration).toContain("public.job_search_documents");
    expect(migration).toContain("public.projection_reconciliation_tasks");
    expect(migration).toContain("source_snapshot_digest");
    for (const field of [
      "preferredJobId",
      "groupStatus",
      "validationStatus",
      "applyabilityTier",
      "applyFulfillmentStatus",
      "sourceEligible",
      "policyEligible",
      "data",
    ]) {
      expect(migration).toContain(`'${field}'`);
    }
  });

  test("rolls back only PR2 additions", () => {
    expect(down).toContain("DROP TABLE IF EXISTS public.job_projection_task_audit");
    expect(down).not.toContain("DROP TABLE IF EXISTS public.job_search_documents");
    expect(down).not.toContain("DROP TABLE IF EXISTS public.jobs");
    expect(down).not.toContain("DROP TABLE IF EXISTS public.canonical_job_groups");
  });
});
