/** Public surface deliberately exposes composition/ports, never direct submit handlers. */
export * from "./ports";
export * from "./core";
export * from "./fixtures";
export * from "./approval";
export * from "./events";
export { createApplicationAgentOperationRegistry } from "./registry";
export {
  createApplicationAgentMcpServer,
  createCandidateMcpOperationRegistry,
  runStdioMcp,
} from "./mcp";
