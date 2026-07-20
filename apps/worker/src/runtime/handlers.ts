import type { TaskHandlers, RuntimeStore } from "./types";
import { PermanentTaskError } from "./retry";

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
      await store.assertProviderRunnable(
        task.provider as "apec" | "hellowork" | "wttj" | "indeed",
      );
      throw new PermanentTaskError(
        "authorization_blocked",
        "provider transport is not activated in this milestone",
      );
    },
  };
}
