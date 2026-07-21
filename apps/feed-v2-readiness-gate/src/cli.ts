import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { evaluateFeedV2Readiness, type FeedV2ReadinessInput } from "./gate";

function value(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index < 0 ? undefined : argv[index + 1];
}

async function getJson(url: string, timeoutMs: number, headers: HeadersInit = {}) {
  const started = performance.now();
  const response = await fetch(url, {
    method: "GET",
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  return {
    status: response.status,
    latencyMs: Math.round(performance.now() - started),
    body: await response.json() as Record<string, unknown>,
  };
}

export async function runFeedV2ReadinessCli(argv: string[]): Promise<void> {
  const fixture = value(argv, "--fixture");
  const output = value(argv, "--output") ?? "artifacts/candidate-matching/feed-v2-readiness.json";
  let input: FeedV2ReadinessInput;
  if (fixture) {
    input = JSON.parse(await readFile(fixture, "utf8")) as FeedV2ReadinessInput;
  } else {
    const sloMs = Number(process.env.FEED_V2_SMOKE_SLO_MS ?? "1500");
    const internalUrl = process.env.FEED_V2_INTERNAL_URL?.trim();
    const healthUrl = value(argv, "--health-url")
      ?? (internalUrl ? new URL("/health/live", internalUrl).toString() : undefined);
    if (!healthUrl) throw new Error("health_url_required");
    const health = await getJson(healthUrl, sloMs);
    const publicUrl = value(argv, "--public-url");
    const auth = process.env.FEED_V2_SMOKE_AUTHORIZATION;
    const publicSmoke = publicUrl
      ? await getJson(publicUrl, sloMs, auth ? { authorization: auth } : {})
      : undefined;
    input = {
      delegationEnabled: process.env.FEED_V2_DELEGATION_ENABLED === "true",
      internalUrl,
      assertionSecretLength: process.env.FEED_V2_ASSERTION_SECRET?.length ?? 0,
      cohortUserIds: (process.env.FEED_V2_COHORT_USER_IDS ?? "").split(","),
      smokeCandidateId: process.env.FEED_V2_SMOKE_CANDIDATE_ID,
      sloMs,
      health: {
        status: String(health.body.status ?? ""),
        routingEnabled: health.body.routingEnabled === true,
        latencyMs: health.latencyMs,
      },
      ...(publicSmoke ? {
        publicSmoke: {
          role: value(argv, "--role"),
          location: value(argv, "--location"),
          radiusKm: Number(value(argv, "--radius-km")),
          ...publicSmoke,
        },
      } : {}),
    };
  }
  const evidence = evaluateFeedV2Readiness(input);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence));
  if (evidence.deploymentStatus !== "READY") process.exitCode = 1;
}

if (import.meta.main) await runFeedV2ReadinessCli(Bun.argv.slice(2));
