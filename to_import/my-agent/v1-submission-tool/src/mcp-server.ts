import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { PromptRegistry } from '@lssm-tech/lib.contracts-spec/promptRegistry';
import { ResourceRegistry } from '@lssm-tech/lib.contracts-spec/resources';
import { createMcpServer } from '@lssm-tech/lib.contracts-runtime-server-mcp/mcp/createMcpServer';
import type { McpCtxFactories } from '@lssm-tech/lib.contracts-runtime-server-mcp/mcp/mcpTypes';
import type { OperationApprovalReceipt } from '@lssm-tech/lib.contracts-spec/operations/approval';
import { buildApprovalRuntime, buildRegistry } from './runtime.js';

/**
 * Exposes the 5 hirlyApplication operations as MCP tools so the CMA agent
 * (or Hirly's host app) can call them directly. The approval receipt is
 * pulled from MCP client-supplied approval evidence via toolApprovalReceipt
 * — never from the tool's own arguments — so the agent cannot manufacture
 * its own approval by just filling in a JSON field.
 */
async function main() {
  const ops = buildRegistry();
  const prompts = new PromptRegistry();
  const resources = new ResourceRegistry();
  const { approvalPort } = buildApprovalRuntime();

  const server = new McpServer({ name: 'hirly-evidence-backed-application', version: '1.0.0' });

  const ctxFactories: McpCtxFactories = {
    logger: {
      info: console.log,
      warn: console.warn,
      error: console.error,
      debug: console.debug,
    } as McpCtxFactories['logger'],
    toolCtx: () => ({ userId: 'candidate-review', approvalPort }),
    // In production this reads the approval receipt attached to the MCP call by the
    // Hirly host app (out-of-band from tool input) after the candidate has approved
    // the exact frozen submission plan. Wiring that transport-level extraction is a
    // NEXT-DIRECTIONS item — see NEXT-DIRECTIONS.md v1 note on the host app's role.
    toolApprovalReceipt: async (): Promise<OperationApprovalReceipt | undefined> => undefined,
    promptCtx: () => ({}),
    resourceCtx: () => ({}),
  };

  createMcpServer(server, ops, resources, prompts, ctxFactories);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('hirly-evidence-backed-application MCP server running on stdio');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
