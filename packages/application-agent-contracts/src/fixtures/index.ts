import type { CandidateEvidenceItem, CandidateEvidenceSnapshot, JobSnapshot } from "../models";
export const fixtureEvidenceItems: CandidateEvidenceItem[] = [
  {
    id: "evidence_software-engineering",
    evidenceKind: "cv",
    atomicSupportedStatement: "Built TypeScript services.",
    sourceArtifactRef: "vault:fixture-cv",
    sourceArtifactVersion: "1",
    stableLocator: "experience[0]",
    sourceFingerprint: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    confidence: 0.98,
    reviewStatus: "reviewed",
    sensitivity: "restricted",
  },
];
export const fixtureEvidenceSnapshot: CandidateEvidenceSnapshot = {
  id: "evidence_snapshot_candidate-a",
  candidateSubjectRef: "candidate:fixture-a",
  evidenceItemIds: ["evidence_software-engineering"],
  snapshotFingerprint: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
  createdAt: "2026-01-01T00:00:00.000Z",
};
export const fixtureJobSnapshot: JobSnapshot = {
  id: "job_snapshot_fixture-a",
  canonicalSourceUrl: "https://jobs.fixture.exampleroles/1",
  origin: "https://jobs.fixture.example",
  sourceFingerprint: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
  capturedAt: "2026-01-01T00:00:00.000Z",
  roleTitle: "TypeScript Engineer",
  companyName: "Fixture Co",
  requirements: [
    {
      id: "requirement_typescript",
      text: "TypeScript experience",
      classification: "required",
      need: "evidence",
    },
  ],
  questions: [
    {
      id: "question_work_authorization",
      normalizedPrompt: "May we work?",
      classification: "work_authorization",
      candidateOnly: true,
      mandatory: true,
    },
  ],
  ats: { adapterKey: "fixture-ats", provider: "fixture" },
};
