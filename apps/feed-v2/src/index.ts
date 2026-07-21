import {
  FeedAuthorizationError,
  FeedCursorError,
  type FeedAuthAssertion,
  type FeedV2ReadService,
} from "@hirly/feed-v2";

export interface FeedAuthAssertionVerifier {
  verify(request: Request): Promise<FeedAuthAssertion>;
}

export interface FeedV2AppConfig {
  routingEnabled: boolean;
  requestTimeoutMs?: number;
}

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

function positiveInteger(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (!/^\d+$/.test(value)) throw new Error("invalid_limit");
  const parsed = Number(value);
  if (parsed < 1 || parsed > 100) throw new Error("invalid_limit");
  return parsed;
}

async function withDeadline<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("request_timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function createFeedV2Handler(input: {
  config: FeedV2AppConfig;
  auth: FeedAuthAssertionVerifier;
  service: Pick<FeedV2ReadService, "read">;
}) {
  return async function fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health/live") {
      return json({ status: "live", routingEnabled: input.config.routingEnabled }, 200);
    }
    if (!input.config.routingEnabled) {
      return json({ error: "feed_v2_disabled" }, 404);
    }
    if (request.method !== "GET" || url.pathname !== "/internal/feed/v2") {
      return json({ error: "not_found" }, 404);
    }

    try {
      const response = await withDeadline(
        (async () => {
          const assertion = await input.auth.verify(request);
          return input.service.read({
            assertion,
            cursor: url.searchParams.get("cursor"),
            limit: positiveInteger(url.searchParams.get("limit")),
          });
        })(),
        input.config.requestTimeoutMs ?? 1_500,
      );
      return json(response, 200);
    } catch (error) {
      if (error instanceof FeedAuthorizationError) {
        return json({ error: error.message }, 403);
      }
      if (error instanceof FeedCursorError) {
        return json(
          { error: error.message === "stale_cursor" ? "FEED_CURSOR_STALE" : "invalid_cursor" },
          error.message === "stale_cursor" ? 409 : 400,
        );
      }
      if (error instanceof Error && error.message === "invalid_limit") {
        return json({ error: "invalid_limit" }, 400);
      }
      if (error instanceof Error && error.message === "request_timeout") {
        return json({ error: "request_timeout" }, 504);
      }
      return json({ error: "unauthorized" }, 401);
    }
  };
}

export * from "./auth";
export * from "./config";
export * from "./repository";
