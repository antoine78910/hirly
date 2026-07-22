import type {
  CandidateAction,
  CandidateSearchProfile,
  JobSearchDocument,
  MatcherConfig,
  MatchResult,
  MatchSummary,
} from "./types";

export const DEFAULT_MATCHER_CONFIG: MatcherConfig = {
  matcherVersion: "matching-oracle.v1",
  coarseLimit: 1_000,
  resultLimit: 200,
  weights: {
    role: 35,
    skills: 20,
    geographyAndWorkMode: 20,
    contract: 10,
    freshness: 10,
    quality: 5,
  },
};

const intersect = (left: readonly string[], right: readonly string[]): string[] => {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
};

const ageDays = (publishedAt: string, now: Date): number =>
  Math.max(0, (now.getTime() - Date.parse(publishedAt)) / 86_400_000);

const radians = (degrees: number): number => (degrees * Math.PI) / 180;

function distanceKm(
  fromLatitude: number,
  fromLongitude: number,
  toLatitude: number,
  toLongitude: number,
): number {
  const latitudeDelta = radians(toLatitude - fromLatitude);
  const longitudeDelta = radians(toLongitude - fromLongitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(fromLatitude)) *
      Math.cos(radians(toLatitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6_371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isWithinExplicitRadius(profile: CandidateSearchProfile, job: JobSearchDocument): boolean {
  const hasGeoPolicy =
    profile.originLatitude !== undefined ||
    profile.originLongitude !== undefined ||
    profile.radiusKm !== undefined;
  if (!hasGeoPolicy) return true;
  if (
    profile.originLatitude === undefined ||
    profile.originLongitude === undefined ||
    profile.radiusKm === undefined
  ) {
    throw new Error(
      "MATCHING_ORACLE_REFUSED: originLatitude, originLongitude, and radiusKm must be provided together",
    );
  }
  if (job.latitude === undefined || job.longitude === undefined) return false;
  return (
    distanceKm(profile.originLatitude, profile.originLongitude, job.latitude, job.longitude) <=
    profile.radiusKm
  );
}

function requireValidConfig(config: MatcherConfig): void {
  if (
    !Number.isSafeInteger(config.coarseLimit) ||
    config.coarseLimit < 1 ||
    config.coarseLimit > 10_000
  ) {
    throw new Error("MATCHING_ORACLE_REFUSED: coarseLimit must be an integer between 1 and 10000");
  }
  if (
    !Number.isSafeInteger(config.resultLimit) ||
    config.resultLimit < 1 ||
    config.resultLimit > config.coarseLimit
  ) {
    throw new Error("MATCHING_ORACLE_REFUSED: resultLimit must be an integer within coarseLimit");
  }
  const total = Object.values(config.weights).reduce((sum, weight) => sum + weight, 0);
  if (total !== 100) throw new Error("MATCHING_ORACLE_REFUSED: weights must sum to 100");
}

function isEligible(
  profile: CandidateSearchProfile,
  job: JobSearchDocument,
  actions: ReadonlySet<string>,
  now: Date,
): boolean {
  if (!job.active || job.validationStatus === "invalid") return false;
  if (job.expiresAt && Date.parse(job.expiresAt) <= now.getTime()) return false;
  if (ageDays(job.publishedAt, now) > profile.freshnessWindowDays) return false;
  if (actions.has(job.canonicalGroupId)) return false;
  if (intersect(profile.roleFamilyIds, job.roleFamilyIds).length === 0) return false;
  if (profile.countryCodes.length > 0 && !profile.countryCodes.includes(job.countryCode))
    return false;
  if (!isWithinExplicitRadius(profile, job)) return false;
  if (profile.contractTypes.length > 0 && !profile.contractTypes.includes(job.contractType))
    return false;
  if (profile.workModes.length > 0 && !profile.workModes.includes(job.workMode)) return false;
  if (
    profile.salaryFloor !== undefined &&
    job.salaryFloor !== undefined &&
    job.salaryFloor < profile.salaryFloor
  )
    return false;
  if (profile.excludedFulfillmentRoutes?.includes(job.fulfillmentRoute)) return false;
  return true;
}

function score(
  profile: CandidateSearchProfile,
  job: JobSearchDocument,
  now: Date,
  config: MatcherConfig,
): MatchResult {
  const roleOverlap = intersect(profile.roleFamilyIds, job.roleFamilyIds).length;
  const roleRatio = Math.min(1, roleOverlap / Math.max(1, profile.roleFamilyIds.length));
  const skillOverlap = intersect(profile.skillIds, job.skillIds).length;
  const skillRatio =
    profile.skillIds.length === 0 ? 0 : Math.min(1, skillOverlap / profile.skillIds.length);
  const locationAndMode =
    profile.countryCodes.includes(job.countryCode) && profile.workModes.includes(job.workMode)
      ? 1
      : 0;
  const withinRadius = isWithinExplicitRadius(profile, job);
  const contract = profile.contractTypes.includes(job.contractType) ? 1 : 0;
  const freshness = Math.max(
    0,
    1 - ageDays(job.publishedAt, now) / Math.max(1, profile.freshnessWindowDays),
  );
  const quality = Math.max(0, Math.min(1, job.qualityScore / 100));
  const relevanceScore = Number(
    (
      roleRatio * config.weights.role +
      skillRatio * config.weights.skills +
      locationAndMode * config.weights.geographyAndWorkMode +
      contract * config.weights.contract +
      freshness * config.weights.freshness +
      quality * config.weights.quality
    ).toFixed(6),
  );
  const explanationCodes = [
    ...(roleOverlap > 0 ? ["role_family_overlap"] : []),
    ...(skillOverlap > 0 ? ["skill_overlap"] : []),
    ...(locationAndMode ? ["location_work_mode_match"] : []),
    ...(profile.radiusKm !== undefined && withinRadius ? ["within_explicit_radius"] : []),
    ...(contract ? ["contract_match"] : []),
    ...(freshness >= 0.5 ? ["fresh_listing"] : []),
  ];
  return {
    canonicalGroupId: job.canonicalGroupId,
    preferredJobId: job.preferredJobId,
    jobVersion: job.jobVersion,
    matcherVersion: config.matcherVersion,
    relevanceScore,
    fulfillmentRoute: job.fulfillmentRoute,
    explanationCodes,
  };
}

export class MatchingOracle {
  private readonly documents = new Map<string, JobSearchDocument>();
  private readonly roleIndex = new Map<string, Set<string>>();

  constructor(documents: readonly JobSearchDocument[]) {
    for (const document of [...documents].sort((a, b) =>
      a.canonicalGroupId.localeCompare(b.canonicalGroupId),
    )) {
      if (this.documents.has(document.canonicalGroupId)) {
        throw new Error(
          `MATCHING_ORACLE_REFUSED: duplicate canonical group ${document.canonicalGroupId}`,
        );
      }
      if (!Number.isFinite(Date.parse(document.publishedAt))) {
        throw new Error(
          `MATCHING_ORACLE_REFUSED: invalid publishedAt for ${document.canonicalGroupId}`,
        );
      }
      if (
        !Number.isFinite(document.qualityScore) ||
        document.qualityScore < 0 ||
        document.qualityScore > 100
      ) {
        throw new Error(
          `MATCHING_ORACLE_REFUSED: invalid qualityScore for ${document.canonicalGroupId}`,
        );
      }
      this.documents.set(document.canonicalGroupId, document);
      for (const roleFamilyId of document.roleFamilyIds) {
        const groups = this.roleIndex.get(roleFamilyId) ?? new Set<string>();
        groups.add(document.canonicalGroupId);
        this.roleIndex.set(roleFamilyId, groups);
      }
    }
  }

  match(
    profile: CandidateSearchProfile,
    actions: readonly CandidateAction[] = [],
    options: { now?: Date; config?: MatcherConfig } = {},
  ): MatchSummary {
    const now = options.now ?? new Date();
    const config = options.config ?? DEFAULT_MATCHER_CONFIG;
    requireValidConfig(config);
    const actionGroups = new Set(actions.map((action) => action.canonicalGroupId));
    const coarseIds = new Set<string>();
    for (const roleFamilyId of [...profile.roleFamilyIds].sort()) {
      for (const groupId of this.roleIndex.get(roleFamilyId) ?? []) coarseIds.add(groupId);
    }
    const roleCandidates = [...coarseIds].map((groupId) => this.documents.get(groupId)!);
    const eligible = roleCandidates
      .filter((job) => isEligible(profile, job, actionGroups, now))
      .sort(
        (a, b) =>
          Date.parse(b.publishedAt) - Date.parse(a.publishedAt) ||
          a.canonicalGroupId.localeCompare(b.canonicalGroupId),
      )
      .slice(0, config.coarseLimit);
    const results = eligible
      .map((job) => ({ job, match: score(profile, job, now, config) }))
      .sort(
        (a, b) =>
          b.match.relevanceScore - a.match.relevanceScore ||
          Date.parse(b.job.publishedAt) - Date.parse(a.job.publishedAt) ||
          a.job.canonicalGroupId.localeCompare(b.job.canonicalGroupId),
      )
      .slice(0, config.resultLimit)
      .map(({ match }) => match);
    return {
      coarseCandidateCount: eligible.length,
      eligibleCount: eligible.length,
      hiddenCount: roleCandidates.length - eligible.length,
      results,
    };
  }
}
