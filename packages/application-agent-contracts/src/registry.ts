import { OperationSpecRegistry } from "@lssm-tech/lib.contracts-spec/operations";
import { applicationAgentOperations } from "./operations";
/** Declaration-only registry. Runtime binding is intentionally owned by application-agent-runtime. */
export const createApplicationAgentOperationSpecRegistry = () =>
  new OperationSpecRegistry([...applicationAgentOperations]);
