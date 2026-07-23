import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import postgres from "postgres";
import { FEED_V2_INDEXED_READ_SQL, PostgresFeedReadRepository } from "./repository";

const CANDIDATE_ID = "feed-v2-load-evidence-candidate";
const REQUIRED_INDEXES = [
  "candidate_search_profiles_active_country_role_idx",
  "job_search_documents_active_recency_idx",
  "job_search_documents_active_projected_idx",
  "candidate_action_projection_exclusion_idx",
] as const;
export const DEFAULT_BASELINE_CONCURRENCY = 16;

export function percentile(samples: readonly number[], percentileValue: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * percentileValue) - 1)] ?? 0;
}

export function planFacts(value: unknown): {
  nodeTypes: string[];
  indexNames: string[];
  sharedHitBlocks: number;
  sharedReadBlocks: number;
} {
  const nodeTypes = new Set<string>();
  const indexNames = new Set<string>();
  let sharedHitBlocks = 0;
  let sharedReadBlocks = 0;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (key === "Node Type" && typeof child === "string") nodeTypes.add(child);
      if (key === "Index Name" && typeof child === "string") indexNames.add(child);
      if (key === "Shared Hit Blocks" && typeof child === "number") sharedHitBlocks += child;
      if (key === "Shared Read Blocks" && typeof child === "number") sharedReadBlocks += child;
      visit(child);
    }
  };
  visit(value);
  return {
    nodeTypes: [...nodeTypes].sort(),
    indexNames: [...indexNames].sort(),
    sharedHitBlocks,
    sharedReadBlocks,
  };
}

function localDisposableDatabase(databaseUrl: string): void {
  const url = new URL(databaseUrl);
  if (
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
    !url.pathname.slice(1).startsWith("hirly_feed_v2_evidence")
  ) {
    throw new Error("refusing non-local or non-disposable evidence database");
  }
}

async function measure<T>(operation: () => Promise<T>): Promise<{ elapsedMs: number; value: T }> {
  const started = performance.now();
  const value = await operation();
  return { elapsedMs: performance.now() - started, value };
}

export async function runLoadEvidence(input: {
  databaseUrl: string;
  outputPath: string;
  cardinality: number;
  samples: number;
  baselineConcurrency: number;
}): Promise<void> {
  localDisposableDatabase(input.databaseUrl);
  if (!Number.isSafeInteger(input.cardinality) || input.cardinality < 10_000)
    throw new Error("cardinality must be at least 10000");
  const sql = postgres(input.databaseUrl, { max: input.baselineConcurrency * 2 + 2 });
  try {
    await sql.unsafe(
      "TRUNCATE public.candidate_action_projection, public.candidate_search_profiles, public.job_search_documents",
    );
    await sql.unsafe(
      `INSERT INTO public.candidate_search_profiles (
      candidate_id, version, status, target_role_label_normalized, role_family_ids,
      skill_ids, contract_types, work_modes, country_codes, location_policy,
      origin_latitude, origin_longitude, radius_km, freshness_window_days,
      exposure_policy_version, feature_schema_version, source_profile_updated_at,
      projected_at, source_event_id
    ) VALUES ($1, 1, 'active', 'fullstack engineer', ARRAY['fullstack-engineering'],
      ARRAY['typescript'], ARRAY['permanent'], ARRAY['remote','onsite'], ARRAY['FR'],
      'explicit', 48.8566, 2.3522, 52, 30, 'exposure-v1', 'features-v1',
      clock_timestamp(), clock_timestamp(), gen_random_uuid())`,
      [CANDIDATE_ID],
    );
    await sql.unsafe(
      `INSERT INTO public.job_search_documents (
      canonical_group_id, preferred_job_id, job_version, lifecycle_status,
      normalized_title, role_family_codes, skill_codes, contract_families,
      work_modes, country_codes, location_confidence, location_unknown,
      posted_at, last_seen_at, validation_status, applyability_tier,
      fulfillment_route, source_eligible, policy_eligible, feature_schema_version,
      search_text, projected_at
    ) SELECT md5('feed-load-' || n::text)::uuid, 'feed-load-job-' || n::text, 1,
      'active', CASE WHEN n % 10 = 0 THEN 'fullstack engineer' ELSE 'account manager' END,
      CASE WHEN n % 10 = 0 THEN ARRAY['fullstack-engineering'] ELSE ARRAY['sales'] END,
      CASE WHEN n % 10 = 0 THEN ARRAY['typescript'] ELSE ARRAY['crm'] END,
      ARRAY['permanent'], CASE WHEN n % 2 = 0 THEN ARRAY['remote'] ELSE ARRAY['onsite'] END,
      CASE WHEN n % 5 = 0 THEN ARRAY['FR'] ELSE ARRAY['DE'] END, 1, true,
      clock_timestamp() - interval '7 days', clock_timestamp(), 'valid', 'B',
      CASE WHEN n % 3 = 0 THEN 'auto' ELSE 'manual' END, true, true,
      'features-v1', CASE WHEN n % 10 = 0 THEN 'fullstack engineer typescript' ELSE 'account manager crm' END,
      clock_timestamp()
    FROM generate_series(1, $1::integer) AS fixture(n)`,
      [input.cardinality],
    );
    await sql.unsafe("ANALYZE public.candidate_search_profiles");
    await sql.unsafe("ANALYZE public.candidate_action_projection");
    await sql.unsafe("ANALYZE public.job_search_documents");

    const parameters = [
      CANDIDATE_ID,
      null,
      null,
      13,
      "candidate-profile",
      null,
      [],
      [],
      [],
      [],
      [],
      [],
      1,
      false,
    ];
    const plan = await sql.unsafe(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${FEED_V2_INDEXED_READ_SQL}`,
      parameters,
    );
    const explainPlan = (plan[0] as { "QUERY PLAN"?: unknown } | undefined)?.["QUERY PLAN"] ?? plan;
    const facts = planFacts(explainPlan);
    const availableIndexes = await sql.unsafe<Array<{ indexname: string }>>(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1::text[]) ORDER BY indexname",
      [REQUIRED_INDEXES],
    );
    const repository = new PostgresFeedReadRepository({
      unsafe: async (query, queryParameters) =>
        (await sql.unsafe(query, [...queryParameters] as never[])) as never,
    });
    const first = await repository.readIndexedCandidates({
      candidateId: CANDIDATE_ID,
      effectiveQuery: null,
      limit: 12,
      after: null,
    });
    if (
      first.candidates.length !== 12 ||
      new Set(first.candidates.map((row) => row.canonicalGroupId)).size !== 12
    ) {
      throw new Error("Feed v2 first page correctness assertion failed");
    }
    for (let index = 0; index < 5; index += 1) {
      await repository.readIndexedCandidates({
        candidateId: CANDIDATE_ID,
        effectiveQuery: null,
        limit: 12,
        after: null,
      });
    }
    const samples: number[] = [];
    for (let index = 0; index < input.samples; index += 1) {
      samples.push(
        (
          await measure(() =>
            repository.readIndexedCandidates({
              candidateId: CANDIDATE_ID,
              effectiveQuery: null,
              limit: 12,
              after: null,
            }),
          )
        ).elapsedMs,
      );
    }
    const peakConcurrency = input.baselineConcurrency * 2;
    const concurrent = await Promise.all(
      Array.from({ length: peakConcurrency }, () =>
        measure(() =>
          repository.readIndexedCandidates({
            candidateId: CANDIDATE_ID,
            effectiveQuery: null,
            limit: 12,
            after: null,
          }),
        ),
      ),
    );
    const latency = {
      p50Ms: percentile(samples, 0.5),
      p95Ms: percentile(samples, 0.95),
      p99Ms: percentile(samples, 0.99),
      peakX2Concurrency: peakConcurrency,
      peakX2P99Ms: percentile(
        concurrent.map((sample) => sample.elapsedMs),
        0.99,
      ),
    };
    const assertions = {
      requiredIndexesPresent: REQUIRED_INDEXES.every((name) =>
        availableIndexes.some((row) => row.indexname === name),
      ),
      noSequentialScan: !facts.nodeTypes.includes("Seq Scan"),
      recencyIndexUsed: facts.indexNames.includes("job_search_documents_active_recency_idx"),
      projectedIndexUsed: facts.indexNames.includes("job_search_documents_active_projected_idx"),
      explainBuffersCaptured: facts.sharedHitBlocks + facts.sharedReadBlocks > 0,
      resultCorrect: true,
      p50Within150Ms: latency.p50Ms <= 150,
      p95Within300Ms: latency.p95Ms <= 300,
      p99Within750Ms: latency.p99Ms <= 750,
      peakX2Within750Ms: latency.peakX2P99Ms <= 750,
    };
    const evidence = {
      schemaVersion: "hirly.feed-v2-load-evidence.v1",
      generatedAt: process.env.FEED_V2_EVIDENCE_GENERATED_AT ?? new Date().toISOString(),
      environment: {
        postgresMajor: 15,
        disposableLocalOnly: true,
        providerCalls: 0,
        canonicalProductionWrites: 0,
      },
      input: {
        cardinality: input.cardinality,
        firstPageLimit: 12,
        samples: input.samples,
        baselineConcurrency: input.baselineConcurrency,
      },
      queryDigest: createHash("sha256").update(FEED_V2_INDEXED_READ_SQL).digest("hex"),
      resultDigest: createHash("sha256").update(JSON.stringify(first.candidates)).digest("hex"),
      plan: {
        nodeTypes: facts.nodeTypes,
        indexNames: facts.indexNames,
        requiredIndexes: REQUIRED_INDEXES,
        raw: explainPlan,
      },
      latency,
      assertions,
      releaseDecision: Object.values(assertions).every(Boolean) ? "PASS" : "BLOCKED",
    };
    await mkdir(dirname(resolve(input.outputPath)), { recursive: true });
    await writeFile(resolve(input.outputPath), `${JSON.stringify(evidence, null, 2)}\n`);
    if (evidence.releaseDecision !== "PASS")
      throw new Error(`Feed v2 load evidence blocked: ${JSON.stringify(assertions)}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.main) {
  const databaseUrl = process.env.FEED_V2_EVIDENCE_DATABASE_URL;
  if (!databaseUrl) throw new Error("FEED_V2_EVIDENCE_DATABASE_URL is required");
  await runLoadEvidence({
    databaseUrl,
    outputPath: process.argv[2] ?? "artifacts/candidate-matching/feed-v2-load-evidence.json",
    cardinality: Number(process.env.FEED_V2_EVIDENCE_CARDINALITY ?? "300000"),
    samples: Number(process.env.FEED_V2_EVIDENCE_SAMPLES ?? "50"),
    baselineConcurrency: Number(
      process.env.FEED_V2_EVIDENCE_BASELINE_CONCURRENCY ?? DEFAULT_BASELINE_CONCURRENCY,
    ),
  });
}
