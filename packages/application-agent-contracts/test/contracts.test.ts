import { describe, expect, test } from "bun:test";
import {
  ApplicationClaimSchema,
  applicationAgentOperations,
  createApplicationAgentEventRegistry,
  createApplicationAgentOperationSpecRegistry,
  evidenceBackedApplicationAgent,
  fixtureEvidenceItems,
  fixtureJobSnapshot,
  submitApplicationOperation,
} from "../src";
describe("application-agent contracts", () => {
  test("declares each operation once and only two key segments", () => {
    const r = createApplicationAgentOperationSpecRegistry();
    expect(r.list()).toHaveLength(6);
    expect(
      applicationAgentOperations.map((x) => x.meta.key).every((k) => k.split(".").length === 2),
    ).toBe(true);
  });
  test("submit is approval-gated with external effect", () => {
    expect(submitApplicationOperation.execution?.effects).toEqual([
      "write",
      "external-side-effect",
    ]);
    expect(submitApplicationOperation.execution?.approval?.required).toBe(true);
  });
  test("event registry has seven safe events", () =>
    expect(createApplicationAgentEventRegistry().list()).toHaveLength(7));
  test("agent omits outcome and requires submit approval", () => {
    expect(evidenceBackedApplicationAgent.tools).toHaveLength(5);
    expect(evidenceBackedApplicationAgent.tools.at(-1)?.requiresApproval).toBe(true);
  });
  test("fixture job remains schema-valid", () =>
    expect(fixtureJobSnapshot.origin).toBe("https://jobs.fixture.example"));
  test("draft claims retain only an evidence identifier, never classified statement content", () => {
    const evidence = fixtureEvidenceItems[0];
    const claim = {
      id: "claim_fixture-a",
      evidenceId: evidence.id,
      supportStatus: "supported" as const,
      verifierReasonCodes: [],
      confidence: 1,
    };
    expect(ApplicationClaimSchema.safeParse(claim).success).toBe(true);
    expect(
      ApplicationClaimSchema.safeParse({
        ...claim,
        evidenceStatement: evidence.atomicSupportedStatement,
      }).success,
    ).toBe(false);
    expect(
      ApplicationClaimSchema.safeParse({ ...claim, evidenceRef: evidence.sourceArtifactRef })
        .success,
    ).toBe(false);
  });
});
