import { afterEach, describe, expect, test } from "bun:test";
import { environmentSproutSession } from "../apps/worker/src/runtime/handlers";
import { SproutSessionCipher } from "../apps/worker/src/providers/sprout/session";

const savedEnvironment = {
  access: process.env.SPROUT_FRANCE_API_TOKEN,
  refresh: process.env.SPROUT_FRANCE_REFRESH_TOKEN,
  anon: process.env.SPROUT_SUPABASE_ANON_KEY,
  encryption: process.env.SPROUT_SESSION_ENCRYPTION_KEY,
};
const savedFetch = globalThis.fetch;

afterEach(() => {
  process.env.SPROUT_FRANCE_API_TOKEN = savedEnvironment.access;
  process.env.SPROUT_FRANCE_REFRESH_TOKEN = savedEnvironment.refresh;
  process.env.SPROUT_SUPABASE_ANON_KEY = savedEnvironment.anon;
  process.env.SPROUT_SESSION_ENCRYPTION_KEY = savedEnvironment.encryption;
  globalThis.fetch = savedFetch;
});

describe("Sprout durable auth session", () => {
  test("encrypts sessions and rejects an altered ciphertext", () => {
    const cipher = SproutSessionCipher.fromEnvironment(Buffer.alloc(32, 7).toString("base64"))!;
    const encrypted = cipher.encrypt({ accessToken: "access", refreshToken: "refresh" });
    expect(encrypted).not.toContain("access");
    expect(cipher.decrypt(encrypted)).toEqual({ accessToken: "access", refreshToken: "refresh" });
    expect(() => cipher.decrypt(`${encrypted.slice(0, -2)}xx`)).toThrow(
      "sprout_persisted_session_invalid",
    );
  });

  test("persists a rotated token and a new worker prefers it over bootstrap variables", async () => {
    process.env.SPROUT_SESSION_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    process.env.SPROUT_FRANCE_API_TOKEN = "bootstrap-access";
    process.env.SPROUT_FRANCE_REFRESH_TOKEN = "bootstrap-refresh";
    process.env.SPROUT_SUPABASE_ANON_KEY = "public-key";

    let persisted: { version: bigint; ciphertext: string } | null = null;
    const store = {
      async getSproutAuthSession() {
        return persisted;
      },
      async compareAndSwapSproutAuthSession(expectedVersion: bigint | null, ciphertext: string) {
        if (persisted && expectedVersion !== persisted.version) return null;
        if (!persisted && expectedVersion !== null) return null;
        persisted = { version: (persisted?.version ?? 0n) + 1n, ciphertext };
        return persisted.version;
      },
    };
    globalThis.fetch = (async () =>
      Response.json({
        access_token: "rotated-access",
        refresh_token: "rotated-refresh",
      })) as typeof fetch;

    const first = environmentSproutSession(store);
    expect(
      await first.secrets.resolve("secret://sprout/france-api", new AbortController().signal),
    ).toEqual({
      accessToken: "bootstrap-access",
      refreshToken: "bootstrap-refresh",
    });
    await expect(
      first.tokenRefresher.refresh("bootstrap-refresh", new AbortController().signal),
    ).resolves.toEqual({
      accessToken: "rotated-access",
      refreshToken: "rotated-refresh",
    });
    expect(persisted?.ciphertext).not.toContain("rotated-access");

    process.env.SPROUT_FRANCE_API_TOKEN = "stale-bootstrap-access";
    process.env.SPROUT_FRANCE_REFRESH_TOKEN = "stale-bootstrap-refresh";
    const restarted = environmentSproutSession(store);
    await expect(
      restarted.secrets.resolve("secret://sprout/france-api", new AbortController().signal),
    ).resolves.toEqual({
      accessToken: "rotated-access",
      refreshToken: "rotated-refresh",
    });
  });
});

test("recovers the persisted winner when another worker consumed the refresh token", async () => {
  process.env.SPROUT_SESSION_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
  process.env.SPROUT_FRANCE_API_TOKEN = "stale-access";
  process.env.SPROUT_FRANCE_REFRESH_TOKEN = "stale-refresh";
  process.env.SPROUT_SUPABASE_ANON_KEY = "public-key";
  const cipher = SproutSessionCipher.fromEnvironment(process.env.SPROUT_SESSION_ENCRYPTION_KEY)!;
  const persisted = {
    version: 2n,
    ciphertext: cipher.encrypt({ accessToken: "winner-access", refreshToken: "winner-refresh" }),
  };
  const store = {
    async getSproutAuthSession() {
      return persisted;
    },
    async compareAndSwapSproutAuthSession() {
      return null;
    },
  };
  globalThis.fetch = (async () => new Response(null, { status: 401 })) as typeof fetch;

  const session = environmentSproutSession(store);
  // Simulate a request that began with version 1 while another worker has
  // already stored version 2 before its rejected refresh response arrives.
  const initialStore = {
    reads: 0,
    async getSproutAuthSession() {
      this.reads += 1;
      return this.reads === 1
        ? {
            version: 1n,
            ciphertext: cipher.encrypt({
              accessToken: "stale-access",
              refreshToken: "stale-refresh",
            }),
          }
        : persisted;
    },
    async compareAndSwapSproutAuthSession() {
      return null;
    },
  };
  const racingSession = environmentSproutSession(initialStore);
  await expect(
    racingSession.tokenRefresher.refresh("stale-refresh", new AbortController().signal),
  ).resolves.toEqual({
    accessToken: "winner-access",
    refreshToken: "winner-refresh",
  });
  await expect(
    session.secrets.resolve("secret://sprout/france-api", new AbortController().signal),
  ).resolves.toEqual({
    accessToken: "winner-access",
    refreshToken: "winner-refresh",
  });
});
