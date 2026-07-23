import { OperationSpecRegistry } from "@lssm-tech/lib.contracts-spec/operations";
import { registerMcpTools } from "@lssm-tech/lib.contracts-runtime-server-mcp/mcp/registerTools";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  analyzeJobOperation,
  freezeApplicationOperation,
  prepareApplicationOperation,
  submitApplicationOperation,
  verifyApplicationOperation,
} from "@hirly/application-agent-contracts";
import type { HandlerCtx } from "@lssm-tech/lib.contracts-spec/types";
import type { OperationApprovalReceipt } from "@lssm-tech/lib.contracts-spec/operations";
import type { RuntimeDependencies } from "./registry";
import { createApplicationAgentOperationRegistry } from "./registry";

// biome-ignore lint/suspicious/noExplicitAny: Dynamic external contract boundaries are deliberately isolated behind this local alias.
type UnsafeValue = any;

/** The candidate MCP projection is an explicit five-operation allowlist. */
export const createCandidateMcpOperationRegistry = (deps: RuntimeDependencies) => {
  const bound = createApplicationAgentOperationRegistry(deps);
  const allowlist = new OperationSpecRegistry([
    analyzeJobOperation,
    prepareApplicationOperation,
    verifyApplicationOperation,
    freezeApplicationOperation,
    submitApplicationOperation,
  ]);
  for (const spec of allowlist.list()) {
    const handler = bound.getHandler(spec.meta.key, spec.meta.version);
    if (!handler) throw new Error(`missing bound handler for ${spec.meta.key}`);
    allowlist.bind(spec, handler as UnsafeValue);
  }
  return allowlist;
};

export const createApplicationAgentMcpServer = (
  deps: RuntimeDependencies,
  host: { context(): HandlerCtx; approvalReceipt(): Promise<OperationApprovalReceipt | undefined> },
) => {
  const server = new McpServer({ name: "hirly-application-agent-fixture", version: "0.1.0" });
  registerMcpTools(server, createCandidateMcpOperationRegistry(deps), {
    toolCtx: () => host.context(),
    approvalReceipt: async () => host.approvalReceipt(),
  });
  return server;
};

export const runStdioMcp = async (
  deps: RuntimeDependencies,
  host: { context(): HandlerCtx; approvalReceipt(): Promise<OperationApprovalReceipt | undefined> },
) => {
  const server = createApplicationAgentMcpServer(deps, host);
  await server.connect(new StdioServerTransport());
};
