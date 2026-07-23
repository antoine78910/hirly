/**
 * Sandbox ATS — a fake applicant-tracking-system endpoint to test the v1 submission
 * tool against before it ever points at a real ATS. Deliberately mimics the two
 * properties that make real submission dangerous to get wrong:
 *
 *  1. Submission and confirmation are SEPARATE calls. POST /applications only
 *     acknowledges receipt; the tool must call GET /applications/:id afterwards
 *     to independently observe the outcome — it may not treat the POST response
 *     alone as proof of success.
 *  2. Idempotency by nonce. Submitting the same nonce twice returns the SAME
 *     application record instead of creating a second one, so the tool's replay
 *     prevention has something real to be tested against.
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

type ApplicationStatus = 'received' | 'processing' | 'confirmed' | 'rejected';

interface ApplicationRecord {
  id: string;
  nonce: string;
  submissionPlanDigest: string;
  fields: Record<string, unknown>;
  status: ApplicationStatus;
  createdAt: string;
  confirmedAt: string | null;
}

const byNonce = new Map<string, ApplicationRecord>();
const byId = new Map<string, ApplicationRecord>();

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export function createSandboxAtsServer() {
  return createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json');

  if (req.method === 'POST' && req.url === '/applications') {
    const raw = await readBody(req);
    let body: { nonce?: string; submissionPlanDigest?: string; fields?: Record<string, unknown> };
    try {
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'invalid_json' }));
      return;
    }
    if (!body.nonce || !body.submissionPlanDigest) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'nonce and submissionPlanDigest are required' }));
      return;
    }

    // Idempotency: replaying the same nonce returns the existing record, never a new one.
    const existing = byNonce.get(body.nonce);
    if (existing) {
      res.writeHead(200);
      res.end(JSON.stringify({ id: existing.id, status: existing.status, replay: true }));
      return;
    }

    const record: ApplicationRecord = {
      id: `sandbox-app-${randomUUID()}`,
      nonce: body.nonce,
      submissionPlanDigest: body.submissionPlanDigest,
      fields: body.fields ?? {},
      status: 'received',
      createdAt: new Date().toISOString(),
      confirmedAt: null,
    };
    byNonce.set(body.nonce, record);
    byId.set(record.id, record);

    // Simulate async ATS processing — the caller cannot know the outcome from this
    // response alone and MUST poll /applications/:id to observe it independently.
    setTimeout(() => {
      record.status = 'confirmed';
      record.confirmedAt = new Date().toISOString();
    }, 1500);

    res.writeHead(202);
    res.end(JSON.stringify({ id: record.id, status: record.status, replay: false }));
    return;
  }

  if (req.method === 'GET' && req.url?.startsWith('/applications/')) {
    const id = req.url.split('/').pop();
    const record = id ? byId.get(id) : undefined;
    if (!record) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }
    res.writeHead(200);
    res.end(
      JSON.stringify({
        id: record.id,
        status: record.status,
        submissionPlanDigest: record.submissionPlanDigest,
        createdAt: record.createdAt,
        confirmedAt: record.confirmedAt,
      })
    );
    return;
  }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not_found' }));
  });
}

// Standalone entrypoint (npm run sandbox-ats) — only starts the server when
// this file is executed directly, not when imported by the e2e test.
if (import.meta.url === `file://${process.argv[1]}`) {
  const PORT = Number(process.env.SANDBOX_ATS_PORT ?? 4790);
  createSandboxAtsServer().listen(PORT, () => {
    console.log(`sandbox-ats listening on http://localhost:${PORT}`);
  });
}
