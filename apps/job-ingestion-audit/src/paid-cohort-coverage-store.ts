import type { Database } from "@hirly/db";
import type postgres from "postgres";
import {
  coverageDigest,
  type CoverageCandidate,
  type CoverageEvidence,
  type PaidCohortCoverageStore,
  type TrialSourceBinding,
} from "./paid-cohort-coverage";

const asJson = (value: unknown): postgres.JSONValue =>
  JSON.parse(JSON.stringify(value)) as postgres.JSONValue;

const titleTokens = (value: string | null): string[] => [
  ...new Set(
    (value ?? "")
      .normalize("NFKD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .split(/[^a-z0-9+#.-]+/)
      .filter((token) => token.length >= 2),
  ),
];

export class PostgresPaidCohortCoverageStore implements PaidCohortCoverageStore {
  constructor(private readonly sql: Database) {}

  async loadCurrentCandidates(freshnessCutoff: string): Promise<CoverageCandidate[]> {
    const rows = await this.sql<
      {
        canonical_group_digest: string;
        provider: string;
        title: string | null;
        country_code: string | null;
        fresh_at: Date;
        actionable: boolean;
        route_known: boolean;
        direct_employer: boolean;
      }[]
    >`
      SELECT
        encode(digest(
          coalesce(
            'group:' || jobs.canonical_group_id::text,
            'fingerprint:' || nullif(btrim(jobs.fingerprint), ''),
            'url:' || nullif(lower(btrim(coalesce(
              jobs.canonical_apply_url, jobs.selected_apply_url
            ))), ''),
            'occurrence:' || lower(coalesce(jobs.provider, 'unknown'))
              || ':' || nullif(btrim(jobs.external_id), ''),
            'job:' || jobs.job_id
          ),
          'sha256'
        ), 'hex') AS canonical_group_digest,
        lower(coalesce(jobs.provider, 'unknown')) AS provider,
        coalesce(jobs.normalized_title, jobs.title) AS title,
        upper(jobs.country_code) AS country_code,
        greatest(
          coalesce(jobs.last_seen_at, '-infinity'::timestamptz),
          coalesce(jobs.imported_at, '-infinity'::timestamptz),
          coalesce(jobs.posted_at, '-infinity'::timestamptz)
        ) AS fresh_at,
        (
          jobs.selected_apply_url IS NOT NULL
          AND jobs.validation_status = 'valid'
          AND jobs.applyability_tier IN ('A', 'B')
          AND NOT coalesce(jobs.requires_login, false)
          AND NOT coalesce(jobs.requires_account_creation, false)
          AND NOT coalesce(jobs.captcha_detected, false)
        ) AS actionable,
        (
          nullif(lower(btrim(coalesce(jobs.ats_provider, ''))), '') IS NOT NULL
          OR nullif(lower(btrim(coalesce(jobs.apply_url_provider, ''))), '') IS NOT NULL
        ) AS route_known,
        lower(coalesce(jobs.provider, '')) = lower(coalesce(jobs.ats_provider, ''))
          AS direct_employer
      FROM public.jobs AS jobs
      WHERE greatest(
        coalesce(jobs.last_seen_at, '-infinity'::timestamptz),
        coalesce(jobs.imported_at, '-infinity'::timestamptz),
        coalesce(jobs.posted_at, '-infinity'::timestamptz)
      ) >= ${new Date(freshnessCutoff)}
    `;
    return rows.map((row) => ({
      canonicalGroupDigest: row.canonical_group_digest,
      sourceId: null,
      provider: row.provider,
      tenantKey: null,
      titleTokens: titleTokens(row.title),
      countryCode: row.country_code,
      freshAt: row.fresh_at.toISOString(),
      actionable: row.actionable,
      routeKnown: row.route_known,
      directEmployer: row.direct_employer,
    }));
  }

  async loadTrialCandidates(
    bindings: TrialSourceBinding[],
    generatedAt: string,
  ): Promise<CoverageCandidate[]> {
    const generated = new Date(generatedAt);
    const verified: TrialSourceBinding[] = [];
    for (const binding of bindings) {
      const [run] = await this.sql<
        {
          id: string;
          source_id: string;
          provider: string;
          tenant_key: string;
          terminal_status: string | null;
          terminal_at: Date | null;
          future_pages: string;
          future_candidates: string;
        }[]
      >`
        SELECT
          run.id,
          run.source_id,
          lower(run.provider) AS provider,
          run.tenant_key,
          terminal.result->>'status' AS terminal_status,
          terminal.created_at AS terminal_at,
          (
            SELECT count(*)::text FROM public.source_trial_pages AS page
            WHERE page.run_id = run.id
              AND (page.created_at > ${generated} OR page.fetched_at > ${generated})
          ) AS future_pages,
          (
            SELECT count(*)::text FROM public.source_trial_candidates AS candidate
            WHERE candidate.run_id = run.id AND candidate.created_at > ${generated}
          ) AS future_candidates
        FROM public.source_trial_runs AS run
        LEFT JOIN public.source_trial_scorecards AS terminal
          ON terminal.run_id = run.id AND terminal.scorecard_key = 'trial-result'
        WHERE run.id = ${binding.trialRunId}::uuid
      `;
      if (
        !run ||
        run.source_id !== binding.sourceId ||
        run.provider !== binding.provider ||
        run.tenant_key !== binding.tenantKey ||
        run.terminal_status !== "completed" ||
        run.terminal_at === null ||
        run.terminal_at > generated ||
        Number(run.future_pages) !== 0 ||
        Number(run.future_candidates) !== 0
      ) {
        throw new Error(
          `PAID_COHORT_COVERAGE_REFUSED: unverified trial binding ${binding.trialRunId}`,
        );
      }
      verified.push(binding);
    }

    const candidates: CoverageCandidate[] = [];
    for (const binding of verified) {
      const rows = await this.sql<
        {
          canonical_group_digest: string;
          source_id: string;
          provider: string;
          tenant_key: string;
          title: string | null;
          country_code: string | null;
          fresh_at: Date;
          actionable: boolean;
          route_known: boolean;
          direct_employer: boolean;
        }[]
      >`
        SELECT
          encode(digest(
            coalesce(
              'group:' || nullif(candidate.candidate->>'canonicalGroupId', ''),
              'fingerprint:' || nullif(candidate.candidate->>'fingerprint', ''),
              'url:' || nullif(lower(btrim(candidate.candidate->>'selectedApplyUrl')), ''),
              'occurrence:' || lower(run.provider) || ':'
                || nullif(candidate.candidate->>'externalId', ''),
              'candidate:' || candidate.content_hash
            ),
            'sha256'
          ), 'hex') AS canonical_group_digest,
          run.source_id,
          lower(run.provider) AS provider,
          run.tenant_key,
          coalesce(
            candidate.candidate->>'normalizedTitle',
            candidate.candidate->>'title'
          ) AS title,
          upper(coalesce(
            candidate.candidate->>'countryCode',
            candidate.candidate#>>'{location,countryCode}'
          )) AS country_code,
          coalesce(
            (candidate.candidate->>'lastSeenAt')::timestamptz,
            (candidate.candidate->>'publishedAt')::timestamptz,
            candidate.created_at
          ) AS fresh_at,
          (
            nullif(candidate.candidate->>'selectedApplyUrl', '') IS NOT NULL
            AND candidate.candidate->>'validationStatus' = 'valid'
            AND candidate.candidate->>'applyabilityTier' IN ('A', 'B')
            AND coalesce((candidate.candidate->>'requiresLogin')::boolean, false) = false
            AND coalesce(
              (candidate.candidate->>'requiresAccountCreation')::boolean, false
            ) = false
            AND coalesce((candidate.candidate->>'captchaDetected')::boolean, false) = false
          ) AS actionable,
          nullif(lower(btrim(coalesce(
            candidate.candidate->>'atsProvider', run.provider
          ))), '') IS NOT NULL AS route_known,
          lower(coalesce(candidate.candidate->>'atsProvider', run.provider))
            = lower(run.provider) AS direct_employer
        FROM public.source_trial_candidates AS candidate
        JOIN public.source_trial_runs AS run ON run.id = candidate.run_id
        WHERE candidate.run_id = ${binding.trialRunId}::uuid
          AND candidate.created_at <= ${generated}
      `;
      candidates.push(
        ...rows.map((row) => ({
          canonicalGroupDigest: row.canonical_group_digest,
          sourceId: row.source_id,
          provider: row.provider,
          tenantKey: row.tenant_key,
          titleTokens: titleTokens(row.title),
          countryCode: row.country_code,
          freshAt: row.fresh_at.toISOString(),
          actionable: row.actionable,
          routeKnown: row.route_known,
          directEmployer: row.direct_employer,
        })),
      );
    }
    return candidates;
  }

  async persistEvidence(evidence: CoverageEvidence): Promise<"persisted" | "idempotent"> {
    return this.sql.begin(async (transaction) => {
      const [run] = await transaction<
        {
          kind: string;
          provider: string | null;
          status: string;
          requested_at: Date;
          started_at: Date | null;
          summary: Record<string, unknown>;
        }[]
      >`
        SELECT kind, provider, status, requested_at, started_at, summary
        FROM public.worker_runs
        WHERE id = ${evidence.coverageRunId}::uuid
        FOR UPDATE
      `;
      if (run?.kind !== "inventory_maintenance" || run.provider !== null) {
        throw new Error("PAID_COHORT_COVERAGE_REFUSED: invalid coverage run boundary");
      }
      if (run.status === "succeeded") {
        if (
          run.summary?.evidenceDigest === evidence.evidenceDigest &&
          run.summary?.cohortDigest === evidence.cohortDigest
        )
          return "idempotent";
        throw new Error("PAID_COHORT_COVERAGE_REFUSED: completed run evidence mismatch");
      }
      const generated = new Date(evidence.generatedAt);
      if (
        run.status !== "running" ||
        run.started_at === null ||
        run.requested_at > generated ||
        run.started_at > generated
      ) {
        throw new Error("PAID_COHORT_COVERAGE_REFUSED: coverage run is not writable");
      }

      for (const snapshot of evidence.snapshots) {
        await transaction`
          INSERT INTO public.paid_user_inventory_snapshots (
            coverage_run_id, hashed_user_id, evaluated_at, cohort_dimensions,
            source_set, freshness_window_days, relevant_total, unique_total,
            actionable_total, unseen_actionable_total, route_known_total,
            direct_employer_total, terminal_reason, evaluator_version, created_at
          ) VALUES (
            ${evidence.coverageRunId}::uuid,
            ${snapshot.hashedUserId},
            ${new Date(snapshot.evaluatedAt)},
            ${transaction.json(asJson(snapshot.cohortDimensions))},
            ${snapshot.sourceSet},
            ${snapshot.freshnessWindowDays},
            ${snapshot.relevantTotal},
            ${snapshot.uniqueTotal},
            ${snapshot.actionableTotal},
            ${snapshot.unseenActionableTotal},
            ${snapshot.routeKnownTotal},
            ${snapshot.directEmployerTotal},
            ${snapshot.terminalReason},
            ${snapshot.evaluatorVersion},
            ${generated}
          )
        `;
      }
      for (const contribution of evidence.contributions) {
        await transaction`
          INSERT INTO public.paid_user_source_contributions (
            coverage_run_id, source_id, canonical_group_id, affected_paid_users,
            incremental, fresh, relevant, actionable, created_at
          ) VALUES (
            ${evidence.coverageRunId}::uuid,
            ${contribution.sourceId}::uuid,
            ${contribution.canonicalGroupId},
            ${contribution.affectedPaidUsers},
            ${contribution.incremental},
            ${contribution.fresh},
            ${contribution.relevant},
            ${contribution.actionable},
            ${generated}
          )
        `;
      }
      const [updated] = await transaction<{ id: string }[]>`
        UPDATE public.worker_runs
        SET
          status = 'succeeded',
          finished_at = ${generated},
          summary = ${transaction.json(asJson(evidence.summary))},
          updated_at = ${generated}
        WHERE id = ${evidence.coverageRunId}::uuid
          AND status = 'running'
        RETURNING id
      `;
      if (!updated) throw new Error("PAID_COHORT_COVERAGE_REFUSED: coverage run changed");
      return "persisted";
    });
  }
}

export function assertCoverageStoreHasNoCanonicalWrites(): void {
  const source = `${PostgresPaidCohortCoverageStore.prototype.persistEvidence}`;
  if (
    /\b(insert\s+into|update|delete\s+from)\s+public\.(jobs|job_occurrences|canonical_jobs)\b/i.test(
      source,
    )
  ) {
    throw new Error("coverage store contains a canonical inventory mutation");
  }
  // Retain an exported deterministic marker for release checks.
  coverageDigest(["paid_user_inventory_snapshots", "paid_user_source_contributions"]);
}
