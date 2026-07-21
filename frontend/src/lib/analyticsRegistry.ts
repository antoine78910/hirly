import { analyticsRegistry } from "./analyticsRegistry.generated";

type RegistryEvent = (typeof analyticsRegistry.events)[number];
type RegistryProperty = {
  readonly type: "boolean" | "integer" | "number" | "string" | "timestamp";
  readonly privacy: "public" | "pseudonymous" | "sensitive";
  readonly minimum?: number;
};

const eventByName = new Map<string, RegistryEvent>();
const canonicalNameByAlias = new Map<string, string>();

for (const event of analyticsRegistry.events) {
  eventByName.set(event.name, event);
  for (const alias of event.legacyAliases) {
    canonicalNameByAlias.set(alias, event.name);
  }
}

export const resolveAnalyticsEvent = (
  name: string,
): { canonicalName: string; definition: RegistryEvent } | null => {
  const canonicalName = eventByName.has(name)
    ? name
    : canonicalNameByAlias.get(name);
  if (!canonicalName) return null;
  const definition = eventByName.get(canonicalName);
  return definition ? { canonicalName, definition } : null;
};

const matchesType = (value: unknown, property: RegistryProperty): boolean => {
  const meetsMinimum =
    property.minimum === undefined ||
    (typeof value === "number" && value >= property.minimum);
  if (property.type === "boolean") return typeof value === "boolean";
  if (property.type === "integer") return Number.isInteger(value) && meetsMinimum;
  if (property.type === "number") {
    return typeof value === "number" && Number.isFinite(value) && meetsMinimum;
  }
  if (property.type === "timestamp") {
    return typeof value === "string" && !Number.isNaN(Date.parse(value));
  }
  return typeof value === "string";
};

export const registryPropertiesForEvent = (
  originalName: string,
  input: Record<string, unknown>,
): Record<string, boolean | number | string> | null => {
  const resolved = resolveAnalyticsEvent(originalName);
  if (!resolved) return null;
  const normalizedInput =
    resolved.canonicalName === "ui_interaction"
      ? {
          ...input,
          interaction: originalName,
          surface:
            input.surface ??
            input.location ??
            input.page ??
            input.source,
        }
      : input;
  const allowed: Record<string, RegistryProperty> = {
    ...resolved.definition.requiredProperties,
    ...resolved.definition.optionalProperties,
  };
  const result: Record<string, boolean | number | string> = {};
  for (const [key, value] of Object.entries(normalizedInput)) {
    const property = allowed[key];
    if (
      property &&
      property.privacy !== "sensitive" &&
      matchesType(value, property)
    ) {
      result[key] = value as boolean | number | string;
    }
  }
  const hasRequiredProperties = Object.keys(
    resolved.definition.requiredProperties,
  ).every((key) => key in result);
  return hasRequiredProperties ? result : null;
};
