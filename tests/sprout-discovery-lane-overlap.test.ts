import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL(
    "../backend/db/migrations/20260721003300_sprout_occurrence_overlap.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("Sprout discovery lane occurrence writer", () => {
  test("keeps canonical occurrence provenance while allowing an overlapping lane", () => {
    const occurrenceUpsert = migration.match(
      /INSERT INTO public\.job_occurrences[\s\S]*?;\n\s*v_occurrences :=/,
    )?.[0];

    expect(occurrenceUpsert).toBeDefined();
    expect(occurrenceUpsert).toContain("ON CONFLICT (job_id) DO UPDATE");
    expect(occurrenceUpsert).toContain("raw_job_snapshots");
    expect(occurrenceUpsert).not.toMatch(/raw_snapshot_id\s*=/i);
    expect(occurrenceUpsert).not.toMatch(/source_id\s*=/i);
    expect(occurrenceUpsert).not.toMatch(/content_hash\s*=/i);
    expect(occurrenceUpsert).toContain("last_seen_at = GREATEST");
  });
});
