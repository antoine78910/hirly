import { describe, expect, test } from "bun:test";
import {
  ATS_PROVIDER_HOST_PATTERNS,
  classifyAtsUrl,
  type AtsProvider,
} from "../src/ats";

describe("G011 ATS URL classification", () => {
  test.each([
    [
      "https://boards.greenhouse.io/Acme/jobs/123?gh_src=campaign#apply",
      "greenhouse",
      "acme",
      "123",
    ],
    [
      "https://job-boards.greenhouse.io/acme/jobs/456",
      "greenhouse",
      "acme",
      "456",
    ],
    ["https://jobs.lever.co/Acme/abc", "lever", "acme", "abc"],
    ["https://jobs.eu.lever.co/acme/def", "lever", "acme", "def"],
    ["https://jobs.ashbyhq.com/Acme/abc-123", "ashby", "acme", "abc-123"],
    ["https://apply.workable.com/acme/j/ABC123/", "workable", "acme", "ABC123"],
    [
      "https://jobs.smartrecruiters.com/Acme/744000135866249-role",
      "smartrecruiters",
      "acme",
      "744000135866249",
    ],
    [
      "https://acme.jobs.personio.de/job/2616841",
      "personio",
      "acme",
      "2616841",
    ],
    ["https://acme.recruitee.com/o/platform-engineer", "recruitee", "acme", null],
    [
      "https://owlco.na.teamtailor.com/jobs/8010892-midmarket-sdr",
      "teamtailor",
      "owlco.na",
      "8010892",
    ],
    [
      "https://careers.flatchr.io/fr/company/Acme/jobs/42",
      "flatchr",
      "acme",
      "42",
    ],
    [
      "https://acme.nicoka.com/api/jobs/published?jobid=76",
      "nicoka",
      "acme",
      "76",
    ],
    [
      "https://trial.nicoka.com/acme/api/jobs/published?jobid=77",
      "nicoka",
      "acme",
      "77",
    ],
  ])(
    "extracts provider, normalized tenant and posting from %s",
    (url, provider, tenantKey, postingId) => {
      const result = classifyAtsUrl(url);
      expect(result.provider).toBe(provider as AtsProvider);
      expect(result.tenantKey).toBe(tenantKey);
      expect(result.boardKey).toBe(tenantKey);
      expect(result.postingId).toBe(postingId);
      expect(result.match).toBe("tenant");
      expect(result.originalUrl).toBe(url);
    },
  );

  test.each([
    ["https://greenhouse.io", "greenhouse"],
    ["https://api.eu.lever.co/v0/postings/acme", "lever"],
    ["https://www.workable.com/boards/workable.xml", "workable"],
    ["https://careers.recruitee.com", "recruitee"],
    ["https://jobs.personio.com/job/123", "personio"],
    ["https://myworkdayjobs.com/en-US/acme", "workday"],
    ["https://example.icims.com/jobs/123", "icims"],
    ["https://example.taleez.com", "taleez"],
    ["https://jobs.werecruit.io", "werecruit"],
    ["https://example.digitalrecruiters.com", "digitalrecruiters"],
    ["https://example.jobaffinity.fr", "jobaffinity"],
    ["https://example.bamboohr.com/careers/1", "bamboohr"],
    ["https://jobs.sap.com/job/1", "successfactors"],
    ["https://example.breezy.hr/p/123", "breezyhr"],
  ])("classifies provider-only URLs without inventing a tenant: %s", (url, provider) => {
    const result = classifyAtsUrl(url);
    expect(result.provider).toBe(provider as AtsProvider);
    expect(result.match).toBe("provider_only");
    expect(result.tenantKey).toBeNull();
  });

  test.each([
    "not a URL",
    "https://greenhouse.io.evil.example/acme/jobs/1",
    "https://evilrecruitee.com/o/1",
    "https://teamtailor.com.evil.example/jobs/1",
    "https://careers.recruitee.com/acme/jobs/1",
    "https://jobs.personio.com/acme/job/1",
  ])("fails closed for unknown or non-tenant URLs: %s", (url) => {
    const result = classifyAtsUrl(url);
    expect(result.tenantKey).toBeNull();
    expect(result.match).not.toBe("tenant");
  });

  test("publishes exact provider host patterns for audit artifacts", () => {
    expect(ATS_PROVIDER_HOST_PATTERNS.greenhouse).toEqual([
      "boards.greenhouse.io",
      "job-boards.greenhouse.io",
      "greenhouse.io",
    ]);
    expect(ATS_PROVIDER_HOST_PATTERNS.nicoka).toEqual([
      "*.nicoka.com",
      "trial.nicoka.com/{tenant}",
    ]);
  });
});
