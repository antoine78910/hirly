import type {
  FranceTravailCensusManifest,
  FranceTravailCensusPartition,
} from "./audit";
import { validateFranceTravailCensusManifest } from "./audit";

export class ExternalDependencyBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExternalDependencyBlockedError";
  }
}

export interface FranceTravailLivePartitionResult {
  partitionId: string;
  status: "complete" | "capped" | "blocked";
  sourceReportedTotal: number | null;
  httpRecords: number;
  uniqueExternalIds: string[];
  duplicateRawRecords: number;
  requests: number;
  retries: number;
  terminalReason: string | null;
}

export interface FranceTravailLiveCensusResult {
  schemaVersion: 1;
  manifestDigest: string;
  generatedAt: string;
  partitions: FranceTravailLivePartitionResult[];
}

export type CensusFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function parseContentRange(value: string | null): number | null {
  if (!value) return null;
  const match = value.match(/\/(\d+|\*)\s*$/);
  if (!match || match[1] === "*") return null;
  return Number(match[1]);
}

function extractOffers(payload: unknown): Array<Record<string, unknown>> {
  if (!payload || typeof payload !== "object") return [];
  const value = payload as Record<string, unknown>;
  const candidates = [value.resultats, value.results, value.offers, value.items];
  const rows = candidates.find(Array.isArray);
  return (rows ?? []).filter(
    (row): row is Record<string, unknown> => Boolean(row) && typeof row === "object",
  );
}

function partitionUrl(
  endpoint: string,
  partition: FranceTravailCensusPartition,
  start: number,
  end: number,
): URL {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries(partition.parameters)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("minCreationDate", partition.publishedAfter);
  url.searchParams.set("maxCreationDate", partition.publishedBefore);
  url.searchParams.set("range", `${start}-${end}`);
  return url;
}

async function fetchPartition(
  manifest: FranceTravailCensusManifest,
  partition: FranceTravailCensusPartition,
  input: {
    accessToken: string;
    endpoint: string;
    fetcher: CensusFetch;
    sleep: (milliseconds: number) => Promise<void>;
  },
): Promise<FranceTravailLivePartitionResult> {
  const externalIds = new Set<string>();
  let httpRecords = 0;
  let sourceReportedTotal: number | null = null;
  let requests = 0;
  let retries = 0;
  let start = 0;

  while (start < manifest.capRules.maxRecordsPerPartition) {
    const end = Math.min(
      start + manifest.capRules.pageSize - 1,
      manifest.capRules.maxRecordsPerPartition - 1,
    );
    let response: Response | undefined;
    for (let attempt = 0; attempt <= manifest.capRules.maxRetries; attempt += 1) {
      requests += 1;
      response = await input.fetcher(partitionUrl(input.endpoint, partition, start, end), {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${input.accessToken}`,
        },
      });
      if (response.status !== 429 && response.status < 500) break;
      if (attempt === manifest.capRules.maxRetries) break;
      retries += 1;
      const retryAfter = Number(response.headers.get("retry-after") ?? "0");
      await input.sleep(Number.isFinite(retryAfter) ? Math.max(0, retryAfter * 1000) : 0);
    }
    if (!response) throw new Error("France Travail census request produced no response");
    if (response.status === 204) {
      sourceReportedTotal ??= 0;
      break;
    }
    if (!response.ok) {
      return {
        partitionId: partition.id,
        status: "blocked",
        sourceReportedTotal,
        httpRecords,
        uniqueExternalIds: [...externalIds].sort(),
        duplicateRawRecords: httpRecords - externalIds.size,
        requests,
        retries,
        terminalReason: `http_${response.status}`,
      };
    }

    sourceReportedTotal ??= parseContentRange(response.headers.get("content-range"));
    const offers = extractOffers(await response.json());
    httpRecords += offers.length;
    for (const offer of offers) {
      const externalId = offer.id;
      if (typeof externalId === "string" || typeof externalId === "number") {
        externalIds.add(String(externalId));
      }
    }

    if (
      sourceReportedTotal !== null
      && sourceReportedTotal > manifest.capRules.maxRecordsPerPartition
    ) {
      return {
        partitionId: partition.id,
        status: "capped",
        sourceReportedTotal,
        httpRecords,
        uniqueExternalIds: [...externalIds].sort(),
        duplicateRawRecords: httpRecords - externalIds.size,
        requests,
        retries,
        terminalReason: "source_total_exceeds_partition_cap",
      };
    }
    if (offers.length === 0) {
      const complete = sourceReportedTotal === 0 || externalIds.size === sourceReportedTotal;
      return {
        partitionId: partition.id,
        status: complete ? "complete" : "blocked",
        sourceReportedTotal,
        httpRecords,
        uniqueExternalIds: [...externalIds].sort(),
        duplicateRawRecords: httpRecords - externalIds.size,
        requests,
        retries,
        terminalReason: complete ? null : "empty_intermediate_page",
      };
    }
    if (sourceReportedTotal !== null && externalIds.size >= sourceReportedTotal) break;
    if (response.status !== 206 && offers.length < manifest.capRules.pageSize) break;
    start += manifest.capRules.pageSize;
  }

  const complete =
    sourceReportedTotal !== null && externalIds.size === sourceReportedTotal;
  return {
    partitionId: partition.id,
    status: complete ? "complete" : "blocked",
    sourceReportedTotal,
    httpRecords,
    uniqueExternalIds: [...externalIds].sort(),
    duplicateRawRecords: httpRecords - externalIds.size,
    requests,
    retries,
    terminalReason: complete ? null : "source_total_not_reconciled",
  };
}

export async function runFranceTravailLiveCensus(
  manifest: FranceTravailCensusManifest,
  input: {
    accessToken?: string;
    endpoint?: string;
    fetcher?: CensusFetch;
    sleep?: (milliseconds: number) => Promise<void>;
  } = {},
): Promise<FranceTravailLiveCensusResult> {
  const manifestFailures = validateFranceTravailCensusManifest(manifest);
  if (manifestFailures.length) {
    throw new Error(`invalid France Travail census manifest: ${manifestFailures.join(",")}`);
  }
  if (!input.accessToken?.trim()) {
    throw new ExternalDependencyBlockedError(
      "France Travail access token is unavailable; live census is BLOCKED_EXTERNAL",
    );
  }
  const endpoint =
    input.endpoint
    ?? "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search";
  const fetcher = input.fetcher ?? fetch;
  const sleep = input.sleep ?? ((milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const partitions: FranceTravailLivePartitionResult[] = [];
  for (const partition of manifest.partitions) {
    partitions.push(await fetchPartition(manifest, partition, {
      accessToken: input.accessToken,
      endpoint,
      fetcher,
      sleep,
    }));
  }
  return {
    schemaVersion: 1,
    manifestDigest: manifest.manifestDigest,
    generatedAt: new Date().toISOString(),
    partitions,
  };
}
