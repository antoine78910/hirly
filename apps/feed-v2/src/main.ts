import { FeedV2ReadService } from "@hirly/feed-v2";
import postgres from "postgres";
import {
  createFeedV2Handler,
  type FeedReadSqlClient,
  HmacFeedAssertionVerifier,
  PostgresFeedReadRepository,
  parseFeedV2Config,
} from "./index";

export function startFeedV2(env: Record<string, string | undefined> = Bun.env) {
  const config = parseFeedV2Config(env);
  if (!config.routingEnabled) {
    return Bun.serve({
      port: config.port,
      fetch: createFeedV2Handler({
        config,
        auth: {
          async verify() {
            throw new Error("feed_v2_disabled");
          },
        },
        service: {
          async read() {
            throw new Error("feed_v2_disabled");
          },
        },
      }),
    });
  }
  if (!config.databaseUrl || !config.assertionSecret) {
    throw new Error("Feed v2 routing requires a database URL and assertion secret");
  }
  const sql = postgres(config.databaseUrl, {
    max: 5,
    connect_timeout: Math.max(1, Math.ceil(config.requestTimeoutMs / 1_000)),
    idle_timeout: 20,
  });
  const repository = new PostgresFeedReadRepository(sql as unknown as FeedReadSqlClient);
  return Bun.serve({
    port: config.port,
    fetch: createFeedV2Handler({
      config,
      auth: new HmacFeedAssertionVerifier(config.assertionSecret),
      service: new FeedV2ReadService(repository),
    }),
  });
}

if (import.meta.main) startFeedV2();
