import { describe, expect, test } from "bun:test";
import {
  AtsTrialTransportError,
  ashbyTrialReadiness,
  type AtsTrialFetch,
} from "../apps/worker/src/providers/ats-trial-transport";
import {
  createGreenhouseTrialTransport,
  greenhouseProvider,
} from "../apps/worker/src/providers/greenhouse";
import {
  createLeverTrialTransport,
  leverProvider,
} from "../apps/worker/src/providers/lever";

const greenhouseJob = {
  id: 127817,
  title: "Vault Designer",
  location: { name: "NYC" },
  absolute_url: "https://boards.greenhouse.io/vaulttec/jobs/127817",
  content: "Design safe vaults.",
};

const leverJob = {
  id: "posting-001",
  text: "Platform Engineer",
  categories: { location: "Paris", commitment: "Full-time" },
  country: "FR",
  descriptionPlain: "Build services.",
  additionalPlain: "",
  hostedUrl: "https://jobs.eu.lever.co/leverdemo/posting-001",
  applyUrl: "https://jobs.eu.lever.co/leverdemo/posting-001/apply",
};

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("G014 bounded ATS trial transports", () => {
  test("fetches one schema-validated Greenhouse board from its fixed official host", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const injectedFetch: AtsTrialFetch = async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ jobs: [greenhouseJob], meta: { total: 1 } });
    };
    const transport = createGreenhouseTrialTransport({
      approvedTenantId: "vaulttec",
      fetch: injectedFetch,
    });

    expect(await transport.fetch(new AbortController().signal)).toEqual([
      { ...greenhouseJob, id: "127817" },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://boards-api.greenhouse.io/v1/boards/vaulttec/jobs?content=true",
    );
    expect(calls[0].init).toMatchObject({
      method: "GET",
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    expect(transport).toMatchObject({
      trialOnly: true,
      manualInvocationOnly: true,
      liveTransportReady: false,
      canonicalWriteReady: false,
      credentialsAccepted: false,
      approvedTenantId: "vaulttec",
      budgets: { maxRequests: 1, maxPages: 1 },
    });
  });

  test("binds Lever region and exact approved tenant without accepting a URL", async () => {
    const urls: string[] = [];
    const transport = createLeverTrialTransport({
      approvedTenantId: "leverdemo",
      region: "eu",
      fetch: async (url) => {
        urls.push(url);
        return jsonResponse([leverJob]);
      },
    });
    expect(await transport.fetch(new AbortController().signal)).toEqual([
      leverJob,
    ]);
    expect(urls).toEqual([
      "https://api.eu.lever.co/v0/postings/leverdemo?mode=json",
    ]);
    expect(transport.region).toBe("eu");
  });

  test("rejects tenant identifiers that could alter the fixed request route", () => {
    for (const approvedTenantId of [
      "../other",
      "tenant?token=secret",
      "https://evil.example",
      "user:password",
      "tenant.name",
    ]) {
      expect(() =>
        createGreenhouseTrialTransport({ approvedTenantId }),
      ).toThrow();
    }
  });

  test.each([
    [404, "not_found"],
    [410, "not_found"],
    [429, "rate_limited"],
    [500, "retryable"],
    [503, "retryable"],
    [401, "permanent"],
  ] as const)("classifies HTTP %i as %s", async (status, classification) => {
    const transport = createGreenhouseTrialTransport({
      approvedTenantId: "vaulttec",
      fetch: async () => new Response("", { status }),
    });
    try {
      await transport.fetch(new AbortController().signal);
      throw new Error("expected transport failure");
    } catch (error) {
      expect(error).toBeInstanceOf(AtsTrialTransportError);
      expect((error as AtsTrialTransportError).classification).toBe(
        classification,
      );
      expect((error as AtsTrialTransportError).status).toBe(status);
    }
  });

  test("fails closed on malformed JSON, provider schema drift and byte budgets", async () => {
    const malformed = createGreenhouseTrialTransport({
      approvedTenantId: "vaulttec",
      fetch: async () => new Response("{"),
    });
    await expect(
      malformed.fetch(new AbortController().signal),
    ).rejects.toMatchObject({ classification: "malformed" });

    const drifted = createGreenhouseTrialTransport({
      approvedTenantId: "vaulttec",
      fetch: async () => jsonResponse({ jobs: [{ id: 1 }] }),
    });
    await expect(
      drifted.fetch(new AbortController().signal),
    ).rejects.toMatchObject({ classification: "malformed" });

    const oversized = createGreenhouseTrialTransport({
      approvedTenantId: "vaulttec",
      budgets: { maxBytes: 8 },
      fetch: async () =>
        jsonResponse(
          { jobs: [greenhouseJob] },
          { headers: { "content-length": "999" } },
        ),
    });
    await expect(
      oversized.fetch(new AbortController().signal),
    ).rejects.toMatchObject({ classification: "budget_exceeded" });
  });

  test("enforces the total time budget even when an injected fetch ignores abort", async () => {
    const transport = createGreenhouseTrialTransport({
      approvedTenantId: "vaulttec",
      budgets: { timeoutMs: 5 },
      fetch: () => new Promise<Response>(() => {}),
    });
    await expect(
      transport.fetch(new AbortController().signal),
    ).rejects.toMatchObject({ classification: "budget_exceeded" });
  });

  test("keeps production provider modules disabled and Ashby typed not-ready", () => {
    for (const provider of [greenhouseProvider, leverProvider]) {
      expect(provider.liveTransportReady).toBe(false);
      expect(provider.canonicalWriteReady).toBe(false);
      expect(provider.transport.constructor.name).toBe(
        "DisabledProviderTransport",
      );
    }
    expect(ashbyTrialReadiness).toEqual({
      provider: "ashby",
      state: "not_ready",
      productionReady: false,
      reasonCode: "provider_contract_missing",
      blockingContract: "@hirly/contracts.Provider",
    });
  });
});
