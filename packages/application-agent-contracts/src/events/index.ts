import { defineEvent, EventRegistry } from "@lssm-tech/lib.contracts-spec/events";
import { z } from "zod";
import { contractSchema } from "../schema-models";
import { isoTimestamp, opaqueId, safeReasonCode, safeRef, sha256 } from "../models/common";
const meta = (key: string, description: string) => ({
  key,
  version: "1.0.0",
  description,
  stability: "experimental" as const,
  owners: ["hirly.application-agent"],
  tags: ["application-agent"],
});
const safeEventPayload = z
  .object({
    eventId: opaqueId("event"),
    subjectRef: safeRef,
    jobSnapshotFingerprint: sha256.optional(),
    draftId: opaqueId("draft").optional(),
    planId: opaqueId("submission_plan").optional(),
    attemptId: opaqueId("attempt").optional(),
    receiptId: opaqueId("attempt").optional(),
    reasonCodes: z.array(safeReasonCode).optional(),
    safeEvidenceRefs: z.array(safeRef).optional(),
    occurredAt: isoTimestamp,
  })
  .strict();
const payload = contractSchema(safeEventPayload, "ApplicationAgentSafeEventPayload");
export const applicationPreparedEvent = defineEvent({
  meta: meta("hirlyApplication.prepared", "A grounded draft was prepared."),
  payload,
});
export const applicationBlockedEvent = defineEvent({
  meta: meta("hirlyApplication.blocked", "An application flow was blocked safely."),
  payload,
});
export const submissionPlanFrozenEvent = defineEvent({
  meta: meta("hirlyApplication.planFrozen", "An immutable submission plan was frozen."),
  payload,
});
export const submissionAttemptedEvent = defineEvent({
  meta: meta("hirlyApplication.submissionAttempted", "A controlled submission was attempted."),
  payload,
});
export const applicationSubmittedEvent = defineEvent({
  meta: meta("hirlyApplication.submitted", "Submission confirmation was observed."),
  payload,
});
export const submissionFailedEvent = defineEvent({
  meta: meta("hirlyApplication.submissionFailed", "A submission did not complete."),
  payload,
});
export const applicationOutcomeObservedEvent = defineEvent({
  meta: meta("hirlyApplication.outcomeObserved", "An outcome observation was recorded."),
  payload,
});
export const applicationAgentEvents = [
  applicationPreparedEvent,
  applicationBlockedEvent,
  submissionPlanFrozenEvent,
  submissionAttemptedEvent,
  applicationSubmittedEvent,
  submissionFailedEvent,
  applicationOutcomeObservedEvent,
] as const;
export const createApplicationAgentEventRegistry = () =>
  new EventRegistry([...applicationAgentEvents]);
