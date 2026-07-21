import {
  MATCHING_CONTRACT_VERSION,
  candidateActionProjectionSchema,
  candidateSearchProfileSchema,
  type CandidateActionProjection,
  type CandidateProjectionOutboxEvent,
  type CandidateSearchProfile,
} from "@hirly/contracts";
import type { CandidateSourceSnapshot } from "./types";

const FEATURE_SCHEMA_VERSION = "matching-features.v1";
const EXPOSURE_POLICY_VERSION = "1";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sourceRecord(value: Record<string, unknown> | null): Record<string, unknown> {
  if (!value) return {};
  return { ...record(value.data), ...value };
}

function first(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function text(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizedToken(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const normalized = raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized.slice(0, 120) : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

function normalizedTokens(value: unknown, maximum: number): string[] {
  return [...new Set(array(value).map(normalizedToken).filter((item): item is string => Boolean(item)))].slice(0, maximum);
}

function strings(value: unknown, maximum: number): string[] {
  return [...new Set(array(value).map(text).filter((item): item is string => Boolean(item)))].slice(0, maximum);
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value: unknown, minimum: number, maximum: number): number | null {
  const parsed = numberValue(value);
  return parsed !== null && Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null;
}

function timestamp(value: unknown, fallback: string): string {
  const candidate = text(value);
  if (!candidate || Number.isNaN(Date.parse(candidate))) return fallback;
  return new Date(candidate).toISOString();
}

function countryCodes(value: unknown): string[] {
  return [...new Set(strings(value, 250).map((item) => item.toUpperCase()).filter((item) => /^[A-Z]{2}$/.test(item)))];
}

function romeCodes(value: unknown): string[] {
  return [...new Set(strings(value, 32).map((item) => item.toUpperCase()).filter((item) => /^[A-Z]\d{4}$/.test(item)))];
}

function workModes(value: unknown): Array<"onsite" | "hybrid" | "remote"> {
  const modes = normalizedTokens(value, 3);
  if (modes.includes("any")) return ["onsite", "hybrid", "remote"];
  return modes.filter((mode): mode is "onsite" | "hybrid" | "remote" =>
    mode === "onsite" || mode === "hybrid" || mode === "remote",
  );
}

function consentPaused(user: Record<string, unknown>): boolean {
  const consent = first(
    user.matching_consent,
    user.candidate_matching_consent,
    user.candidate_matching_enabled,
    record(user.consents).matching,
  );
  const status = normalizedToken(first(user.status, user.account_status));
  return consent === false || status === "paused" || status === "disabled";
}

function minimalPausedProfile(input: {
  candidateId: string;
  version: string;
  sourceUpdatedAt: string;
  projectedAt: string;
}): CandidateSearchProfile {
  return candidateSearchProfileSchema.parse({
    schemaVersion: MATCHING_CONTRACT_VERSION,
    candidateId: input.candidateId,
    version: input.version,
    status: "paused",
    targetRoleLabelNormalized: null,
    roleFamilyIds: [],
    romeCodes: [],
    skillIds: [],
    skillTerms: [],
    seniorityMin: null,
    seniorityMax: null,
    contractTypes: [],
    workModes: [],
    originLatitude: null,
    originLongitude: null,
    radiusKm: null,
    countryCodes: [],
    locationPolicy: "worldwide",
    salaryFloor: null,
    currency: null,
    freshnessWindowDays: 30,
    exposurePolicyVersion: EXPOSURE_POLICY_VERSION,
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    sourceProfileUpdatedAt: input.sourceUpdatedAt,
    projectedAt: input.projectedAt,
  });
}

export function normalizeCandidateProfile(input: {
  event: CandidateProjectionOutboxEvent;
  snapshot: CandidateSourceSnapshot;
  projectedAt?: string;
}): CandidateSearchProfile {
  const projectedAt = input.projectedAt ?? new Date().toISOString();
  const profile = sourceRecord(input.snapshot.profile);
  const user = sourceRecord(input.snapshot.user);
  const onboarding = record(record(profile.extras).onboarding);
  const contact = record(profile.contact);
  const location = {
    ...record(onboarding.onboarding_location_data),
    ...record(contact.location_data),
    ...record(profile.target_location_data),
  };
  const sourceUpdatedAt = timestamp(
    first(profile.updated_at, user.updated_at, input.event.occurredAt),
    input.event.occurredAt,
  );
  if (consentPaused(user)) {
    return minimalPausedProfile({
      candidateId: input.event.candidateId,
      version: input.event.entityVersion,
      sourceUpdatedAt,
      projectedAt,
    });
  }

  const targetRoles = array(first(profile.target_roles, onboarding.selected_roles));
  const targetRole = first(profile.target_role, targetRoles[0]);
  const latitude = numberValue(first(location.latitude, location.lat));
  const longitude = numberValue(first(location.longitude, location.lng, location.lon));
  const countries = countryCodes(first(profile.country_codes, location.country_code, location.countryCode));
  const explicitCoordinates = latitude !== null && longitude !== null;
  const radius = numberValue(first(profile.radius_km, profile.search_radius_km, location.radius_km));
  const contractTypes = normalizedTokens(
    first(profile.contract_types, profile.contract_type, onboarding.contract_type),
    16,
  );
  const modes = workModes(first(profile.work_modes, profile.remote_preference, onboarding.remote_preference));
  const salaryFloor = numberValue(first(profile.salary_floor, profile.salary_min, onboarding.salary_min));
  const currency = text(first(profile.currency, onboarding.currency))?.toUpperCase() ?? null;

  return candidateSearchProfileSchema.parse({
    schemaVersion: MATCHING_CONTRACT_VERSION,
    candidateId: input.event.candidateId,
    version: input.event.entityVersion,
    status: "active",
    targetRoleLabelNormalized: normalizedToken(targetRole),
    roleFamilyIds: normalizedTokens(first(profile.role_family_ids, profile.role_family_codes), 32),
    romeCodes: romeCodes(first(profile.rome_codes, profile.rome_code, record(profile.rome_profile).rome_code)),
    skillIds: normalizedTokens(profile.skill_ids, 128),
    skillTerms: normalizedTokens(profile.skills, 128),
    seniorityMin: integer(profile.seniority_min, 0, 20),
    seniorityMax: integer(profile.seniority_max, 0, 20),
    contractTypes,
    workModes: modes,
    originLatitude: explicitCoordinates ? latitude : null,
    originLongitude: explicitCoordinates ? longitude : null,
    radiusKm: explicitCoordinates && radius !== null && radius > 0 ? Math.min(radius, 20_000) : null,
    countryCodes: countries,
    locationPolicy: explicitCoordinates ? "explicit" : countries.length > 0 ? "country" : "worldwide",
    salaryFloor: salaryFloor !== null && salaryFloor >= 0 ? salaryFloor : null,
    currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null,
    freshnessWindowDays: integer(first(profile.freshness_window_days, 30), 1, 365) ?? 30,
    exposurePolicyVersion: text(profile.exposure_policy_version) ?? EXPOSURE_POLICY_VERSION,
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    sourceProfileUpdatedAt: sourceUpdatedAt,
    projectedAt,
  });
}

export function normalizeCandidateAction(input: {
  event: CandidateProjectionOutboxEvent;
  source: Record<string, unknown>;
  canonicalGroupId: string;
  canonicalGroupAliases?: string[];
  projectedAt?: string;
}): CandidateActionProjection {
  const source = sourceRecord(input.source);
  const direction = normalizedToken(source.direction);
  const eventKind = input.event.eventFamily === "applications"
    ? "applied"
    : direction === "left"
      ? "dismissed"
      : direction === "right"
        ? "applied"
        : normalizedToken(first(source.kind, source.action_kind)) ?? "seen";
  const kind = eventKind === "dismissed" || eventKind === "applied" || eventKind === "undo"
    ? eventKind
    : "seen";
  const jobId = text(first(source.job_id, source.source_job_id));
  if (!jobId) throw new Error("candidate_action_missing_job_id");
  return candidateActionProjectionSchema.parse({
    schemaVersion: MATCHING_CONTRACT_VERSION,
    candidateId: input.event.candidateId,
    sourceActionId: input.event.entityId,
    sourceJobId: jobId,
    canonicalGroupId: input.canonicalGroupId,
    canonicalGroupAliases: input.canonicalGroupAliases ?? [],
    kind,
    version: input.event.entityVersion,
    occurredAt: timestamp(first(source.updated_at, source.created_at), input.event.occurredAt),
    retentionState: "active",
    projectedAt: input.projectedAt ?? new Date().toISOString(),
  });
}
