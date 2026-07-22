import { createApplicationAgentEventRegistry, fixtureEvidenceItems, fixtureEvidenceSnapshot, fixtureJobSnapshot } from '@hirly/application-agent-contracts';
import { controlledAtsSimulator, fixtureAdapterRegistry, fixtureJobReader, memoryEvidenceStore, fixtureModel, memoryOutbox, memoryReceiptStore, memoryStore } from './fixtures';
import { incrementalIds, memoryIdempotencyStore, memorySafeLogger, sha256Hasher, systemClock } from './core';
import { createApplicationAgentOperationRegistry } from './registry';

const job = { ...fixtureJobSnapshot, questions: [] };
const registry = createApplicationAgentOperationRegistry({ evidence: memoryEvidenceStore(fixtureEvidenceSnapshot, fixtureEvidenceItems), jobs: memoryStore(), drafts: memoryStore(), plans: memoryStore(), receipts: memoryReceiptStore(), reader: fixtureJobReader(job), model: fixtureModel, verifier: { async verify() { return { supports: [], blockedReasonCodes: [] }; } }, adapters: fixtureAdapterRegistry(controlledAtsSimulator()), idempotency: memoryIdempotencyStore(), clock: systemClock, ids: incrementalIds(), hasher: sha256Hasher, logger: memorySafeLogger(), outbox: memoryOutbox() });
const result = await registry.executeResult('hirlyJob.analyze', '1.0.0', { fixtureId: 'fixture_job-a' }, { userId: 'candidate-a', eventSpecResolver: createApplicationAgentEventRegistry() });
console.log(JSON.stringify(result));
