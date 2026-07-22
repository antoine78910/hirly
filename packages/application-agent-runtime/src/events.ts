import { createApplicationAgentEventRegistry } from "@hirly/application-agent-contracts";
import type { AuditOutboxPublisher } from "./ports";

export type GuardedEventPublisher = {
  publish(key: string, version: string, payload: unknown): Promise<void>;
};

/** Resolves only declared application-agent events and validates payloads before they leave the runtime. */
export const createGuardedEventPublisher = (
  outbox: AuditOutboxPublisher,
): GuardedEventPublisher => {
  const events = createApplicationAgentEventRegistry();
  return {
    async publish(key, version, payload) {
      const event = events.get(key, version);
      if (!event) throw new Error(`UNDECLARED_APPLICATION_AGENT_EVENT:${key}.v${version}`);
      const parsed = event.payload.getZod().safeParse(payload);
      if (!parsed.success) throw new Error(`MALFORMED_APPLICATION_AGENT_EVENT:${key}.v${version}`);
      await outbox.publish({
        key: event.meta.key,
        version: event.meta.version,
        payload: parsed.data,
      });
    },
  };
};
