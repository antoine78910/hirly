import { describe, expect, test } from "bun:test";
import type {
  CandidateActionProjection,
  CandidateProjectionOutboxEvent,
  CandidateSearchProfile,
} from "@hirly/contracts";
import {
  CandidateProjector,
  normalizeCandidateAction,
  normalizeCandidateProfile,
  type CandidateProjectionSource,
  type CandidateProjectionStore,
  type CandidateSourceSnapshot,
  type ProjectionApplyResult,
} from "../src";
import fixture from "./fixtures/paris-fullstack-candidate.json";

const event = fixture.event as CandidateProjectionOutboxEvent;

class FakeSource implements CandidateProjectionSource {
  acknowledgements: string[] = [];
  constructor(
    readonly events: CandidateProjectionOutboxEvent[],
    readonly snapshot: CandidateSourceSnapshot,
    readonly action: Record<string, unknown> | null = null,
  ) {}
  async claim(): Promise<CandidateProjectionOutboxEvent[]> { return this.events; }
  async loadCandidate(): Promise<CandidateSourceSnapshot> { return this.snapshot; }
  async loadAction(): Promise<Record<string, unknown> | null> { return this.action; }
  async acknowledge(eventId: string): Promise<boolean> {
    this.acknowledgements.push(eventId);
    return true;
  }
}

class FakeStore implements CandidateProjectionStore {
  calls: string[] = [];
  result: ProjectionApplyResult = "applied";
  groupId: string | null = "22222222-2222-4222-8222-222222222222";
  async resolveCanonicalGroup(): Promise<string | null> { return this.groupId; }
  async applyProfile(_profile: CandidateSearchProfile): Promise<ProjectionApplyResult> {
    this.calls.push("profile"); return this.result;
  }
  async applyPausedProfile(_profile: CandidateSearchProfile): Promise<ProjectionApplyResult> {
    this.calls.push("pause-and-purge"); return this.result;
  }
  async applyAction(_action: CandidateActionProjection): Promise<ProjectionApplyResult> {
    this.calls.push("action"); return this.result;
  }
  async retireAction(): Promise<ProjectionApplyResult> {
    this.calls.push("retire-action"); return this.result;
  }
  async applyDeletion(): Promise<ProjectionApplyResult> {
    this.calls.push("delete-and-purge"); return this.result;
  }
}

describe("candidate projection", () => {
  test("projects the Paris Fullstack golden profile deterministically and purpose-limited", () => {
    const first = normalizeCandidateProfile({
      event,
      snapshot: { profile: fixture.profile, user: fixture.user },
      projectedAt: "2026-07-21T08:01:00.000Z",
    });
    const reordered = normalizeCandidateProfile({
      event,
      snapshot: {
        profile: {
          ...fixture.profile,
          data: {
            ...fixture.profile.data,
            skills: ["Node.js", "React", "TypeScript"],
            skill_ids: ["node", "typescript", "react"],
          },
        },
        user: fixture.user,
      },
      projectedAt: "2026-07-21T08:01:00.000Z",
    });
    expect(first).toEqual(reordered);
    expect(first).toMatchObject({
      candidateId: "candidate-paris",
      version: "42",
      status: "active",
      targetRoleLabelNormalized: "developpeur full stack",
      targetRoleLabelsNormalized: ["developpeur full stack", "frontend engineer"],
      roleFamilyIds: ["software-engineering"],
      sectorIds: ["software-engineering"],
      industryIds: ["health-tech"],
      romeCodes: ["M1805"],
      skillIds: ["node", "react", "typescript"],
      skillTerms: ["node js", "react", "typescript"],
      contractTypes: ["permanent"],
      workModes: ["hybrid", "remote"],
      originLatitude: 48.8566,
      originLongitude: 2.3522,
      radiusKm: 52,
      countryCodes: ["FR"],
      salaryFloor: 50000,
      currency: "EUR",
    });
    expect(first).not.toHaveProperty("cv_text");
    expect(first).not.toHaveProperty("email");
  });

  test("minimizes a consent-paused profile and routes through atomic pause purge", async () => {
    const pausedUser = { ...fixture.user, data: { candidate_matching_consent: false } };
    const profile = normalizeCandidateProfile({
      event,
      snapshot: { profile: fixture.profile, user: pausedUser },
      projectedAt: "2026-07-21T08:01:00.000Z",
    });
    expect(profile).toMatchObject({
      status: "paused",
      targetRoleLabelNormalized: null,
      skillIds: [],
      countryCodes: [],
      salaryFloor: null,
    });
    const source = new FakeSource([event], { profile: fixture.profile, user: pausedUser });
    const store = new FakeStore();
    const result = await new CandidateProjector(source, store).runBatch(10, 30);
    expect(store.calls).toEqual(["pause-and-purge"]);
    expect(source.acknowledgements).toEqual([event.eventId]);
    expect(result).toMatchObject({ applied: 1, acknowledged: 1 });
  });

  test("maps only explicit swipe/application semantics and retires deletes", () => {
    const base = { ...event, eventFamily: "swipes" as const, entityId: "candidate-paris:job-1" };
    expect(normalizeCandidateAction({
      event: base,
      source: { job_id: "job-1", direction: "left" },
      canonicalGroupId: "22222222-2222-4222-8222-222222222222",
      projectedAt: event.occurredAt,
    }).kind).toBe("dismissed");
    expect(normalizeCandidateAction({
      event: { ...base, eventFamily: "applications" },
      source: { job_id: "job-1", status: "submitted" },
      canonicalGroupId: "22222222-2222-4222-8222-222222222222",
      projectedAt: event.occurredAt,
    }).kind).toBe("applied");
  });

  test("acknowledges a terminal missing action so it cannot block later projection events", async () => {
    const actionEvent = { ...event, eventFamily: "swipes" as const, entityId: "candidate-paris:job-1" };
    const source = new FakeSource(
      [actionEvent],
      { profile: fixture.profile, user: fixture.user },
      { job_id: "job-1", direction: "left" },
    );
    const store = new FakeStore();
    store.groupId = null;
    const result = await new CandidateProjector(source, store).runBatch(10, 30);
    expect(result).toMatchObject({ missing: 1, acknowledged: 1 });
    expect(source.acknowledgements).toEqual([actionEvent.eventId]);
  });

  test("acknowledges monotonic stale replays without rewriting", async () => {
    const source = new FakeSource([event], { profile: fixture.profile, user: fixture.user });
    const store = new FakeStore();
    store.result = "stale";
    const result = await new CandidateProjector(source, store).runBatch(10, 30);
    expect(result).toMatchObject({ stale: 1, acknowledged: 1 });
  });

  test("leaves the primary event unacknowledged when the inventory write fails", async () => {
    const source = new FakeSource([event], { profile: fixture.profile, user: fixture.user });
    const store = new FakeStore();
    store.applyProfile = async () => { throw new Error("inventory unavailable"); };
    await expect(new CandidateProjector(source, store).runBatch(10, 30)).rejects.toThrow(
      "inventory unavailable",
    );
    expect(source.acknowledgements).toEqual([]);
  });
});
