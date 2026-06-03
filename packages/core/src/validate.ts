import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import type { Check, ProbeError, RawTool, ToolCallOutcome, ToolCallResult } from "./types.ts";

/**
 * Translates an error thrown by the SDK during the probe into a categorized `ProbeError`.
 *
 * Essential distinction (cf. brief §1.1): a `200 OK` that contains a
 * JSON-RPC `error` arrives here as an `McpError` — it is a *silent* failure,
 * which the probe must report whereas a Pingdom would see it as "green".
 */
export function classifyError(err: unknown): ProbeError {
  if (err instanceof McpError) {
    switch (err.code) {
      case ErrorCode.RequestTimeout:
        return { category: "timeout", code: err.code, message: err.message };
      case ErrorCode.ConnectionClosed:
        return { category: "transport", code: err.code, message: err.message };
      case ErrorCode.ParseError:
        return { category: "malformed", code: err.code, message: err.message };
      default:
        // -32603, -32601, -32602, … or an application code: a real JSON-RPC error.
        return { category: "jsonrpc-error", code: err.code, message: err.message };
    }
  }

  if (err instanceof SyntaxError) {
    // JSON.parse failed on the response body: malformed payload.
    return { category: "malformed", message: err.message };
  }

  if (err instanceof Error) {
    const msg = err.message;
    // System code carried by the error: `ECONNREFUSED` (Node) / `ConnectionRefused` (Bun)…
    const rawCode = (err as { code?: unknown }).code;
    const sysCode = typeof rawCode === "string" ? rawCode : undefined;

    if (/JSON|Unexpected token|Unexpected end|parse/i.test(msg)) {
      return { category: "malformed", message: msg };
    }
    if (
      (sysCode && /ECONN(REFUSED|RESET|ABORTED)|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|Connection(Refused|Closed|Reset|Aborted)/i.test(sysCode)) ||
      /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|fetch failed|unable to connect|failed to connect|network|socket|aborted|terminated|connection (refused|closed|reset)/i.test(msg)
    ) {
      return { category: "transport", message: msg };
    }
    if ((sysCode && /ETIMEDOUT|TIMEOUT/i.test(sysCode)) || /timeout|timed out/i.test(msg)) {
      return { category: "timeout", message: msg };
    }
    return { category: "unknown", message: msg };
  }

  return { category: "unknown", message: String(err) };
}

/** An error of this category is a broken `200 OK`: apparent success, real failure. */
export function isSilentFailure(category: ProbeError["category"]): boolean {
  return category === "jsonrpc-error" || category === "malformed";
}

/**
 * Heuristic "does this schema look like an MCP tool JSON Schema?".
 *
 * Note: the SDK already validates that `inputSchema` is an object `{ type: "object" }`
 * before these tools reach us — a truly malformed schema makes
 * `tools/list` fail (→ silent-failure). This check is therefore a
 * defense in depth that passes in practice, but documents the intent and
 * will cover future relaxations of the SDK.
 */
function isJsonSchemaLike(schema: unknown): boolean {
  if (typeof schema !== "object" || schema === null) return false;
  const s = schema as Record<string, unknown>;
  return s["type"] !== undefined || s["properties"] !== undefined || s["$ref"] !== undefined;
}

/**
 * True if the error comes from the `outputSchema` validation done by the SDK
 * on the client side (Ajv) — i.e. the tool's response does not respect the shape
 * it declares. This is a signal of a broken response, not a network outage.
 */
export function isOutputShapeError(err: unknown): boolean {
  return err instanceof McpError && /output schema|structured content/i.test(err.message);
}

/**
 * Classifies the outcome of a safe tool call that threw an exception.
 *
 * Key nuance (cf. plan): an `InvalidParams` with **synthetic** args does not
 * penalize the server (our args are best-effort) → non-blocking `bad-args`;
 * with **explicit** args, the user asserts they are valid → blocking
 * `bad-args`. An `outputSchema` mismatch → `output-shape`. Other JSON-RPC
 * errors / malformed payloads are silent failures, as for `tools/list`.
 */
export function classifyToolCall(
  err: unknown,
  argsSource: "synthetic" | "explicit",
): { outcome: ToolCallOutcome; detail: string } {
  if (isOutputShapeError(err)) {
    return { outcome: "output-shape", detail: (err as McpError).message };
  }

  const error = classifyError(err);

  if (error.category === "timeout" || error.category === "transport") {
    return { outcome: "unreachable", detail: error.message };
  }

  // Args rejected by the server's input validation.
  if (err instanceof McpError && err.code === ErrorCode.InvalidParams) {
    const note = argsSource === "synthetic" ? " (synthetic args — inconclusive)" : "";
    return { outcome: "bad-args", detail: `${error.message}${note}` };
  }

  // Other JSON-RPC error (-32603, -32601, custom code), malformed payload, or
  // uncategorized error during the call: a "200 OK" that lies → silent-failure.
  return { outcome: "silent-failure", detail: error.message };
}

/**
 * True if the tool call outcome must fail the run (exit 4).
 * `silent-failure` is excluded: it is carried by the global status (exit 2).
 * `bad-args` only blocks if the args were explicit (synthetic ones are
 * best-effort → inconclusive, non-blocking).
 */
export function isBlockingToolCall(toolCall: ToolCallResult): boolean {
  switch (toolCall.outcome) {
    case "is-error":
    case "output-shape":
    case "not-found":
    case "unreachable":
      return true;
    case "bad-args":
      return toolCall.argsSource === "explicit";
    default:
      return false;
  }
}

/** Builds the `schema-valid` check from the captured tools. */
export function validateToolSchemas(tools: readonly RawTool[]): Check {
  const bad: string[] = [];
  for (const tool of tools) {
    if (!isJsonSchemaLike(tool.inputSchema)) bad.push(`${tool.name}.inputSchema`);
    if (tool.outputSchema !== undefined && !isJsonSchemaLike(tool.outputSchema)) {
      bad.push(`${tool.name}.outputSchema`);
    }
  }
  if (bad.length > 0) {
    return { name: "schema-valid", ok: false, detail: `suspect schema: ${bad.join(", ")}` };
  }
  return {
    name: "schema-valid",
    ok: true,
    detail: tools.length === 0 ? "no tools" : `${tools.length} plausible schema(s)`,
  };
}
