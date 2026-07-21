import { buildSproutFranceQuery } from "./query";
import type { ParsedSproutResponse } from "./schema";

const VISIBLE_TYPES = ["FULL_TIME", "PART_TIME", "INTERNSHIP"] as const;
const VISIBLE_EXPERIENCE = ["ENTRY", "MID", "SENIOR", "EXECUTIVE"] as const;
const VISIBLE_WORK_LOCATIONS = ["IN_PERSON", "HYBRID", "REMOTE"] as const;

export interface SproutQualificationRequester {
  request(query: URLSearchParams, signal: AbortSignal): Promise<{
    parsed: ParsedSproutResponse;
    responseBytes: number;
  }>;
}

export interface SproutQualificationObservation {
  scenario: string;
  count: number;
  sampleIds: string[];
  responseBytes: number;
  wrapperMismatch: boolean;
}

function addArray(query: URLSearchParams, key: string, values: readonly string[]): void {
  for (const value of values) query.append(`${key}[]`, value);
}

export function sproutQualificationMatrixQueries(): ReadonlyArray<{
  scenario: string;
  query: URLSearchParams;
}> {
  const scenario = (
    name: string,
    options: Parameters<typeof buildSproutFranceQuery>[0],
    extend?: (query: URLSearchParams) => void,
  ) => {
    const query = buildSproutFranceQuery({ ...options, offset: 0, limit: 1 });
    extend?.(query);
    return { scenario: name, query };
  };
  return [
    scenario("qualified-baseline", {}),
    scenario("country-without-radius", {}),
    scenario("include-unknown-work-location", { includeUnknownWorkLocation: true }),
    scenario("all-visible-job-types", {}, (query) => addArray(query, "types", VISIBLE_TYPES)),
    scenario("all-visible-experience-levels", {}, (query) =>
      addArray(query, "experienceLevels", VISIBLE_EXPERIENCE),
    ),
    scenario("all-visible-work-locations", {}, (query) =>
      addArray(query, "workLocations", VISIBLE_WORK_LOCATIONS),
    ),
  ];
}

export async function runSproutQualificationMatrix(input: {
  requester: SproutQualificationRequester;
  signal: AbortSignal;
  delayMs: number;
  sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}): Promise<SproutQualificationObservation[]> {
  if (!Number.isSafeInteger(input.delayMs) || input.delayMs < 2_000) {
    throw new Error("sprout_qualification_delay_too_short");
  }
  const queries = sproutQualificationMatrixQueries();
  if (queries.length > 6) throw new Error("sprout_qualification_request_budget_exceeded");
  const observations: SproutQualificationObservation[] = [];
  for (const [index, candidate] of queries.entries()) {
    input.signal.throwIfAborted();
    const response = await input.requester.request(candidate.query, input.signal);
    observations.push({
      scenario: candidate.scenario,
      count: response.parsed.count,
      sampleIds: response.parsed.jobs.slice(0, 1).map((job) => job.id),
      responseBytes: response.responseBytes,
      wrapperMismatch: response.parsed.wrapperMismatch,
    });
    if (index + 1 < queries.length) await input.sleep(input.delayMs, input.signal);
  }
  return observations;
}

export async function runSproutPageSizeQualification(input: {
  pageSizes: readonly number[];
  requester: SproutQualificationRequester;
  signal: AbortSignal;
  delayMs: number;
  maxResponseBytes: number;
  sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}): Promise<SproutQualificationObservation[]> {
  if (input.pageSizes.length < 1 || input.pageSizes.length > 3) {
    throw new Error("sprout_page_size_trial_request_budget_exceeded");
  }
  if (!Number.isSafeInteger(input.delayMs) || input.delayMs < 2_000) {
    throw new Error("sprout_qualification_delay_too_short");
  }
  const observations: SproutQualificationObservation[] = [];
  for (const [index, pageSize] of input.pageSizes.entries()) {
    const query = buildSproutFranceQuery({ offset: 0, limit: pageSize });
    const response = await input.requester.request(query, input.signal);
    if (response.responseBytes > input.maxResponseBytes) {
      throw new Error("sprout_page_size_response_budget_exceeded");
    }
    observations.push({
      scenario: `page-size-${pageSize}`,
      count: response.parsed.count,
      sampleIds: response.parsed.jobs.map((job) => job.id),
      responseBytes: response.responseBytes,
      wrapperMismatch: response.parsed.wrapperMismatch,
    });
    if (index + 1 < input.pageSizes.length) await input.sleep(input.delayMs, input.signal);
  }
  return observations;
}
