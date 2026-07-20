import type { Provider } from "@hirly/contracts";
import { PermanentTaskError } from "./runtime/retry";

// Provider transports remain deliberately inactive until a separately
// authorized implementation and rollout decision is supplied.
const activeProviderTransports = new Set<Provider>();

export function assertProviderTransportActive(provider: Provider): void {
  if (!activeProviderTransports.has(provider)) {
    throw new PermanentTaskError(
      "authorization_blocked",
      `provider transport is inactive: ${provider}`,
    );
  }
}
