/**
 * Generation of synthetic arguments for a safe tool call.
 *
 * We do not try to produce *semantically* correct arguments (that is
 * impossible without knowing the tool) — just the minimum structurally valid
 * to exercise the tool and observe the *shape* of its response (brief §4). If the
 * server's input validation rejects these best-effort args, the caller treats
 * it as "inconclusive", not as an outage (cf. probe.ts / classifyToolCall).
 *
 * Best-effort: covers common JSON Schema cases. Cross constraints
 * (formats, dependencies, complex anyOf) are not honored.
 */

type JsonSchema = Record<string, unknown>;

function asSchema(value: unknown): JsonSchema | undefined {
  return typeof value === "object" && value !== null ? (value as JsonSchema) : undefined;
}

/** First declared type, whether it is `"string"` or `["string","null"]`. */
function primaryType(schema: JsonSchema): string | undefined {
  const t = schema["type"];
  if (typeof t === "string") return t;
  if (Array.isArray(t) && typeof t[0] === "string") return t[0];
  return undefined;
}

/** Minimal value for a given property schema. */
export function sampleValue(schema: unknown): unknown {
  const s = asSchema(schema);
  if (!s) return null;

  // Imposed / suggested values: we respect them in priority.
  if ("const" in s) return s["const"];
  if ("default" in s) return s["default"];
  const enumValues = s["enum"];
  if (Array.isArray(enumValues) && enumValues.length > 0) return enumValues[0];

  switch (primaryType(s)) {
    case "string":
      return "probe";
    case "number":
    case "integer":
      return typeof s["minimum"] === "number" ? s["minimum"] : 0;
    case "boolean":
      return false;
    case "null":
      return null;
    case "array": {
      const minItems = typeof s["minItems"] === "number" ? s["minItems"] : 0;
      return minItems > 0 ? [sampleValue(s["items"])] : [];
    }
    case "object":
      return synthesizeArgs(s);
    default:
      // Undeclared type (or `properties` alone) → try an object, otherwise null.
      return s["properties"] ? synthesizeArgs(s) : null;
  }
}

/**
 * Builds an arguments object covering only the `required` properties
 * of the `inputSchema`. Optional properties are omitted (minimal footprint).
 */
export function synthesizeArgs(inputSchema: unknown): Record<string, unknown> {
  const s = asSchema(inputSchema);
  const properties = s ? asSchema(s["properties"]) : undefined;
  if (!s || !properties) return {};

  const required = Array.isArray(s["required"]) ? (s["required"] as unknown[]) : [];
  const args: Record<string, unknown> = {};
  for (const key of required) {
    if (typeof key !== "string") continue;
    if (key in properties) args[key] = sampleValue(properties[key]);
  }
  return args;
}
