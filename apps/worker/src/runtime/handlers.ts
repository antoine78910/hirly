import type { TaskHandlers, RuntimeStore } from "./types";
import { PermanentTaskError } from "./retry";
import { providerSchema } from "@hirly/contracts";
import { assertProviderTransportActive } from "../providers";

export function createTaskHandlers(store: RuntimeStore): TaskHandlers {
  return {
    "inventory.maintenance": async (_task, signal) => {
      signal.throwIfAborted();
    },
    "provider.fetch_page": async (task, signal) => {
      signal.throwIfAborted();
      if (!task.provider) {
        throw new PermanentTaskError(
          "invalid_input",
          "provider task is missing provider",
        );
      }
      const provider = providerSchema.parse(task.provider);
      await store.assertProviderRunnable(provider);
      assertProviderTransportActive(provider);
    },
  };
}
