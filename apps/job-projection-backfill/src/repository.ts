import type { Database } from "@hirly/db";
import type {
  ProjectionBackfillCandidate,
  ProjectionBackfillRepository,
  ProjectionBackfillScope,
} from "./backfill";

interface CandidateRow {
  canonical_group_id: string;
  provider: string;
  country_code: string | null;
  role_keys: string[];
  source_digest: string;
}

export class PostgresProjectionBackfillRepository implements ProjectionBackfillRepository {
  constructor(private readonly sql: Database) {}

  async listCandidates(input: {
    cursor: string | null;
    limit: number;
    scope: ProjectionBackfillScope;
  }): Promise<ProjectionBackfillCandidate[]> {
    const rows = await this.sql<CandidateRow[]>`
      SELECT group_row.id::text AS canonical_group_id,
        job.provider,
        upper(job.country_code) AS country_code,
        ARRAY(
          SELECT DISTINCT lower(role_key)
          FROM unnest(
            ARRAY[lower(job.normalized_title)]
            || ARRAY(SELECT jsonb_array_elements_text(
              coalesce(job.data->'role_family_ids', '[]'::jsonb)
            ))
            || ARRAY(SELECT jsonb_array_elements_text(
              coalesce(job.data->'role_family_codes', '[]'::jsonb)
            ))
          ) AS role_key
          WHERE length(btrim(role_key)) > 0
          ORDER BY lower(role_key)
        ) AS role_keys,
        worker_private.job_projection_source_digest(group_row.id) AS source_digest
      FROM public.canonical_job_groups AS group_row
      JOIN public.jobs AS job ON job.job_id = group_row.preferred_job_id
      WHERE group_row.status = 'active'
        AND (${input.cursor}::uuid IS NULL OR group_row.id > ${input.cursor}::uuid)
        AND (${input.scope.countryCode ?? null}::text IS NULL
          OR upper(job.country_code) = ${input.scope.countryCode ?? null})
        AND (${input.scope.provider ?? null}::text IS NULL
          OR lower(job.provider) = ${input.scope.provider ?? null})
        AND (${input.scope.role ?? null}::text IS NULL OR (
          lower(job.normalized_title) LIKE '%' || ${input.scope.role ?? null} || '%'
          OR coalesce(job.data->'role_family_ids', '[]'::jsonb) ? ${input.scope.role ?? null}
          OR coalesce(job.data->'role_family_codes', '[]'::jsonb) ? ${input.scope.role ?? null}
        ))
      ORDER BY group_row.id
      LIMIT ${input.limit}
    `;
    return rows.map((row) => ({
      canonicalGroupId: row.canonical_group_id,
      provider: row.provider,
      countryCode: row.country_code,
      roleKeys: row.role_keys,
      sourceDigest: row.source_digest,
    }));
  }

  async enqueue(candidate: ProjectionBackfillCandidate): Promise<"enqueued" | "existing"> {
    return this.sql.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${candidate.canonicalGroupId}, 0))`;
      const [existing] = await transaction<{ present: boolean }[]>`
        SELECT EXISTS (
          SELECT 1
          FROM public.projection_reconciliation_tasks
          WHERE task_kind = 'job.document.project'
            AND entity_id = ${candidate.canonicalGroupId}
            AND source_digest = ${candidate.sourceDigest}
            AND status IN ('queued', 'running', 'retryable', 'succeeded')
        ) AS present
      `;
      if (existing?.present === true) return "existing";
      const [row] = await transaction<{ inserted: number }[]>`
        SELECT worker_private.enqueue_current_job_projection_task(
          ${candidate.canonicalGroupId}::uuid,
          ${candidate.sourceDigest}
        ) AS inserted
      `;
      return row?.inserted === 1 ? "enqueued" : "existing";
    });
  }
}
