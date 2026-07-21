export type FulfillmentRoute = "auto" | "assisted" | "manual" | "blocked";
export type WorkMode = "onsite" | "hybrid" | "remote";

export interface CandidateSearchProfile {
  candidateId: string;
  version: number;
  roleFamilyIds: string[];
  skillIds: string[];
  countryCodes: string[];
  originLatitude?: number;
  originLongitude?: number;
  radiusKm?: number;
  contractTypes: string[];
  workModes: WorkMode[];
  salaryFloor?: number;
  freshnessWindowDays: number;
  excludedFulfillmentRoutes?: FulfillmentRoute[];
}

export interface JobSearchDocument {
  canonicalGroupId: string;
  preferredJobId: string;
  jobVersion: string;
  active: boolean;
  validationStatus: "valid" | "review" | "invalid";
  roleFamilyIds: string[];
  skillIds: string[];
  countryCode: string;
  latitude?: number;
  longitude?: number;
  contractType: string;
  workMode: WorkMode;
  salaryFloor?: number;
  publishedAt: string;
  expiresAt?: string;
  fulfillmentRoute: FulfillmentRoute;
  qualityScore: number;
}

export interface CandidateAction {
  canonicalGroupId: string;
  kind: "seen" | "dismissed" | "applied";
}

export interface MatcherConfig {
  matcherVersion: string;
  coarseLimit: number;
  resultLimit: number;
  weights: {
    role: number;
    skills: number;
    geographyAndWorkMode: number;
    contract: number;
    freshness: number;
    quality: number;
  };
}

export interface MatchResult {
  canonicalGroupId: string;
  preferredJobId: string;
  jobVersion: string;
  matcherVersion: string;
  relevanceScore: number;
  fulfillmentRoute: FulfillmentRoute;
  explanationCodes: string[];
}

export interface MatchSummary {
  coarseCandidateCount: number;
  eligibleCount: number;
  hiddenCount: number;
  results: MatchResult[];
}
