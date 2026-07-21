import { describe, expect, test } from "bun:test";
import fixture from "./fixtures/paris-fullstack-shadow.json";
import {
  SHADOW_CANARY_EVIDENCE_VERSION,
  executeFrozenShadowCanary,
  type FrozenShadowCanaryInput,
  type InjectedBreach,
} from "../src/exercise";

const input = fixture as FrozenShadowCanaryInput;

function run(execute: boolean, injectedBreach: InjectedBreach = "none") {
  const exposed = [] as unknown[];
  const evidence = executeFrozenShadowCanary(input, {
    exposeLegacy(response) {
      exposed.push(response);
    },
  }, { execute, injectedBreach });
  return { evidence, exposed };
}

describe("G008 frozen shadow-canary exercise", () => {
  test("keeps rollout disabled by default and exposes exactly one legacy response", () => {
    const { evidence, exposed } = run(false);
    expect(evidence.schemaVersion).toBe(SHADOW_CANARY_EVIDENCE_VERSION);
    expect(evidence.executionMode).toBe("disabled");
    expect(evidence.decision).toMatchObject({
      shadowExecuted: false,
      canaryAuthorized: false,
      automaticRollback: false,
      rollbackReason: "ROLLBACK_REQUESTED",
    });
    expect(exposed).toEqual([input.legacy]);
    expect(evidence.sideEffects).toEqual({
      visibleLegacyResponses: 1,
      visibleOnlineV2Responses: 0,
      canonicalWrites: 0,
      jobWrites: 0,
      providerWrites: 0,
      taskEnqueues: 0,
    });
  });

  test("executes the paid/FR/fullstack Paris 52km staged decision from frozen results", () => {
    const { evidence } = run(true);
    expect(evidence.scope).toEqual({
      cohort: "paid",
      countryCode: "FR",
      roleFamilyId: "fullstack",
      city: "Paris",
      radiusKm: 52,
    });
    expect(evidence.stages.every((stage) => stage.passed)).toBe(true);
    expect(evidence.metrics).toMatchObject({
      eligibleSetParity: 1,
      latencyDeltaMs: 4,
      freshVisibleCanonicalGroups: 16,
      legacyErrorRate: 0.001,
      onlineV2ErrorRate: 0.002,
      queryPlanReady: true,
    });
    expect(evidence.decision).toMatchObject({
      canaryAuthorizedBeforeThresholds: true,
      canaryAuthorized: false,
      automaticRollback: false,
      rollbackReason: "OBSERVATION_ONLY",
    });
  });

  for (const [breach, reason] of [
    ["parity", "PARITY_THRESHOLD_BREACH"],
    ["latency", "LATENCY_THRESHOLD_BREACH"],
    ["supply", "SUPPLY_GATE_FAILED:paris-52km-fullstack"],
    ["error", "ERROR_THRESHOLD_BREACH"],
  ] as const) {
    test(`fails closed and automatically rolls back an injected ${breach} breach`, () => {
      const { evidence, exposed } = run(true, breach);
      expect(evidence.decision.canaryAuthorized).toBe(false);
      expect(evidence.decision.automaticRollback).toBe(true);
      expect(evidence.decision.rollbackReason).toBe(reason);
      expect(exposed).toEqual([input.legacy]);
      expect(evidence.sideEffects.canonicalWrites).toBe(0);
      expect(evidence.sideEffects.jobWrites).toBe(0);
      expect(evidence.sideEffects.providerWrites).toBe(0);
    });
  }

  test("emits byte-stable evidence for the same frozen execution", () => {
    const first = run(true, "latency").evidence;
    const second = run(true, "latency").evidence;
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.evidenceDigest).toHaveLength(64);
  });
});
