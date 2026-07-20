import { timingSafeEqual, createHash } from "node:crypto";
import {
  CONTRACT_VERSION,
  enqueueRunSchema,
  healthSchema,
  providerSchema,
  type EnqueueRun,
} from "@hirly/contracts";
import type { Logger } from "@hirly/observability";
import { z } from "zod";
import type { RuntimeConfig } from "../runtime/config";
import type {
  Enqueuer,
  QueueRepository,
  RuntimeStore,
} from "../runtime/types";
import { assertProviderTransportActive } from "../providers";

interface HealthState {
  ready: boolean;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function tokenMatches(expected: string | undefined, provided: string): boolean {
  if (!expected) return false;
  const expectedDigest = createHash("sha256").update(expected).digest();
  const providedDigest = createHash("sha256").update(provided).digest();
  return timingSafeEqual(expectedDigest, providedDigest);
}

function authenticate(request: Request, token: string | undefined): Response | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return json({ error: "unauthorized" }, 401);
  }
  if (!tokenMatches(token, authorization.slice(7))) {
    return json({ error: "forbidden" }, 403);
  }
  return null;
}

async function parseEnqueueRequest(request: Request): Promise<EnqueueRun> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > 64 * 1024) throw new PayloadTooLargeError();
  const bytes = await readBodyLimited(request, 64 * 1024);
  const controlEnqueueSchema = z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("inventory_maintenance"),
        provider: z.null(),
        idempotencyKey: z.string().min(1).max(256),
        triggerSource: z.literal("http"),
        tasks: z
          .tuple([
            z
              .object({
                taskKey: z.literal("inventory-maintenance"),
                taskType: z.literal("inventory.maintenance"),
                payload: z.object({}).strict(),
                maxAttempts: z.number().int().positive().max(10).optional(),
              })
              .strict(),
          ]),
      })
      .strict(),
    z
      .object({
        kind: z.literal("provider_ingestion"),
        provider: providerSchema,
        idempotencyKey: z.string().min(1).max(256),
        triggerSource: z.literal("http"),
        tasks: z
          .tuple([
            z
              .object({
                taskKey: z.string().regex(/^[a-z]+:[a-z0-9_-]+$/),
                taskType: z.literal("provider.fetch_page"),
                payload: z
                  .object({
                    cursor: z.string().max(512).optional(),
                    fixtureId: z.string().max(128).optional(),
                  })
                  .strict(),
                maxAttempts: z.number().int().positive().max(10).optional(),
              })
              .strict(),
          ]),
      })
      .strict(),
  ]);
  return enqueueRunSchema.parse(controlEnqueueSchema.parse(await request.json()));
}

async function readBodyLimited(request: Request, limit: number): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel("payload_too_large");
      throw new PayloadTooLargeError();
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

class PayloadTooLargeError extends Error {
  constructor() {
    super("payload_too_large");
  }
}

export function createHttpHandler(input: {
  config: RuntimeConfig;
  queue: QueueRepository & Enqueuer;
  store: RuntimeStore;
  logger: Logger;
  health: HealthState;
}): Bun.Server<unknown> {
  return Bun.serve({
    port: input.config.PORT,
    idleTimeout: 10,
    async fetch(request) {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/health/live") {
        return json(
          healthSchema.parse({
            status: "live",
            contractVersion: CONTRACT_VERSION,
          }),
        );
      }
      if (request.method === "GET" && url.pathname === "/health/ready") {
        const databaseReady = input.health.ready
          ? await Promise.race([
              input.queue.ping().catch(() => false),
              new Promise<false>((resolve) =>
                setTimeout(() => resolve(false), 1_000),
              ),
            ])
          : false;
        const ready = input.health.ready && databaseReady;
        return json(
          healthSchema.parse({
            status: ready ? "ready" : "not_ready",
            contractVersion: CONTRACT_VERSION,
          }),
          ready ? 200 : 503,
        );
      }
      if (!url.pathname.startsWith("/control/")) {
        return json({ error: "not_found" }, 404);
      }
      const authFailure = authenticate(
        request,
        input.config.WORKER_CONTROL_ENABLED
          ? input.config.WORKER_CONTROL_TOKEN
          : undefined,
      );
      if (authFailure) return authFailure;
      if (!input.health.ready) return json({ error: "draining" }, 503);

      try {
        if (request.method === "POST" && url.pathname === "/control/enqueue") {
          const body = await parseEnqueueRequest(request);
          if (body.provider) {
            const provider = providerSchema.parse(body.provider);
            await input.store.assertProviderRunnable(provider);
            assertProviderTransportActive(provider);
          }
          const runId = await input.queue.enqueue(body);
          input.logger.emit({
            service: "hirly-worker",
            version: "0.1.0",
            environment: input.config.NODE_ENV,
            event: "worker.http_enqueued",
            severity: "info",
            runId,
            triggerSource: "http",
            details: {
              actorFingerprint: createHash("sha256")
                .update(request.headers.get("authorization") ?? "")
                .digest("hex")
                .slice(0, 12),
            },
          });
          return json({ runId }, 202);
        }
        const runMatch = url.pathname.match(
          /^\/control\/runs\/([0-9a-f-]{36})$/,
        );
        if (request.method === "GET" && runMatch) {
          const run = await input.store.getRun(runMatch[1]!);
          return run ? json(run) : json({ error: "not_found" }, 404);
        }
      } catch (error) {
        const authorizationBlocked =
          error instanceof Error &&
          (error.message === "authorization_blocked" ||
            "code" in error &&
              (error as { code?: string }).code === "authorization_blocked");
        const status =
          error instanceof PayloadTooLargeError
            ? 413
            : authorizationBlocked
              ? 409
              : 400;
        const code =
          error instanceof PayloadTooLargeError
            ? "payload_too_large"
            : authorizationBlocked
              ? "authorization_blocked"
              : "invalid_input";
        return json({ error: code }, status);
      }
      return json({ error: "not_found" }, 404);
    },
  });
}
