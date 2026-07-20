import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type {
  CareerSourceCandidate,
  CareerSourceCandidateRegistration,
} from "@hirly/contracts";
import {
  ATS_DISCOVERY_RESOURCE_LIMITS,
  AtsDiscoveryRejectedError,
  isPublicDiscoveryAddress,
  registerDiscoveredAtsTenant,
  validateAtsDiscoveryRedirectChain,
  type AtsDiscoveryRejectionCode,
} from "../src/ats-discovery";

function candidate(
  input: CareerSourceCandidateRegistration,
): CareerSourceCandidate {
  return {
    ...input,
    id: "00000000-0000-4000-8000-000000000001",
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastCompleteRunId: null,
    consecutiveFailures: 0,
    enabled: false,
    transportEnabled: false,
    incrementalEnabled: false,
    backfillEnabled: false,
    discoveryState: "candidate",
  };
}

describe("G011 SSRF-safe ATS tenant discovery", () => {
  test("registers a validated tenant as disabled without any fetch path", async () => {
    const registrations: CareerSourceCandidateRegistration[] = [];
    const result = await registerDiscoveredAtsTenant(
      {
        async registerCareerSourceCandidate(input) {
          registrations.push(input);
          return candidate(input);
        },
      },
      {
        redirectChain: [
          {
            url: "https://boards.greenhouse.io/Acme/jobs/123?source=observed",
            resolvedAddresses: ["93.184.216.34"],
          },
        ],
        countryCodes: ["fr", "FR"],
        companyName: "Acme",
      },
    );
    expect(registrations).toEqual([
      {
        provider: "greenhouse",
        sourceKey: "greenhouse:acme",
        tenantKey: "acme",
        companyId: null,
        companyName: "Acme",
        countryCodes: ["FR"],
        baseUrl: "https://boards.greenhouse.io/acme",
        accessType: "tenant_feed",
        policyId: null,
        syncFrequencySeconds: null,
        checkpoint: {
          version: "ats-discovery.v1",
          observedHost: "boards.greenhouse.io",
        },
      },
    ]);
    expect(result).toMatchObject({
      provider: "greenhouse",
      tenantKey: "acme",
      enabled: false,
      transportEnabled: false,
      incrementalEnabled: false,
      backfillEnabled: false,
    });
  });

  test.each([
    ["https://jobs.eu.lever.co/acme/123", "https://jobs.eu.lever.co/acme"],
    ["https://jobs.ashbyhq.com/acme/123", "https://jobs.ashbyhq.com/acme"],
    ["https://apply.workable.com/acme/j/123", "https://apply.workable.com/acme"],
    [
      "https://jobs.smartrecruiters.com/acme/123-role",
      "https://jobs.smartrecruiters.com/acme",
    ],
    [
      "https://acme.jobs.personio.de/job/123",
      "https://acme.jobs.personio.de",
    ],
    ["https://acme.recruitee.com/o/role", "https://acme.recruitee.com"],
    [
      "https://acme.teamtailor.com/jobs/123-role",
      "https://acme.teamtailor.com/jobs",
    ],
    [
      "https://careers.flatchr.io/fr/company/acme/jobs/123",
      "https://careers.flatchr.io/fr/company/acme",
    ],
    [
      "https://acme.nicoka.com/api/jobs/published?jobid=123",
      "https://acme.nicoka.com",
    ],
    [
      "https://trial.nicoka.com/acme/api/jobs/published?jobid=123",
      "https://trial.nicoka.com/acme",
    ],
  ])("registers canonical query-free base URL for %s", async (url, baseUrl) => {
    const registrations: CareerSourceCandidateRegistration[] = [];
    await registerDiscoveredAtsTenant(
      {
        async registerCareerSourceCandidate(input) {
          registrations.push(input);
          return candidate(input);
        },
      },
      {
        redirectChain: [
          { url, resolvedAddresses: ["93.184.216.34"] },
        ],
        countryCodes: ["FR"],
      },
    );
    expect(registrations[0]?.baseUrl).toBe(baseUrl);
  });

  test.each([
    "127.0.0.1",
    "10.0.0.1",
    "100.64.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.0.1",
    "192.0.2.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
    "2002:7f00:1::",
  ])("rejects non-public DNS address %s", (address) => {
    expect(isPublicDiscoveryAddress(address)).toBe(false);
    expect(() =>
      validateAtsDiscoveryRedirectChain([
        {
          url: "https://jobs.lever.co/acme/123",
          resolvedAddresses: [address],
        },
      ]),
    ).toThrow("globally routable");
  });

  test.each([
    "1.1.1.1",
    "8.8.8.8",
    "93.184.216.34",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
  ])("accepts globally routable DNS address %s", (address) => {
    expect(isPublicDiscoveryAddress(address)).toBe(true);
  });

  test("fails the entire hop on mixed public/private DNS answers", () => {
    expect(() =>
      validateAtsDiscoveryRedirectChain([
        {
          url: "https://jobs.ashbyhq.com/acme/123",
          resolvedAddresses: ["93.184.216.34", "127.0.0.1"],
        },
      ]),
    ).toThrow("globally routable");
  });

  test.each([
    ["http://jobs.lever.co/acme/123", "https_required"],
    ["https://user:secret@jobs.lever.co/acme/123", "credentials_forbidden"],
    ["https://jobs.lever.co:8443/acme/123", "port_forbidden"],
    ["https://2130706433/acme/123", "ip_literal_host_blocked"],
    ["https://0x7f000001/acme/123", "ip_literal_host_blocked"],
    ["https://[::1]/acme/123", "ip_literal_host_blocked"],
    ["https://jobs.lever.co.evil.example/acme/123", "unsupported_ats_url"],
    ["https://careers.recruitee.com/acme/jobs/123", "tenant_missing"],
    ["https://j\u043Ebs.lever.co/acme/123", "unsupported_ats_url"],
  ])("rejects hostile URL %s with %s", (url, code) => {
    try {
      validateAtsDiscoveryRedirectChain([
        { url, resolvedAddresses: ["93.184.216.34"] },
      ]);
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(AtsDiscoveryRejectedError);
      expect((error as AtsDiscoveryRejectedError).code).toBe(
        code as AtsDiscoveryRejectionCode,
      );
    }
  });

  test("revalidates every redirect and never registers a private redirect target", async () => {
    let registrations = 0;
    await expect(
      registerDiscoveredAtsTenant(
        {
          async registerCareerSourceCandidate(input) {
            registrations += 1;
            return candidate(input);
          },
        },
        {
          redirectChain: [
            {
              url: "https://jobs.lever.co/acme/123",
              resolvedAddresses: ["93.184.216.34"],
            },
            {
              url: "https://jobs.lever.co/acme/123",
              resolvedAddresses: ["169.254.169.254"],
            },
          ],
          countryCodes: ["FR"],
        },
      ),
    ).rejects.toMatchObject({ code: "dns_answer_not_public" });
    expect(registrations).toBe(0);
  });

  test("pins one validated address per redirect hop", () => {
    const chain = validateAtsDiscoveryRedirectChain([
      {
        url: "https://job-boards.greenhouse.io/acme/jobs/123",
        resolvedAddresses: ["93.184.216.35", "93.184.216.34"],
      },
      {
        url: "https://boards.greenhouse.io/acme/jobs/123",
        resolvedAddresses: ["1.1.1.1"],
      },
    ]);
    expect(chain.hops.map((hop) => hop.pinnedAddress)).toEqual([
      "93.184.216.34",
      "1.1.1.1",
    ]);
  });

  test("enforces redirect, URL, and DNS answer bounds", () => {
    expect(() =>
      validateAtsDiscoveryRedirectChain(
        Array.from(
          { length: ATS_DISCOVERY_RESOURCE_LIMITS.maxRedirects + 2 },
          () => ({
            url: "https://jobs.lever.co/acme/123",
            resolvedAddresses: ["93.184.216.34"],
          }),
        ),
      ),
    ).toThrow("redirect count");
    expect(() =>
      validateAtsDiscoveryRedirectChain([
        {
          url: `https://jobs.lever.co/acme/${"x".repeat(
            ATS_DISCOVERY_RESOURCE_LIMITS.maxUrlLength,
          )}`,
          resolvedAddresses: ["93.184.216.34"],
        },
      ]),
    ).toThrow("bounded length");
    expect(() =>
      validateAtsDiscoveryRedirectChain([
        {
          url: "https://jobs.lever.co/acme/123",
          resolvedAddresses: Array.from(
            { length: ATS_DISCOVERY_RESOURCE_LIMITS.maxDnsAnswers + 1 },
            (_, index) => `8.8.8.${index + 1}`,
          ),
        },
      ]),
    ).toThrow("DNS answer count");
  });

  test("rejects a registrar response that unexpectedly enables the source", async () => {
    await expect(
      registerDiscoveredAtsTenant(
        {
          async registerCareerSourceCandidate(input) {
            return { ...candidate(input), enabled: true };
          },
        },
        {
          redirectChain: [
            {
              url: "https://acme.jobs.personio.com/job/123",
              resolvedAddresses: ["93.184.216.34"],
            },
          ],
          countryCodes: ["FR"],
        },
      ),
    ).rejects.toMatchObject({ code: "registration_not_disabled" });
  });

  test("validates bounded registration metadata before calling the repository", async () => {
    let registrations = 0;
    await expect(
      registerDiscoveredAtsTenant(
        {
          async registerCareerSourceCandidate(input) {
            registrations += 1;
            return candidate(input);
          },
        },
        {
          redirectChain: [
            {
              url: "https://jobs.lever.co/acme/123",
              resolvedAddresses: ["93.184.216.34"],
            },
          ],
          countryCodes: [],
        },
      ),
    ).rejects.toThrow();
    expect(registrations).toBe(0);
  });

  test("contains no HTTP fetch or application-submission implementation", () => {
    const source = readFileSync(
      new URL("../src/ats-discovery.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/node:https?|undici|playwright/i);
    expect(source).not.toMatch(/submit|application.*create|candidate.*create/i);
  });
});
