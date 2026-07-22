import { ATS_PROVIDERS, classifyAtsUrl, type AtsProvider } from "@hirly/ingestion/ats";

export const ATS_RANKING_QUERIES = {
  hostInventory: `
    SELECT
      apply_host,
      ats_provider,
      jobs,
      companies,
      france_jobs,
      valid_jobs
    FROM public.job_supply_ats_host_baseline
    ORDER BY france_jobs DESC, jobs DESC, apply_host
  `,
  paidUserImpact: `
    SELECT
      source.provider,
      count(DISTINCT contribution.canonical_group_id)::bigint
        FILTER (
          WHERE contribution.incremental
            AND contribution.fresh
            AND contribution.relevant
            AND contribution.actionable
        ) AS incremental_groups,
      coalesce(sum(contribution.affected_paid_users)
        FILTER (
          WHERE contribution.incremental
            AND contribution.fresh
            AND contribution.relevant
            AND contribution.actionable
        ), 0)::bigint AS paid_user_group_impacts
    FROM public.paid_user_source_contributions AS contribution
    JOIN public.career_sources AS source ON source.id = contribution.source_id
    WHERE contribution.coverage_run_id = $1::uuid
    GROUP BY source.provider
    ORDER BY source.provider
  `,
  requestCost: `
    SELECT
      source.provider,
      coalesce(sum(run.request_cost_minor), 0)::bigint AS request_cost_minor,
      CASE
        WHEN count(DISTINCT run.request_cost_currency)
          FILTER (WHERE run.request_cost_currency IS NOT NULL) <= 1
        THEN min(run.request_cost_currency)
        ELSE NULL
      END AS request_cost_currency
    FROM public.worker_runs AS run
    JOIN public.career_sources AS source ON source.id = run.career_source_id
    WHERE run.requested_at >= $1::timestamptz
      AND run.requested_at < $2::timestamptz
    GROUP BY source.provider
    ORDER BY source.provider
  `,
  policyStatus: `
    SELECT
      provider,
      bool_or(production_eligible) AS any_production_eligible,
      bool_and(NOT enabled) AS all_sources_disabled
    FROM public.career_source_activation_status
    GROUP BY provider
    ORDER BY provider
  `,
} as const;

export type AtsRankingQuery = keyof typeof ATS_RANKING_QUERIES;

export interface AtsRankingQueryExecutor {
  query<T extends Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<T[]>;
}

export async function runAtsRankingQueries(
  executor: AtsRankingQueryExecutor,
  input: {
    coverageRunId: string;
    costWindowStart: string;
    costWindowEnd: string;
  },
): Promise<Record<AtsRankingQuery, Record<string, unknown>[]>> {
  const execute = (name: AtsRankingQuery, parameters: readonly unknown[] = []) =>
    executor.query(ATS_RANKING_QUERIES[name], parameters);
  const [hostInventory, paidUserImpact, requestCost, policyStatus] = await Promise.all([
    execute("hostInventory"),
    execute("paidUserImpact", [input.coverageRunId]),
    execute("requestCost", [input.costWindowStart, input.costWindowEnd]),
    execute("policyStatus"),
  ]);
  return { hostInventory, paidUserImpact, requestCost, policyStatus };
}

export function assertReadOnlyAtsRankingQueries(): string[] {
  return Object.entries(ATS_RANKING_QUERIES).flatMap(([name, query]) => {
    const normalized = query.replace(/--.*$/gm, " ").trim().toLowerCase();
    if (!/^(select|with)\b/.test(normalized)) return [`${name}:not_read_only`];
    if (
      /\b(insert|update|delete|merge|truncate|alter|drop|create|grant|revoke)\b/.test(normalized)
    ) {
      return [`${name}:mutation_detected`];
    }
    return [];
  });
}

export interface AtsHostInventoryRow {
  applyHost: string;
  recordedProvider: string | null;
  jobs: number;
  companies: number;
  franceJobs: number;
  validJobs: number;
}

export interface AtsPaidImpactRow {
  provider: AtsProvider;
  incrementalGroups: number;
  paidUserGroupImpacts: number;
}

export interface AtsRequestCostRow {
  provider: AtsProvider;
  requestCostMinor: number | null;
  requestCostCurrency: string | null;
}

export interface AtsPolicyRow {
  provider: AtsProvider;
  anyProductionEligible: boolean;
  allSourcesDisabled: boolean;
}

export interface AtsDeliveryCost {
  provider: AtsProvider;
  engineeringPoints: number;
  maintenancePoints: number;
  policyPoints: number;
  evidenceReference: string;
}

export interface AtsRankedCandidate {
  provider: AtsProvider;
  jobs: number;
  summedHostCompanyCounts: number;
  franceJobs: number;
  validJobs: number;
  incrementalGroups: number;
  paidUserGroupImpacts: number;
  deliveryCostPoints: number | null;
  paidUserGroupImpactsPerDeliveryPoint: number | null;
  incrementalGroupsPerDeliveryPoint: number | null;
  requestCostMinorPerIncrementalGroup: number | null;
  requestCostCurrency: string | null;
  policyEligible: boolean;
  allSourcesDisabled: boolean;
  evidenceReferences: string[];
}

export interface AtsRankingReport {
  schemaVersion: 1;
  status: "COMPLETE" | "BLOCKED_EXTERNAL";
  blockerReason: string | null;
  sampleEvidence: boolean;
  connectorChoice: AtsProvider | null;
  ranking: AtsRankedCandidate[];
}

function finiteNonNegative(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field}_must_be_finite_non_negative`);
  }
  return value;
}

function providerForHost(row: AtsHostInventoryRow): AtsProvider | null {
  const classified = classifyAtsUrl(`https://${row.applyHost}/`).provider;
  if (classified) return classified;
  const recorded = row.recordedProvider?.trim().toLowerCase() ?? "";
  return ATS_PROVIDERS.find((provider) => provider === recorded) ?? null;
}

function ratio(numerator: number, denominator: number | null): number | null {
  return denominator && denominator > 0 ? numerator / denominator : null;
}

export function rankAtsCandidates(input: {
  status: "COMPLETE" | "BLOCKED_EXTERNAL";
  blockerReason?: string;
  sampleEvidence?: boolean;
  hostInventory: AtsHostInventoryRow[];
  paidImpact: AtsPaidImpactRow[];
  requestCosts: AtsRequestCostRow[];
  policy: AtsPolicyRow[];
  deliveryCosts: AtsDeliveryCost[];
}): AtsRankingReport {
  const inventory = new Map<
    AtsProvider,
    { jobs: number; companies: number; franceJobs: number; validJobs: number }
  >();
  for (const row of input.hostInventory) {
    const provider = providerForHost(row);
    if (!provider) continue;
    const current = inventory.get(provider) ?? {
      jobs: 0,
      companies: 0,
      franceJobs: 0,
      validJobs: 0,
    };
    current.jobs += finiteNonNegative(row.jobs, "jobs");
    current.companies += finiteNonNegative(row.companies, "companies");
    current.franceJobs += finiteNonNegative(row.franceJobs, "france_jobs");
    current.validJobs += finiteNonNegative(row.validJobs, "valid_jobs");
    inventory.set(provider, current);
  }

  const paidImpact = new Map(input.paidImpact.map((row) => [row.provider, row]));
  const costs = new Map(input.requestCosts.map((row) => [row.provider, row]));
  const policies = new Map(input.policy.map((row) => [row.provider, row]));
  const deliveryCosts = new Map(input.deliveryCosts.map((row) => [row.provider, row]));
  const providers = new Set<AtsProvider>([
    ...inventory.keys(),
    ...paidImpact.keys(),
    ...costs.keys(),
    ...policies.keys(),
    ...deliveryCosts.keys(),
  ]);

  const ranking = [...providers].map((provider): AtsRankedCandidate => {
    const host = inventory.get(provider) ?? {
      jobs: 0,
      companies: 0,
      franceJobs: 0,
      validJobs: 0,
    };
    const impact = paidImpact.get(provider);
    const requestCost = costs.get(provider);
    const policy = policies.get(provider);
    const delivery = deliveryCosts.get(provider);
    const deliveryCostPoints = delivery
      ? finiteNonNegative(delivery.engineeringPoints, "engineering_points") +
        finiteNonNegative(delivery.maintenancePoints, "maintenance_points") +
        finiteNonNegative(delivery.policyPoints, "policy_points")
      : null;
    const incrementalGroups = finiteNonNegative(
      impact?.incrementalGroups ?? 0,
      "incremental_groups",
    );
    const paidUserGroupImpacts = finiteNonNegative(
      impact?.paidUserGroupImpacts ?? 0,
      "paid_user_group_impacts",
    );
    return {
      provider,
      jobs: host.jobs,
      summedHostCompanyCounts: host.companies,
      franceJobs: host.franceJobs,
      validJobs: host.validJobs,
      incrementalGroups,
      paidUserGroupImpacts,
      deliveryCostPoints,
      paidUserGroupImpactsPerDeliveryPoint: ratio(paidUserGroupImpacts, deliveryCostPoints),
      incrementalGroupsPerDeliveryPoint: ratio(incrementalGroups, deliveryCostPoints),
      requestCostMinorPerIncrementalGroup:
        requestCost?.requestCostMinor !== null &&
        requestCost?.requestCostMinor !== undefined &&
        requestCost.requestCostCurrency
          ? ratio(requestCost.requestCostMinor, incrementalGroups)
          : null,
      requestCostCurrency: requestCost?.requestCostCurrency ?? null,
      policyEligible: policy?.anyProductionEligible === true,
      allSourcesDisabled: policy?.allSourcesDisabled !== false,
      evidenceReferences: delivery ? [delivery.evidenceReference] : [],
    };
  });

  ranking.sort((left, right) => {
    const impact =
      (right.paidUserGroupImpactsPerDeliveryPoint ?? -1) -
      (left.paidUserGroupImpactsPerDeliveryPoint ?? -1);
    if (impact !== 0) return impact;
    const groups =
      (right.incrementalGroupsPerDeliveryPoint ?? -1) -
      (left.incrementalGroupsPerDeliveryPoint ?? -1);
    if (groups !== 0) return groups;
    if (left.requestCostCurrency && left.requestCostCurrency === right.requestCostCurrency) {
      const leftRequestCost = left.requestCostMinorPerIncrementalGroup ?? Number.POSITIVE_INFINITY;
      const rightRequestCost =
        right.requestCostMinorPerIncrementalGroup ?? Number.POSITIVE_INFINITY;
      if (leftRequestCost !== rightRequestCost) {
        return leftRequestCost - rightRequestCost;
      }
    }
    return left.provider.localeCompare(right.provider);
  });

  const complete = input.status === "COMPLETE";
  return {
    schemaVersion: 1,
    status: input.status,
    blockerReason: complete ? null : (input.blockerReason ?? "live_evidence_unavailable"),
    sampleEvidence: input.sampleEvidence === true,
    connectorChoice:
      complete && input.sampleEvidence !== true
        ? (ranking.find(
            (candidate) =>
              candidate.policyEligible &&
              candidate.incrementalGroups > 0 &&
              candidate.paidUserGroupImpacts > 0 &&
              candidate.deliveryCostPoints !== null &&
              candidate.paidUserGroupImpactsPerDeliveryPoint !== null &&
              candidate.requestCostMinorPerIncrementalGroup !== null,
          )?.provider ?? null)
        : null,
    ranking,
  };
}
