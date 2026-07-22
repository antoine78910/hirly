import { describe, expect, test } from "bun:test";
import {
  JOB_PROJECTION_BACKFILL_CHECKPOINT_VERSION,
  runProjectionBackfill,
  type ProjectionBackfillCandidate,
  type ProjectionBackfillRepository,
} from "../src/backfill";
import { parseProjectionBackfillArgs } from "../src/cli";

const candidate = (
  id: number,
  overrides: Partial<ProjectionBackfillCandidate> = {},
): ProjectionBackfillCandidate => ({
  canonicalGroupId: `00000000-0000-4000-8000-${id.toString().padStart(12, "0")}`,
  provider: "sprout",
  countryCode: "FR",
  roleKeys: ["software-engineering"],
  sourceDigest: id.toString(16).padStart(64, "0"),
  ...overrides,
});

function repository(rows: ProjectionBackfillCandidate[]) {
  const enqueued: string[] = [];
  const repo: ProjectionBackfillRepository = {
    listCandidates: async ({ cursor, limit }) =>
      rows.filter((row) => cursor === null || row.canonicalGroupId > cursor).slice(0, limit),
    enqueue: async (row) => {
      if (enqueued.includes(row.canonicalGroupId)) return "existing";
      enqueued.push(row.canonicalGroupId);
      return "enqueued";
    },
  };
  return { repo, enqueued };
}

describe("bounded projection backfill", () => {
  test("defaults the CLI and runner to dry-run without mutation", async () => {
    expect(parseProjectionBackfillArgs([]).execute).toBe(false);
    const { repo, enqueued } = repository([candidate(1)]);
    const progress = await runProjectionBackfill({ repository: repo });
    expect(progress.mode).toBe("dry_run");
    expect(progress.eligible).toBe(1);
    expect(enqueued).toEqual([]);
  });

  test("enforces the batch cap and submits only one bounded page", async () => {
    const { repo, enqueued } = repository([candidate(1), candidate(2), candidate(3)]);
    const progress = await runProjectionBackfill({ repository: repo, execute: true, batchSize: 2 });
    expect(progress.selected).toBe(2);
    expect(progress.enqueued).toBe(2);
    expect(enqueued).toEqual([candidate(1).canonicalGroupId, candidate(2).canonicalGroupId]);
    await expect(runProjectionBackfill({ repository: repo, batchSize: 501 })).rejects.toThrow(
      "invalid_batch_size",
    );
  });

  test("resumes idempotently after the emitted checkpoint cursor", async () => {
    const { repo, enqueued } = repository([candidate(1), candidate(2), candidate(3)]);
    const first = await runProjectionBackfill({ repository: repo, execute: true, batchSize: 2 });
    const second = await runProjectionBackfill({
      repository: repo,
      execute: true,
      batchSize: 2,
      checkpoint: first.checkpoint,
    });
    const replay = await runProjectionBackfill({
      repository: repo,
      execute: true,
      batchSize: 2,
      checkpoint: first.checkpoint,
    });
    expect(second.cursorIn).toBe(candidate(2).canonicalGroupId);
    expect(second.enqueued).toBe(1);
    expect(replay.existing).toBe(1);
    expect(enqueued).toEqual([
      candidate(1).canonicalGroupId,
      candidate(2).canonicalGroupId,
      candidate(3).canonicalGroupId,
    ]);
  });

  test("fails closed for provider/country rollback deny rules", async () => {
    const { repo, enqueued } = repository([
      candidate(1),
      candidate(2, { provider: "greenhouse", countryCode: "DE" }),
    ]);
    const progress = await runProjectionBackfill({
      repository: repo,
      execute: true,
      rollbackDenylist: ["sprout:FR"],
      checkpoint: { schemaVersion: JOB_PROJECTION_BACKFILL_CHECKPOINT_VERSION, cursor: null },
    });
    expect(progress.denied).toBe(1);
    expect(progress.enqueued).toBe(1);
    expect(enqueued).toEqual([candidate(2).canonicalGroupId]);
  });

  test("the production repository mutates only through the fenced enqueue RPC", async () => {
    const source = await Bun.file(new URL("../src/repository.ts", import.meta.url)).text();
    expect(source).toContain("worker_private.enqueue_current_job_projection_task");
    expect(source).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/);
    expect(source).not.toContain("fetch(");
    expect(source).not.toContain("/jobs/feed");
  });
});
