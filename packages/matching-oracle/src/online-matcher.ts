import {
  MATCHING_CONTRACT_VERSION,
  candidateActionProjectionSchema,
  candidateSearchProfileSchema,
  jobSearchDocumentSchema,
  onlineMatchRequestSchema,
  onlineMatchResponseSchema,
  type CandidateActionProjection,
  type CandidateSearchProfile,
  type JobSearchDocument,
  type OnlineMatchRequest,
  type OnlineMatchResponse,
} from "@hirly/contracts";

export interface CandidateGroupAlias {
  aliasGroupId: string;
  canonicalGroupId: string;
}

export interface OnlineMatcherSnapshot {
  servingEnabled: boolean;
  profile: CandidateSearchProfile | null;
  profileTombstoned?: boolean;
  actionWatermark: string;
  actions: readonly CandidateActionProjection[];
  aliases?: readonly CandidateGroupAlias[];
  jobs: readonly JobSearchDocument[];
  reconciliationRequired?: boolean;
}

const decimal = (value: string): bigint => BigInt(value);
const overlap = (left: readonly string[], right: readonly string[]): number => {
  const values = new Set(right);
  return left.filter((value) => values.has(value)).length;
};
const ageDays = (value: string, now: Date): number =>
  Math.max(0, (now.getTime() - Date.parse(value)) / 86_400_000);
const radians = (degrees: number): number => degrees * Math.PI / 180;
const distanceKm = (aLat: number, aLon: number, bLat: number, bLon: number): number => {
  const latitudeDelta = radians(bLat - aLat);
  const longitudeDelta = radians(bLon - aLon);
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(aLat)) * Math.cos(radians(bLat)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};

function aliasClosure(actions: readonly CandidateActionProjection[], aliases: readonly CandidateGroupAlias[]): Set<string> {
  const excluded = new Set<string>();
  for (const action of actions) {
    if (action.retentionState !== "active" || action.kind === "undo") continue;
    excluded.add(action.canonicalGroupId);
    for (const alias of action.canonicalGroupAliases) excluded.add(alias);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const alias of aliases) {
      if (excluded.has(alias.aliasGroupId) && !excluded.has(alias.canonicalGroupId)) {
        excluded.add(alias.canonicalGroupId);
        changed = true;
      }
    }
  }
  return excluded;
}

function locationMatches(profile: CandidateSearchProfile, job: JobSearchDocument): boolean {
  if (profile.status === "deleted") return false;
  if (profile.locationPolicy === "worldwide") return true;
  if (profile.locationPolicy === "country") {
    return job.countryCode !== null && profile.countryCodes.includes(job.countryCode);
  }
  if (profile.originLatitude === null || profile.originLongitude === null || profile.radiusKm === null) return false;
  if (job.latitude === null || job.longitude === null || job.locationUnknown) return false;
  return distanceKm(profile.originLatitude, profile.originLongitude, job.latitude, job.longitude) <= profile.radiusKm;
}

function lifecycleEligible(job: JobSearchDocument, now: Date): boolean {
  return job.lifecycleStatus === "active"
    && job.validationStatus === "valid"
    && (job.expiresAt === null || Date.parse(job.expiresAt) > now.getTime());
}

function policyEligible(job: JobSearchDocument): boolean {
  return job.sourceEligible
    && job.policyEligible
    && job.applyabilityTier !== "blocked"
    && job.fulfillmentRoute !== "blocked";
}

function candidateMatches(profile: CandidateSearchProfile, job: JobSearchDocument): boolean {
  if (profile.status !== "active") return false;
  if (profile.roleFamilyIds.length > 0 && overlap(profile.roleFamilyIds, job.roleFamilyIds) === 0) return false;
  if (profile.romeCodes.length > 0 && overlap(profile.romeCodes, job.romeCodes) === 0) return false;
  if (profile.contractTypes.length > 0 && overlap(profile.contractTypes, job.contractTypes) === 0) return false;
  if (profile.workModes.length > 0 && overlap(profile.workModes, job.workModes) === 0) return false;
  if (!locationMatches(profile, job)) return false;
  if (profile.seniorityMin !== null && job.seniorityMax !== null && job.seniorityMax < profile.seniorityMin) return false;
  if (profile.seniorityMax !== null && job.seniorityMin !== null && job.seniorityMin > profile.seniorityMax) return false;
  return true;
}

function score(profile: CandidateSearchProfile, job: JobSearchDocument, now: Date) {
  if (profile.status === "deleted") throw new Error("ONLINE_MATCH_REFUSED: deleted profile");
  const role = overlap(profile.roleFamilyIds, job.roleFamilyIds) > 0;
  const skills = overlap(profile.skillIds, job.skillIds);
  const location = locationMatches(profile, job);
  const contract = profile.contractTypes.length === 0 || overlap(profile.contractTypes, job.contractTypes) > 0;
  const freshness = Math.max(0, 1 - ageDays(job.publishedAt, now) / profile.freshnessWindowDays);
  const relevanceScore = Number(Math.min(1,
    (role ? 0.4 : 0)
    + Math.min(0.25, skills / Math.max(1, profile.skillIds.length) * 0.25)
    + (location ? 0.15 : 0)
    + (contract ? 0.1 : 0)
    + freshness * 0.1,
  ).toFixed(6));
  const explanationCodes = [
    ...(role ? ["role_match" as const] : []),
    ...(skills > 0 ? ["skill_match" as const] : []),
    ...(job.workModes.includes("remote") && profile.workModes.includes("remote")
      ? ["remote_match" as const]
      : location ? ["location_match" as const] : []),
    ...(contract ? ["contract_match" as const] : []),
    ...(freshness >= 0.5 ? ["fresh_inventory" as const] : []),
    ...(job.validationStatus === "valid" ? ["quality_inventory" as const] : []),
    ...(`${job.fulfillmentRoute}_route` === "auto_route" ? ["auto_route" as const]
      : `${job.fulfillmentRoute}_route` === "assisted_route" ? ["assisted_route" as const]
      : ["manual_route" as const]),
  ];
  return { relevanceScore, explanationCodes };
}

function emptyResponse(request: OnlineMatchRequest, emptyReason: OnlineMatchResponse["emptyReason"], counts = { coarse: 0, eligible: 0, hidden: 0 }): OnlineMatchResponse {
  return onlineMatchResponseSchema.parse({
    schemaVersion: MATCHING_CONTRACT_VERSION,
    candidateId: request.candidateId,
    profileVersion: request.profileVersion,
    actionWatermark: request.actionWatermark,
    matcherVersion: request.matcherVersion,
    coarseCandidateCount: counts.coarse,
    eligibleCount: counts.eligible,
    hiddenCount: counts.hidden,
    emptyReason,
    results: [],
  });
}

export function matchOnline(requestInput: OnlineMatchRequest, snapshot: OnlineMatcherSnapshot): OnlineMatchResponse {
  const request = onlineMatchRequestSchema.parse(requestInput);
  if (!snapshot.servingEnabled) throw new Error("ONLINE_MATCH_DISABLED");
  if (snapshot.profileTombstoned) return emptyResponse(request, "DELETION_PENDING");
  if (snapshot.profile === null) return emptyResponse(request, "PROJECTION_LAG");
  const profile = candidateSearchProfileSchema.parse(snapshot.profile);
  if (profile.candidateId !== request.candidateId) throw new Error("ONLINE_MATCH_REFUSED: candidate scope mismatch");
  if (profile.status !== "active") return emptyResponse(request, "PROFILE_INACTIVE");
  if (profile.version !== request.profileVersion
    || snapshot.actionWatermark !== request.actionWatermark
    || snapshot.reconciliationRequired) return emptyResponse(request, "PROJECTION_LAG");

  const now = new Date(request.requestedAt);
  const actions = snapshot.actions.map((action) => candidateActionProjectionSchema.parse(action));
  if (actions.some((action) => action.candidateId !== request.candidateId || decimal(action.version) > decimal(request.actionWatermark))) {
    return emptyResponse(request, "PROJECTION_LAG");
  }
  const excluded = aliasClosure(actions, snapshot.aliases ?? []);
  const latestJobs = new Map<string, JobSearchDocument>();
  for (const input of snapshot.jobs) {
    const job = jobSearchDocumentSchema.parse(input);
    const current = latestJobs.get(job.canonicalGroupId);
    if (!current || decimal(job.jobVersion) > decimal(current.jobVersion)) latestJobs.set(job.canonicalGroupId, job);
  }
  const inventory = [...latestJobs.values()];
  const freshInventory = inventory.filter((job) => ageDays(job.publishedAt, now) <= profile.freshnessWindowDays);
  if (freshInventory.length === 0) return emptyResponse(request, "NO_FRESH_INVENTORY", { coarse: 0, eligible: 0, hidden: inventory.length });
  const policyVisible = freshInventory.filter(policyEligible);
  if (policyVisible.length === 0) return emptyResponse(request, "ALL_POLICY_HIDDEN", { coarse: 0, eligible: 0, hidden: inventory.length });
  const eligible = policyVisible.filter((job) => lifecycleEligible(job, now));
  if (eligible.length === 0) return emptyResponse(request, "NO_ELIGIBLE_INVENTORY", { coarse: 0, eligible: 0, hidden: inventory.length });
  const matching = eligible.filter((job) => candidateMatches(profile, job));
  if (matching.length === 0) return emptyResponse(request, "NO_MATCHING_INVENTORY", { coarse: 0, eligible: 0, hidden: inventory.length });
  const visible = matching.filter((job) => !excluded.has(job.canonicalGroupId));
  if (visible.length === 0) return emptyResponse(request, "ALL_ACTIONED", { coarse: matching.length, eligible: 0, hidden: inventory.length });

  const coarse = visible
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.canonicalGroupId.localeCompare(b.canonicalGroupId))
    .slice(0, request.coarseLimit);
  const results = coarse.map((job) => ({ job, ...score(profile, job, now) }))
    .sort((a, b) => b.relevanceScore - a.relevanceScore
      || Date.parse(b.job.publishedAt) - Date.parse(a.job.publishedAt)
      || a.job.canonicalGroupId.localeCompare(b.job.canonicalGroupId))
    .slice(0, request.resultLimit)
    .map(({ job, relevanceScore, explanationCodes }) => ({
      canonicalGroupId: job.canonicalGroupId,
      preferredJobId: job.preferredJobId,
      jobVersion: job.jobVersion,
      relevanceScore,
      fulfillmentRoute: job.fulfillmentRoute,
      explanationCodes,
    }));
  return onlineMatchResponseSchema.parse({
    schemaVersion: MATCHING_CONTRACT_VERSION,
    candidateId: request.candidateId,
    profileVersion: request.profileVersion,
    actionWatermark: request.actionWatermark,
    matcherVersion: request.matcherVersion,
    coarseCandidateCount: coarse.length,
    eligibleCount: visible.length,
    hiddenCount: inventory.length - visible.length,
    emptyReason: null,
    results,
  });
}
