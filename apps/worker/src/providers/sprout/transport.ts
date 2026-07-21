import { IngestionError } from "@hirly/ingestion";
import { buildSproutFranceQuery } from "./query";
import { parseSproutResponse, type SproutRawJob } from "./schema";
import type { SproutRuntimePage, SproutRuntimeTransport } from "./runtime";

export interface SproutSecretResolver {
  resolve(reference: string, signal: AbortSignal): Promise<string>;
}

export interface SproutHttpTransportOptions {
  endpoint: string;
  allowedOrigins: readonly string[];
  secrets: SproutSecretResolver;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  maxResponseBytes: number;
  maxAttempts?: number;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
}

function approvedEndpoint(endpoint: string, allowedOrigins: readonly string[]): URL {
  const url = new URL(endpoint);
  const origins = new Set(
    allowedOrigins.map((candidate) => {
      const allowed = new URL(candidate);
      if (allowed.protocol !== "https:" || allowed.username || allowed.password) {
        throw new Error("sprout_transport_invalid_allowlist");
      }
      return allowed.origin;
    }),
  );
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    !origins.has(url.origin)
  ) {
    throw new Error("sprout_transport_origin_not_allowed");
  }
  return url;
}

function defaultSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

function retryDelay(response: Response | null, attempt: number, random: () => number): number {
  const retryAfter = response?.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 60_000);
    const at = Date.parse(retryAfter);
    if (!Number.isNaN(at)) return Math.min(Math.max(0, at - Date.now()), 60_000);
  }
  return Math.min(1_000 * 2 ** attempt + Math.floor(random() * 250), 30_000);
}

async function boundedBody(response: Response, maximum: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximum) {
    throw new IngestionError("provider_permanent", "sprout_response_body_too_large");
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new IngestionError("provider_permanent", "sprout_response_body_too_large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export class SproutHttpTransport implements SproutRuntimeTransport<SproutRawJob> {
  private readonly endpoint: URL;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  private readonly random: () => number;

  constructor(private readonly options: SproutHttpTransportOptions) {
    this.endpoint = approvedEndpoint(options.endpoint, options.allowedOrigins);
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
    if (!Number.isSafeInteger(options.maxResponseBytes) || options.maxResponseBytes < 1) {
      throw new Error("sprout_transport_invalid_body_budget");
    }
    if (!Number.isInteger(this.maxAttempts) || this.maxAttempts < 1 || this.maxAttempts > 4) {
      throw new Error("sprout_transport_invalid_attempt_budget");
    }
  }

  async fetchPage(
    input: {
      countryCode: "FR";
      offset: number;
      pageSize: number;
      credentialRef: string;
      includeUnknownWorkLocation?: boolean;
      includeQualifiedRadius?: boolean;
    },
    signal: AbortSignal,
  ): Promise<SproutRuntimePage<SproutRawJob>> {
    signal.throwIfAborted();
    const token = (await this.options.secrets.resolve(input.credentialRef, signal)).trim();
    if (!token || token.length > 16_384) {
      throw new IngestionError("authorization_blocked", "sprout_credential_unavailable");
    }
    const url = new URL(this.endpoint);
    url.search = buildSproutFranceQuery({
      offset: input.offset,
      limit: input.pageSize,
      includeUnknownWorkLocation: input.includeUnknownWorkLocation,
      includeQualifiedRadius: input.includeQualifiedRadius,
    }).toString();

    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      signal.throwIfAborted();
      const timeout = AbortSignal.timeout(this.timeoutMs);
      const requestSignal = AbortSignal.any([signal, timeout]);
      let response: Response | null = null;
      try {
        response = await this.fetchImpl(url, {
          method: "GET",
          headers: { accept: "application/json", authorization: `Bearer ${token}` },
          redirect: "manual",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          signal: requestSignal,
        });
      } catch {
        if (attempt + 1 >= this.maxAttempts) {
          throw new IngestionError("provider_permanent", "sprout_transport_failed");
        }
        await this.sleep(retryDelay(null, attempt, this.random), signal);
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        throw new IngestionError("authorization_blocked", "sprout_authorization_rejected");
      }
      if (response.status >= 300 && response.status < 400) {
        throw new IngestionError("provider_permanent", "sprout_redirect_rejected");
      }
      if (response.status === 429 || response.status >= 500) {
        if (attempt + 1 >= this.maxAttempts) {
          throw new IngestionError(
            "provider_permanent",
            response.status === 429 ? "sprout_rate_limit_exhausted" : "sprout_upstream_unavailable",
          );
        }
        await this.sleep(retryDelay(response, attempt, this.random), signal);
        continue;
      }
      if (!response.ok) {
        throw new IngestionError("provider_permanent", `sprout_http_${response.status}`);
      }
      const body = await boundedBody(response, this.options.maxResponseBytes);
      let decoded: unknown;
      try {
        decoded = JSON.parse(new TextDecoder().decode(body));
      } catch {
        throw new IngestionError("provider_permanent", "sprout_malformed_json");
      }
      let parsed;
      try {
        parsed = parseSproutResponse(decoded);
      } catch {
        throw new IngestionError("provider_permanent", "sprout_schema_drift");
      }
      return {
        items: parsed.jobs,
        next: parsed.next,
        sourceReportedTotal: parsed.count,
        responseBytes: body.byteLength,
        watermark: null,
        wrapperMismatch: parsed.wrapperMismatch,
      };
    }
    throw new IngestionError("provider_permanent", "sprout_transport_failed");
  }
}
