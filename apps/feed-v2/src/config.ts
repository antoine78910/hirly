export interface FeedV2RuntimeConfig {
  routingEnabled: boolean;
  port: number;
  requestTimeoutMs: number;
  databaseUrl: string | null;
  assertionSecret: string | null;
}

function integer(name: string, value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer`);
  const parsed = Number(value);
  if (parsed < minimum || parsed > maximum) throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  return parsed;
}

export function parseFeedV2Config(env: Record<string, string | undefined>): FeedV2RuntimeConfig {
  const routingEnabled = env.FEED_V2_ROUTING_ENABLED === "true";
  if (env.FEED_V2_ROUTING_ENABLED !== undefined && !["true", "false"].includes(env.FEED_V2_ROUTING_ENABLED)) {
    throw new Error("FEED_V2_ROUTING_ENABLED must be true or false");
  }
  const databaseUrl = env.JOBS_DATABASE_URL?.trim() || null;
  const assertionSecret = env.FEED_V2_ASSERTION_SECRET?.trim() || null;
  if (routingEnabled && !databaseUrl) throw new Error("JOBS_DATABASE_URL is required when Feed v2 routing is enabled");
  if (routingEnabled && (!assertionSecret || assertionSecret.length < 32)) {
    throw new Error("FEED_V2_ASSERTION_SECRET must contain at least 32 characters when routing is enabled");
  }
  return {
    routingEnabled,
    port: integer("FEED_V2_PORT", env.FEED_V2_PORT, 3_002, 1, 65_535),
    requestTimeoutMs: integer("FEED_V2_REQUEST_TIMEOUT_MS", env.FEED_V2_REQUEST_TIMEOUT_MS, 1_500, 100, 10_000),
    databaseUrl,
    assertionSecret,
  };
}
