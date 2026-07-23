/**
 * Deployable entrypoint: wraps the MCP server in an HTTP transport (CMA's
 * mcp_servers[] needs a URL, not a local stdio process) and adds a small
 * /approvals endpoint so a real approval receipt (issued by approve-cli.ts,
 * or eventually Hirly's real host-app UI) can actually reach this server —
 * closing the toolApprovalReceipt-returns-undefined gap from earlier.
 *
 * Receipt flow: approve-cli.ts (or the future real host app) POSTs
 * {receipt, submitArgs} to /approvals after a real human approval. This
 * server re-derives the input digest from submitArgs itself (never trusts
 * the caller's claimed digest) and only stores the receipt if it matches —
 * then toolApprovalReceipt looks it up by digest when the agent calls submit.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { PromptRegistry } from '@lssm-tech/lib.contracts-spec/promptRegistry';
import { ResourceRegistry } from '@lssm-tech/lib.contracts-spec/resources';
import { createMcpServer } from '@lssm-tech/lib.contracts-runtime-server-mcp/mcp/createMcpServer';
import type { McpCtxFactories } from '@lssm-tech/lib.contracts-runtime-server-mcp/mcp/mcpTypes';
import type { OperationApprovalReceipt } from '@lssm-tech/lib.contracts-spec/operations/approval';
import { operationApprovalInputDigest } from './local-approval-runtime.js';
import { buildApprovalRuntime, buildRegistry } from './runtime.js';

const receiptStore = new Map<string, OperationApprovalReceipt>();

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function handleApprovals(req: IncomingMessage, res: ServerResponse) {
  try {
    const raw = await readBody(req);
    const { receipt, submitArgs } = JSON.parse(raw) as {
      receipt: OperationApprovalReceipt;
      submitArgs: unknown;
    };
    const realDigest = await operationApprovalInputDigest(submitArgs);
    if (receipt.inputDigest !== realDigest) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'digest_mismatch', expected: realDigest, got: receipt.inputDigest }));
      return;
    }
    receiptStore.set(realDigest, receipt);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ stored: true, digest: realDigest }));
  } catch (err) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: String(err) }));
  }
}

// Built once — real, persistent application state (operation handlers, approval
// nonce store, issued receipts) that must survive across requests.
const ops = buildRegistry();
const prompts = new PromptRegistry();
const resources = new ResourceRegistry();
const { approvalPort } = buildApprovalRuntime();

/**
 * A fresh McpServer + StreamableHTTPServerTransport PER REQUEST. This is
 * deliberate, not incidental: in stateless mode (sessionIdGenerator:
 * undefined), the SDK's server/transport pair is not designed to survive a
 * second `initialize` call on the same instance — reusing one across
 * requests broke the entire server (a genuine bug found and fixed during
 * this build: after one `initialize` too many, even unrelated calls like
 * `tools/list` started failing on the shared instance until the process was
 * restarted). The registry/approval state above is what actually needs to
 * persist; the protocol-level server object does not.
 */
async function buildMcpTransport(): Promise<StreamableHTTPServerTransport> {
  const mcpServer = new McpServer({ name: 'hirly-evidence-backed-application', version: '1.0.0' });
  const ctxFactories: McpCtxFactories = {
    logger: {
      info: console.log,
      warn: console.warn,
      error: console.error,
      debug: console.debug,
    } as McpCtxFactories['logger'],
    toolCtx: () => ({ userId: 'candidate-review', approvalPort }),
    // Real lookup now, not a stub: matches the tool call's own args against a
    // receipt a human approval actually POSTed to /approvals for that exact digest.
    toolApprovalReceipt: async (args): Promise<OperationApprovalReceipt | undefined> => {
      const digest = await operationApprovalInputDigest(args);
      return receiptStore.get(digest);
    },
    promptCtx: () => ({}),
    resourceCtx: () => ({}),
  };
  createMcpServer(mcpServer, ops, resources, prompts, ctxFactories);

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await mcpServer.connect(transport);
  return transport;
}

async function main() {
  const httpServer = createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.url === '/approvals' && req.method === 'POST') {
      await handleApprovals(req, res);
      return;
    }
    if (req.url === '/mcp') {
      const transport = await buildMcpTransport();
      await transport.handleRequest(req, res);
      transport.close();
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  const port = Number(process.env.PORT ?? 8080);
  httpServer.listen(port, () => {
    console.log(`hirly-evidence-backed-application HTTP+MCP server listening on :${port}`);
    console.log(`  MCP endpoint:      POST /mcp`);
    console.log(`  Approval intake:   POST /approvals`);
    console.log(`  Health check:      GET  /health`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
