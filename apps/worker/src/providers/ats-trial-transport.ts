import { z } from "zod";

export type AtsTrialErrorClassification =
  | "not_found"
  | "rate_limited"
  | "retryable"
  | "permanent"
  | "malformed"
  | "budget_exceeded"
  | "cancelled";

export class AtsTrialTransportError extends Error {
  constructor(
    readonly classification: AtsTrialErrorClassification,
    message: string,
    readonly status: number | null = null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AtsTrialTransportError";
  }
}

export interface AtsTrialTransportBudgets {
  readonly maxRequests: 1;
  readonly maxPages: 1;
  readonly maxBytes: number;
  readonly timeoutMs: number;
}

export interface AtsTrialFetch {
  (input: string, init: RequestInit): Promise<Response>;
}

export interface AtsTrialTransportOptions {
  readonly approvedTenantId: string;
  readonly fetch?: AtsTrialFetch;
  readonly budgets?: Partial<AtsTrialTransportBudgets>;
}

export const DEFAULT_ATS_TRIAL_BUDGETS: AtsTrialTransportBudgets = {
  maxRequests: 1,
  maxPages: 1,
  maxBytes: 2_000_000,
  timeoutMs: 10_000,
};

const tenantIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
    "approved ATS tenant identifier contains forbidden characters",
  );

const budgetSchema = z
  .object({
    maxRequests: z.literal(1),
    maxPages: z.literal(1),
    maxBytes: z.number().int().positive().max(10_000_000),
    timeoutMs: z.number().int().positive().max(60_000),
  })
  .strict();

export interface BoundAtsTrialTransport {
  readonly trialOnly: true;
  readonly manualInvocationOnly: true;
  readonly liveTransportReady: false;
  readonly canonicalWriteReady: false;
  readonly credentialsAccepted: false;
  readonly approvedTenantId: string;
  readonly budgets: AtsTrialTransportBudgets;
}

export function parseAtsTrialOptions(input: AtsTrialTransportOptions): {
  approvedTenantId: string;
  fetch: AtsTrialFetch;
  budgets: AtsTrialTransportBudgets;
} {
  return {
    approvedTenantId: tenantIdSchema.parse(input.approvedTenantId),
    fetch: input.fetch ?? globalThis.fetch,
    budgets: budgetSchema.parse({
      ...DEFAULT_ATS_TRIAL_BUDGETS,
      ...input.budgets,
    }),
  };
}

export async function fetchBoundedAtsJson<Output>(input: {
  url: URL;
  allowedHost: string;
  fetch: AtsTrialFetch;
  budgets: AtsTrialTransportBudgets;
  schema: z.ZodType<Output>;
  signal: AbortSignal;
}): Promise<Output> {
  assertOfficialTrialUrl(input.url, input.allowedHost);
  if (input.signal.aborted) {
    throw new AtsTrialTransportError("cancelled", "ATS trial request cancelled");
  }

  const timeoutController = new AbortController();
  const requestController = new AbortController();
  const cancelFromCaller = () => requestController.abort(input.signal.reason);
  const cancelFromTimeout = () =>
    requestController.abort(new Error("ATS trial time budget exceeded"));
  input.signal.addEventListener("abort", cancelFromCaller, { once: true });
  timeoutController.signal.addEventListener("abort", cancelFromTimeout, {
    once: true,
  });
  const timeout = setTimeout(() => timeoutController.abort(), input.budgets.timeoutMs);

  try {
    let response: Response;
    try {
      response = await awaitWithAbort(
        input.fetch(input.url.href, {
          method: "GET",
          headers: { accept: "application/json" },
          redirect: "error",
          credentials: "omit",
          cache: "no-store",
          referrerPolicy: "no-referrer",
          signal: requestController.signal,
        }),
        requestController.signal,
      );
    } catch (error) {
      if (timeoutController.signal.aborted) {
        throw new AtsTrialTransportError(
          "budget_exceeded",
          "ATS trial request exceeded its time budget",
          null,
          { cause: error },
        );
      }
      if (input.signal.aborted) {
        throw new AtsTrialTransportError("cancelled", "ATS trial request cancelled", null, {
          cause: error,
        });
      }
      throw new AtsTrialTransportError("retryable", "ATS trial network request failed", null, {
        cause: error,
      });
    }

    if (!response.ok) throw classifyHttpResponse(response.status);
    const declaredLength = response.headers.get("content-length");
    if (
      declaredLength !== null &&
      (!/^\d+$/.test(declaredLength) || Number(declaredLength) > input.budgets.maxBytes)
    ) {
      throw new AtsTrialTransportError(
        "budget_exceeded",
        "ATS trial response exceeds its byte budget",
        response.status,
      );
    }

    let bytes: Uint8Array;
    try {
      bytes = await readBoundedBody(response, input.budgets.maxBytes, requestController.signal);
    } catch (error) {
      if (error instanceof AtsTrialTransportError) throw error;
      if (timeoutController.signal.aborted) {
        throw new AtsTrialTransportError(
          "budget_exceeded",
          "ATS trial response exceeded its time budget",
          response.status,
          { cause: error },
        );
      }
      if (input.signal.aborted) {
        throw new AtsTrialTransportError(
          "cancelled",
          "ATS trial response read was cancelled",
          response.status,
          { cause: error },
        );
      }
      throw new AtsTrialTransportError(
        "retryable",
        "ATS trial response body could not be read",
        response.status,
        { cause: error },
      );
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch (error) {
      throw new AtsTrialTransportError(
        "malformed",
        "ATS trial response is not valid UTF-8 JSON",
        response.status,
        { cause: error },
      );
    }
    const parsed = input.schema.safeParse(decoded);
    if (!parsed.success) {
      throw new AtsTrialTransportError(
        "malformed",
        "ATS trial response failed provider schema validation",
        response.status,
        { cause: parsed.error },
      );
    }
    return parsed.data;
  } finally {
    clearTimeout(timeout);
    input.signal.removeEventListener("abort", cancelFromCaller);
  }
}

function assertOfficialTrialUrl(url: URL, allowedHost: string): void {
  if (
    url.protocol !== "https:" ||
    url.hostname !== allowedHost ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  ) {
    throw new AtsTrialTransportError(
      "permanent",
      "ATS trial URL violates the fixed official-host policy",
    );
  }
}

function classifyHttpResponse(status: number): AtsTrialTransportError {
  if (status === 404 || status === 410) {
    return new AtsTrialTransportError(
      "not_found",
      `ATS trial tenant was not found (${status})`,
      status,
    );
  }
  if (status === 429) {
    return new AtsTrialTransportError("rate_limited", "ATS trial request was rate limited", status);
  }
  if (status >= 500 && status <= 599) {
    return new AtsTrialTransportError("retryable", `ATS trial provider failed (${status})`, status);
  }
  return new AtsTrialTransportError(
    "permanent",
    `ATS trial provider rejected the request (${status})`,
    status,
  );
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) {
        throw new AtsTrialTransportError(
          "budget_exceeded",
          "ATS trial response exceeded its time budget",
          response.status,
        );
      }
      const { done, value } = await awaitWithAbort(reader.read(), signal);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new AtsTrialTransportError(
          "budget_exceeded",
          "ATS trial response exceeds its byte budget",
          response.status,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

export type AtsTrialReadiness =
  | {
      readonly provider: "greenhouse" | "lever";
      readonly state: "trial_transport_ready";
      readonly productionReady: false;
    }
  | {
      readonly provider: "ashby";
      readonly state: "not_ready";
      readonly productionReady: false;
      readonly reasonCode: "provider_contract_missing";
      readonly blockingContract: "@hirly/contracts.Provider";
    };

export const ashbyTrialReadiness = {
  provider: "ashby",
  state: "not_ready",
  productionReady: false,
  reasonCode: "provider_contract_missing",
  blockingContract: "@hirly/contracts.Provider",
} as const satisfies AtsTrialReadiness;
