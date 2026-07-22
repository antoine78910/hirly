export interface FeedV2ReadinessInput {
  delegationEnabled?: boolean;
  internalUrl?: string;
  assertionSecretLength?: number;
  cohortUserIds?: string[];
  smokeCandidateId?: string;
  sloMs?: number;
  health?: { status?: string; routingEnabled?: boolean; latencyMs?: number };
  publicSmoke?: {
    role?: string;
    location?: string;
    radiusKm?: number;
    latencyMs?: number;
    status?: number;
    body?: Record<string, unknown>;
  };
}

export interface FeedV2ReadinessEvidence {
  schemaVersion: "hirly.feed-v2-readiness.v1";
  configurationStatus: "READY" | "NOT_READY";
  deploymentStatus: "READY" | "NOT_READY";
  unmetReasons: string[];
  checks: Record<string, boolean>;
  smoke: {
    supplied: boolean;
    role: string | null;
    location: string | null;
    radiusKm: number | null;
    latencyMs: number | null;
    jobCount: number | null;
  };
}

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

function validInternalUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function sideEffects(body: Record<string, unknown>): boolean {
  const refreshes = Array.isArray(body.refresh_results) ? body.refresh_results : [];
  return (
    body.background_refresh_scheduled === true ||
    body.jsearch_attempted === true ||
    body.provider_refresh_attempted === true ||
    refreshes.some((entry) => object(entry)?.attempted === true)
  );
}

export function evaluateFeedV2Readiness(input: FeedV2ReadinessInput = {}): FeedV2ReadinessEvidence {
  const reasons: string[] = [];
  const sloMs = number(input.sloMs) ?? 1_500;
  const cohort = [
    ...new Set((input.cohortUserIds ?? []).map((value) => value.trim()).filter(Boolean)),
  ];
  const cohortReady =
    cohort.length === 0 ||
    Boolean(input.smokeCandidateId && cohort.includes(input.smokeCandidateId));
  const healthLatency = number(input.health?.latencyMs);
  const checks = {
    delegationEnabled: input.delegationEnabled === true,
    internalUrlValid: validInternalUrl(input.internalUrl),
    assertionSecretConfigured: (input.assertionSecretLength ?? 0) >= 32,
    cohortTargeted: cohortReady,
    healthLive: input.health?.status === "live",
    healthRoutingEnabled: input.health?.routingEnabled === true,
    healthWithinSlo: healthLatency !== null && healthLatency <= sloMs,
  };
  for (const [key, passed] of Object.entries(checks))
    if (!passed) reasons.push(`configuration:${key}`);

  const smoke = input.publicSmoke;
  const body = object(smoke?.body);
  const jobs = body && Array.isArray(body.jobs) ? body.jobs : null;
  const latency = number(smoke?.latencyMs);
  if (!smoke) reasons.push("smoke:not_supplied");
  else {
    if (smoke.status !== 200) reasons.push("smoke:http_not_200");
    if (!smoke.role?.trim() || !smoke.location?.trim() || number(smoke.radiusKm) === null) {
      reasons.push("smoke:explicit_query_missing");
    }
    if (latency === null || latency > sloMs) reasons.push("smoke:latency_exceeded");
    if (!body) reasons.push("smoke:invalid_body");
    else {
      if (
        body.feed_mode === "legacy_jsearch_only" ||
        body.fallback_used === "legacy_jsearch_only"
      ) {
        reasons.push("smoke:legacy_jsearch_only");
      }
      if (sideEffects(body)) reasons.push("smoke:get_side_effect_detected");
      const fetched =
        number(body.total_count) ?? number(body.jsearch_count) ?? number(body.fetched_count) ?? 0;
      if (jobs && jobs.length === 0 && fetched > 0)
        reasons.push("smoke:empty_despite_fetched_inventory");
      if (!jobs) reasons.push("smoke:jobs_missing");
    }
  }
  const unmetReasons = [...new Set(reasons)].sort();
  const configurationStatus = Object.values(checks).every(Boolean) ? "READY" : "NOT_READY";
  return {
    schemaVersion: "hirly.feed-v2-readiness.v1",
    configurationStatus,
    deploymentStatus:
      configurationStatus === "READY" && unmetReasons.length === 0 ? "READY" : "NOT_READY",
    unmetReasons,
    checks,
    smoke: {
      supplied: Boolean(smoke),
      role: smoke?.role?.trim() || null,
      location: smoke?.location?.trim() || null,
      radiusKm: number(smoke?.radiusKm),
      latencyMs: latency,
      jobCount: jobs?.length ?? null,
    },
  };
}
