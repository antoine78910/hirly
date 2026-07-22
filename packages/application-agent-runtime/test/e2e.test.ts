import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createApplicationAgentEventRegistry, fixtureEvidenceItems, fixtureEvidenceSnapshot, fixtureJobSnapshot } from '@hirly/application-agent-contracts';
import type { ApplicationDraft, ApplicationSubmissionPlan, JobSnapshot } from '@hirly/application-agent-contracts';
import { assertFixtureOnlyMode, createApprovalPort, createApplicationAgentMcpServer, createApplicationAgentOperationRegistry, createCandidateMcpOperationRegistry, controlledAtsSimulator, createGuardedEventPublisher, fixtureAdapterRegistry, fixtureJobReader, incrementalIds, memoryEvidenceStore, fixtureModel, memoryIdempotencyStore, memoryOutbox, memoryReceiptStore, memoryReviewStore, memorySafeLogger, memoryNonceStore, memoryStore, sha256Hasher } from '../src';
import type { RuntimeDependencies } from '../src/registry';

const now = new Date('2026-01-01T00:00:00.000Z');
const clock = { now: () => now };
test('fails closed before submit handler, then submits once with exact approval and rejects replay', async () => {
  const job = { ...fixtureJobSnapshot, questions: [] };
  const simulator = controlledAtsSimulator();
  let approvalPort: ReturnType<typeof createApprovalPort> | undefined;
  const registry = createApplicationAgentOperationRegistry({ evidence: memoryEvidenceStore(fixtureEvidenceSnapshot, fixtureEvidenceItems), jobs: memoryStore(), drafts: memoryStore(), plans: memoryStore(), receipts: memoryReceiptStore(), reader: fixtureJobReader(job), model: fixtureModel, verifier: { async verify() { return { supports: [], blockedReasonCodes: [] }; } }, adapters: fixtureAdapterRegistry(simulator), idempotency: memoryIdempotencyStore(), clock, ids: incrementalIds(), hasher: sha256Hasher, logger: memorySafeLogger(), outbox: memoryOutbox(), approvalPort: () => approvalPort });
  const ctx = { userId: 'candidate-a', tenantId: 'tenant-a', eventSpecResolver: createApplicationAgentEventRegistry() };
  const analyzed: any = await registry.execute('hirlyJob.analyze', '1.0.0', { fixtureId: 'fixture_job-a' }, ctx);
  const prepared: any = await registry.execute('hirlyApplication.prepare', '1.0.0', { candidateEvidenceSnapshotId: fixtureEvidenceSnapshot.id, jobSnapshotId: analyzed.data.id }, ctx);
  const frozen: any = await registry.execute('hirlyApplication.freeze', '1.0.0', { draftId: prepared.data.id, targetOrigin: job.origin, adapterKey: 'fixture-ats', adapterVersion: '1.0.0' }, ctx);
  const input = { planId: frozen.data.id, planDigest: frozen.data.planDigest, targetOrigin: frozen.data.targetOrigin, adapterKey: frozen.data.adapterKey, adapterVersion: frozen.data.adapterVersion, idempotencyKey: frozen.data.idempotencyKey };
  const denied: any = await registry.executeResult('hirlyApplication.submit', '1.0.0', input, ctx);
  expect(JSON.stringify(denied)).toContain('APPROVAL_REQUIRED');
  expect(simulator.mutations).toBe(0);
  const reviewRef = 'review:fixture-approval';
  const receipt = { id: 'approval_fixture-a', subject: { userId: 'candidate-a', tenantId: 'tenant-a' }, operation: { key: 'hirlyApplication.submit', version: '1.0.0' }, inputDigest: sha256Hasher.digest(input), effects: ['write', 'external-side-effect'] as const, issuedAt: '2025-12-31T23:00:00.000Z', expiresAt: '2026-01-01T01:00:00.000Z', nonce: 'nonce_fixture-a', issuer: 'fixture-review', evidenceRef: reviewRef };
  approvalPort = createApprovalPort({ reviews: memoryReviewStore([{ ref: reviewRef, status: 'approved', subject: { userId: 'candidate-a', tenantId: 'tenant-a' }, planDigest: input.planDigest, targetOrigin: input.targetOrigin, adapterVersion: input.adapterVersion, issuedAt: '2025-12-31T23:00:00.000Z', expiresAt: '2026-01-01T01:00:00.000Z' }]), nonces: memoryNonceStore(), clock, hasher: sha256Hasher });
  const submitted: any = await registry.execute('hirlyApplication.submit', '1.0.0', input, { ...ctx, approvalReceipt: receipt, approvalPort });
  expect(submitted.data.status).toBe('submitted'); expect(simulator.mutations).toBe(1); expect(submitted.data.safeEvidenceRefs).toEqual(['receipt:fixture-confirmation']);
  const replay: any = await registry.executeResult('hirlyApplication.submit', '1.0.0', input, { ...ctx, approvalReceipt: receipt, approvalPort });
  expect(JSON.stringify(replay)).toContain('APPROVAL_REQUIRED'); expect(simulator.mutations).toBe(1);
});

test('draft preparation uses the model port and freeze uses the verifier port', async () => {
  let modelCalls = 0; let verifierCalls = 0;
  const job = { ...fixtureJobSnapshot, questions: [] };
  const registry = createApplicationAgentOperationRegistry({ evidence: memoryEvidenceStore(fixtureEvidenceSnapshot, fixtureEvidenceItems), jobs: memoryStore([job]), drafts: memoryStore(), plans: memoryStore(), receipts: memoryReceiptStore(), reader: fixtureJobReader(job), model: { async createDraft(args) { modelCalls++; return { ...await fixtureModel.createDraft(args), id: 'draft_fixture-port' }; } }, verifier: { async verify() { verifierCalls++; return { supports: [], blockedReasonCodes: [] }; } }, adapters: fixtureAdapterRegistry(controlledAtsSimulator()), idempotency: memoryIdempotencyStore(), clock, ids: incrementalIds(), hasher: sha256Hasher, logger: memorySafeLogger(), outbox: memoryOutbox() });
  const ctx = { userId: 'candidate-a', eventSpecResolver: (await import('@hirly/application-agent-contracts')).createApplicationAgentEventRegistry() };
  const draft: any = await registry.execute('hirlyApplication.prepare', '1.0.0', { candidateEvidenceSnapshotId: fixtureEvidenceSnapshot.id, jobSnapshotId: job.id }, ctx);
  await registry.execute('hirlyApplication.freeze', '1.0.0', { draftId: draft.data.id, targetOrigin: job.origin, adapterKey: 'fixture-ats', adapterVersion: '1.0.0' }, ctx);
  expect(modelCalls).toBe(1); expect(verifierCalls).toBe(1);
});

test('verification resolves persisted candidate evidence after runtime reconstruction', async () => {
  const job = { ...fixtureJobSnapshot, questions: [] };
  const drafts = memoryStore<ApplicationDraft>();
  const dependencies = (verifier: any) => ({ evidence: memoryEvidenceStore(fixtureEvidenceSnapshot, fixtureEvidenceItems), jobs: memoryStore([job]), drafts, plans: memoryStore<ApplicationSubmissionPlan>(), receipts: memoryReceiptStore(), reader: fixtureJobReader(job), model: fixtureModel, verifier, adapters: fixtureAdapterRegistry(controlledAtsSimulator()), idempotency: memoryIdempotencyStore(), clock, ids: incrementalIds(), hasher: sha256Hasher, logger: memorySafeLogger(), outbox: memoryOutbox() });
  const ctx = { userId: 'candidate-a', eventSpecResolver: createApplicationAgentEventRegistry() };
  const prepared: any = await createApplicationAgentOperationRegistry(dependencies({ async verify() { return { supports: [], blockedReasonCodes: [] }; } })).execute('hirlyApplication.prepare', '1.0.0', { candidateEvidenceSnapshotId: fixtureEvidenceSnapshot.id, jobSnapshotId: job.id }, ctx);
  let verifiedEvidenceIds: string[] = [];
  const reconstructed = createApplicationAgentOperationRegistry(dependencies({ async verify(_draft: any, evidence: any[]) { verifiedEvidenceIds = evidence.map((item) => item.id); return { supports: [], blockedReasonCodes: [] }; } }));
  await reconstructed.execute('hirlyApplication.verify', '1.0.0', { draftId: prepared.data.id }, ctx);
  expect(prepared.data.candidateEvidenceSnapshotId).toBe(fixtureEvidenceSnapshot.id);
  expect(verifiedEvidenceIds).toEqual(fixtureEvidenceSnapshot.evidenceItemIds);
});

test('production composition is rejected until durable adapters are explicitly added', () => {
  expect(() => assertFixtureOnlyMode('production')).toThrow('PRODUCTION_COMPOSITION_UNAVAILABLE');
  expect(() => assertFixtureOnlyMode('fixture')).not.toThrow();
});

test('operation registry rejects a production composition request before binding handlers', () => {
  const job = { ...fixtureJobSnapshot, questions: [] };
  const deps: RuntimeDependencies = { evidence: memoryEvidenceStore(fixtureEvidenceSnapshot, fixtureEvidenceItems), jobs: memoryStore(), drafts: memoryStore(), plans: memoryStore(), receipts: memoryReceiptStore(), reader: fixtureJobReader(job), model: fixtureModel, verifier: { async verify() { return { supports: [], blockedReasonCodes: [] }; } }, adapters: fixtureAdapterRegistry(controlledAtsSimulator()), idempotency: memoryIdempotencyStore(), clock, ids: incrementalIds(), hasher: sha256Hasher, logger: memorySafeLogger(), outbox: memoryOutbox() };
  expect(() => createApplicationAgentOperationRegistry(deps, 'production')).toThrow('PRODUCTION_COMPOSITION_UNAVAILABLE');
});

test('approval port rejects wrong subject, canonical input, and review evidence before a handler can run', async () => {
  const input = { planId: 'submission_plan_fixture-a', planDigest: sha256Hasher.digest({ plan: 1 }), targetOrigin: 'https://jobs.fixture.example', adapterKey: 'fixture-ats', adapterVersion: '1.0.0', idempotencyKey: 'idem_fixture_12345678' };
  const review = { ref: 'review:fixture-approval', status: 'approved' as const, subject: { userId: 'candidate-a' }, planDigest: input.planDigest, targetOrigin: input.targetOrigin, adapterVersion: input.adapterVersion, issuedAt: '2025-12-31T23:00:00.000Z', expiresAt: '2026-01-01T01:00:00.000Z' };
  const port = createApprovalPort({ reviews: memoryReviewStore([review]), nonces: memoryNonceStore(), clock, hasher: sha256Hasher });
  const receipt = { id: 'approval_fixture-a', subject: { userId: 'candidate-a' }, operation: { key: 'hirlyApplication.submit', version: '1.0.0' }, inputDigest: sha256Hasher.digest(input), effects: ['write', 'external-side-effect'] as const, issuedAt: '2025-12-31T23:00:00.000Z', expiresAt: '2026-01-01T01:00:00.000Z', nonce: 'nonce_fixture-b', issuer: 'fixture', evidenceRef: review.ref };
  const request: any = { receipt, operation: receipt.operation, subject: receipt.subject, input, requiredEffects: receipt.effects };
  expect((await port.authorize({ ...request, subject: { userId: 'other' } })).effect).toBe('deny');
  expect((await port.authorize({ ...request, input: { ...input, targetOrigin: 'https://wrong.example' } })).effect).toBe('deny');
  expect((await createApprovalPort({ reviews: memoryReviewStore([]), nonces: memoryNonceStore(), clock, hasher: sha256Hasher }).authorize(request)).effect).toBe('deny');
  expect((await createApprovalPort({ reviews: memoryReviewStore([{ ...review, status: 'rejected' as any }]), nonces: memoryNonceStore(), clock, hasher: sha256Hasher }).authorize(request)).effect).toBe('deny');
  expect((await createApprovalPort({ reviews: memoryReviewStore([{ ...review, expiresAt: '2025-12-31T23:59:59.000Z' }]), nonces: memoryNonceStore(), clock, hasher: sha256Hasher }).authorize(request)).effect).toBe('deny');
});

test('approval digest is characterized against the installed runtime-core serializer without declaring it as a dependency', async () => {
  const install = readdirSync(join(process.cwd(), '../../node_modules/.bun')).find((entry) => entry.startsWith('@lssm-tech+lib.contracts-runtime-core@'));
  expect(install).toBeDefined();
  const runtimeCore: any = await import(pathToFileURL(join(process.cwd(), '../../node_modules/.bun', install!, 'node_modules/@lssm-tech/lib.contracts-runtime-core/dist/approval.js')).href);
  const input = { z: [{ beta: true, alpha: new Date('2026-01-01T00:00:00.000Z') }], a: undefined, b: { z: 1, a: 'x' } };
  expect(sha256Hasher.digest(input)).toBe(await runtimeCore.operationApprovalInputDigest(input));
});

test('runtime event publisher rejects undeclared and malformed events before publishing', async () => {
  const outbox = memoryOutbox();
  const publisher = createGuardedEventPublisher(outbox);
  await expect(publisher.publish('hirlyApplication.unknown', '1.0.0', {})).rejects.toThrow('UNDECLARED_APPLICATION_AGENT_EVENT');
  await expect(publisher.publish('hirlyApplication.prepared', '1.0.0', { eventId: 'event_fixture-a' })).rejects.toThrow('MALFORMED_APPLICATION_AGENT_EVENT');
  await publisher.publish('hirlyApplication.prepared', '1.0.0', { eventId: 'event_fixture-a', subjectRef: 'candidate:fixture-a', occurredAt: now.toISOString() });
  expect(outbox.events).toHaveLength(1);
});

test('submit reloads persisted plan sources and blocks changed job snapshots before mutation', async () => {
  const job = { ...fixtureJobSnapshot, questions: [] };
  const jobs = memoryStore([job]); const drafts = memoryStore<ApplicationDraft>(); const plans = memoryStore<ApplicationSubmissionPlan>(); const simulator = controlledAtsSimulator();
  let approvalPort: ReturnType<typeof createApprovalPort> | undefined;
  const registry = createApplicationAgentOperationRegistry({ evidence: memoryEvidenceStore(fixtureEvidenceSnapshot, fixtureEvidenceItems), jobs, drafts, plans, receipts: memoryReceiptStore(), reader: fixtureJobReader(job), model: fixtureModel, verifier: { async verify() { return { supports: [], blockedReasonCodes: [] }; } }, adapters: fixtureAdapterRegistry(simulator), idempotency: memoryIdempotencyStore(), clock, ids: incrementalIds(), hasher: sha256Hasher, logger: memorySafeLogger(), outbox: memoryOutbox(), approvalPort: () => approvalPort });
  const ctx = { userId: 'candidate-a' };
  const prepared: any = await registry.execute('hirlyApplication.prepare', '1.0.0', { candidateEvidenceSnapshotId: fixtureEvidenceSnapshot.id, jobSnapshotId: job.id }, ctx);
  const frozen: any = await registry.execute('hirlyApplication.freeze', '1.0.0', { draftId: prepared.data.id, targetOrigin: job.origin, adapterKey: 'fixture-ats', adapterVersion: '1.0.0' }, ctx);
  const input = { planId: frozen.data.id, planDigest: frozen.data.planDigest, targetOrigin: frozen.data.targetOrigin, adapterKey: frozen.data.adapterKey, adapterVersion: frozen.data.adapterVersion, idempotencyKey: frozen.data.idempotencyKey };
  await jobs.put({ ...job, sourceFingerprint: sha256Hasher.digest({ changed: true }) });
  const reviewRef = 'review:stale-plan';
  const receipt = { id: 'approval_stale-a', subject: { userId: 'candidate-a' }, operation: { key: 'hirlyApplication.submit', version: '1.0.0' }, inputDigest: sha256Hasher.digest(input), effects: ['write', 'external-side-effect'] as const, issuedAt: '2025-12-31T23:00:00.000Z', expiresAt: '2026-01-01T01:00:00.000Z', nonce: 'nonce_stale-a', issuer: 'fixture', evidenceRef: reviewRef };
  approvalPort = createApprovalPort({ reviews: memoryReviewStore([{ ref: reviewRef, status: 'approved', subject: receipt.subject, planDigest: input.planDigest, targetOrigin: input.targetOrigin, adapterVersion: input.adapterVersion, issuedAt: receipt.issuedAt, expiresAt: receipt.expiresAt }]), nonces: memoryNonceStore(), clock, hasher: sha256Hasher });
  const result: any = await registry.executeResult('hirlyApplication.submit', '1.0.0', input, { ...ctx, approvalReceipt: receipt, approvalPort });
  expect(JSON.stringify(result)).toContain('STALE_SUBMISSION_PLAN');
  expect(simulator.mutations).toBe(0);
});

test('safe logger redacts raw candidate and form content', () => {
  const logger = memorySafeLogger();
  logger.info('fixture', { candidateName: 'Ada Example', rawCv: 'private CV', formPayload: 'private answer', safeRef: 'receipt:fixture' });
  const line = JSON.stringify(logger.records[0]);
  expect(line).not.toContain('Ada Example');
  expect(line).not.toContain('private CV');
  expect(line).not.toContain('private answer');
  expect(line).toContain('receipt:fixture');
});

test('candidate MCP allowlist excludes server-only outcome observation', () => {
  const job = { ...fixtureJobSnapshot, questions: [] };
  const registry = createCandidateMcpOperationRegistry({ evidence: memoryEvidenceStore(fixtureEvidenceSnapshot, fixtureEvidenceItems), jobs: memoryStore(), drafts: memoryStore(), plans: memoryStore(), receipts: memoryReceiptStore(), reader: fixtureJobReader(job), model: fixtureModel, verifier: { async verify() { return { supports: [], blockedReasonCodes: [] }; } }, adapters: fixtureAdapterRegistry(controlledAtsSimulator()), idempotency: memoryIdempotencyStore(), clock, ids: incrementalIds(), hasher: sha256Hasher, logger: memorySafeLogger(), outbox: memoryOutbox() });
  expect(registry.list().map((spec) => spec.meta.key)).toEqual(['hirlyJob.analyze', 'hirlyApplication.prepare', 'hirlyApplication.verify', 'hirlyApplication.freeze', 'hirlyApplication.submit']);
});

test('MCP candidate tools use host identity and host-only approval receipts', async () => {
  const job = { ...fixtureJobSnapshot, questions: [] };
  const simulator = controlledAtsSimulator();
  let receipt: any;
  let approvalPort = createApprovalPort({ reviews: memoryReviewStore([]), nonces: memoryNonceStore(), clock, hasher: sha256Hasher });
  const deps: RuntimeDependencies = { evidence: memoryEvidenceStore(fixtureEvidenceSnapshot, fixtureEvidenceItems), jobs: memoryStore<JobSnapshot>(), drafts: memoryStore<ApplicationDraft>(), plans: memoryStore<ApplicationSubmissionPlan>(), receipts: memoryReceiptStore(), reader: fixtureJobReader(job), model: fixtureModel, verifier: { async verify() { return { supports: [], blockedReasonCodes: [] }; } }, adapters: fixtureAdapterRegistry(simulator), idempotency: memoryIdempotencyStore(), clock, ids: incrementalIds(), hasher: sha256Hasher, logger: memorySafeLogger(), outbox: memoryOutbox(), approvalPort: () => approvalPort };
  const server = createApplicationAgentMcpServer(deps, {
    context: () => ({ userId: 'candidate-a', tenantId: 'tenant-a', eventSpecResolver: createApplicationAgentEventRegistry(), approvalPort }),
    approvalReceipt: async () => receipt,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'application-agent-runtime-test', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const tools = await client.listTools();
  const operationNames = new Map(tools.tools.map((tool) => [(tool._meta as any)?.contractspec?.operationKey, tool.name]));
  expect([...operationNames.keys()]).toEqual(['hirlyJob.analyze', 'hirlyApplication.prepare', 'hirlyApplication.verify', 'hirlyApplication.freeze', 'hirlyApplication.submit']);
  expect(operationNames.has('hirlyApplication.observeOutcome')).toBe(false);
  const submitTool = tools.tools.find((tool) => (tool._meta as any)?.contractspec?.operationKey === 'hirlyApplication.submit');
  expect((submitTool?._meta as any)?.contractspec).toMatchObject({ approvalRequired: true, effects: ['write', 'external-side-effect'] });
  expect(submitTool?.inputSchema.properties).not.toHaveProperty('approvalReceipt');

  const call = async (operation: string, arguments_: Record<string, unknown>) => client.callTool({ name: operationNames.get(operation)!, arguments: arguments_ }) as Promise<any>;
  const contractData = (result: any) => result.structuredContent.data.data;
  const analyzed = await call('hirlyJob.analyze', { fixtureId: 'fixture_job-a' });
  const prepared = await call('hirlyApplication.prepare', { candidateEvidenceSnapshotId: fixtureEvidenceSnapshot.id, jobSnapshotId: contractData(analyzed).id });
  const frozen = await call('hirlyApplication.freeze', { draftId: contractData(prepared).id, targetOrigin: job.origin, adapterKey: 'fixture-ats', adapterVersion: '1.0.0' });
  const input = { planId: contractData(frozen).id, planDigest: contractData(frozen).planDigest, targetOrigin: contractData(frozen).targetOrigin, adapterKey: contractData(frozen).adapterKey, adapterVersion: contractData(frozen).adapterVersion, idempotencyKey: contractData(frozen).idempotencyKey };

  const denied = await call('hirlyApplication.submit', input);
  expect(denied.isError).toBe(true);
  expect(denied.structuredContent).toMatchObject({ ok: false, code: 'APPROVAL_REQUIRED' });
  expect(simulator.mutations).toBe(0);

  const reviewRef = 'review:mcp-approval';
  receipt = { id: 'approval_mcp-a', subject: { userId: 'candidate-a', tenantId: 'tenant-a' }, operation: { key: 'hirlyApplication.submit', version: '1.0.0' }, inputDigest: sha256Hasher.digest(input), effects: ['write', 'external-side-effect'] as const, issuedAt: '2025-12-31T23:00:00.000Z', expiresAt: '2026-01-01T01:00:00.000Z', nonce: 'nonce_mcp-a', issuer: 'fixture-review', evidenceRef: reviewRef };
  approvalPort = createApprovalPort({ reviews: memoryReviewStore([{ ref: reviewRef, status: 'approved', subject: receipt.subject, planDigest: input.planDigest, targetOrigin: input.targetOrigin, adapterVersion: input.adapterVersion, issuedAt: '2025-12-31T23:00:00.000Z', expiresAt: '2026-01-01T01:00:00.000Z' }]), nonces: memoryNonceStore(), clock, hasher: sha256Hasher });
  // The host controls both identity and receipt; the client sends only ContractSpec input.
  const submitted = await call('hirlyApplication.submit', input);
  expect(contractData(submitted).status).toBe('submitted');
  expect(simulator.mutations).toBe(1);
  await client.close();
});
