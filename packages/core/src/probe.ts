import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createClient } from "./client.ts";
import {
  classifyError,
  classifyToolCall,
  isBlockingToolCall,
  isSilentFailure,
  validateToolSchemas,
} from "./validate.ts";
import { buildSnapshot } from "./snapshot.ts";
import { synthesizeArgs } from "./synthesize.ts";
import type {
  Check,
  ProbeOptions,
  ProbeResult,
  ProbeStatus,
  RawTool,
  ServerInfo,
  ToolCallResult,
} from "./types.ts";

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Runs a one-shot semantic probe against a remote MCP endpoint.
 *
 * Sequence: `initialize` (handshake) → `tools/list` → schema validation →
 * snapshot. Each step feeds `checks[]` and can flip the status.
 * The key distinction: a failure on `tools/list` due to a JSON-RPC error or an
 * unreadable payload becomes `silent-failure`, not `unreachable` — the server
 * responds, but lies.
 */
export async function runProbe(url: string, opts: ProbeOptions = {}): Promise<ProbeResult> {
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const checks: Check[] = [];
  const t0 = performance.now();

  const build = (partial: Omit<ProbeResult, "endpoint" | "latencyMs" | "checks">): ProbeResult => ({
    endpoint: url,
    latencyMs: Math.round(performance.now() - t0),
    checks,
    ...partial,
  });

  const { client, transport } = createClient(url, opts.auth, opts.clientInfo);

  try {
    // --- 1. Handshake `initialize` -------------------------------------------------
    try {
      await client.connect(transport, { timeout });
      checks.push({
        name: "handshake",
        ok: true,
        detail: `protocol ${transport.protocolVersion ?? "?"}`,
      });
    } catch (err) {
      const error = classifyError(err);
      checks.push({ name: "handshake", ok: false, detail: error.message });
      return build({ status: "unreachable", error });
    }

    const serverInfo = client.getServerVersion() as ServerInfo | undefined;
    const capabilities = client.getServerCapabilities() as Record<string, unknown> | undefined;
    const instructions = client.getInstructions();
    const base = {
      protocolVersion: transport.protocolVersion,
      serverInfo,
      capabilities,
      instructions,
    };

    // --- 2. `tools/list` + parsing strict -----------------------------------------
    let tools: RawTool[];
    try {
      const res = await client.listTools(undefined, { timeout });
      tools = res.tools;
      checks.push({ name: "tools-list", ok: true, detail: `${tools.length} tool(s)` });
      checks.push({ name: "payload-parse", ok: true, detail: "valid JSON-RPC result" });
    } catch (err) {
      const error = classifyError(err);
      checks.push({ name: "tools-list", ok: false, detail: error.message });
      const silent = isSilentFailure(error.category);
      checks.push({
        name: "payload-parse",
        ok: false,
        detail: silent
          ? `200 OK but broken payload (${error.category})`
          : error.message,
      });
      return build({ status: silent ? "silent-failure" : "unreachable", error, ...base });
    }

    // --- 3. Schema validation + snapshot -------------------------------------
    const schemaCheck = validateToolSchemas(tools);
    checks.push(schemaCheck);
    const snapshot = buildSnapshot(tools, url, opts.capturedAt);
    let status: ProbeStatus = schemaCheck.ok ? "healthy" : "degraded";

    // --- 4. Safe tool call (opt-in) ---------------------------------------
    let toolCall: ToolCallResult | undefined;
    if (opts.callTool) {
      toolCall = await runSafeToolCall(client, tools, opts.callTool, timeout);
      checks.push({
        name: "tool-call",
        ok: toolCall.outcome === "ok",
        detail: `${toolCall.name} [${toolCall.argsSource}] → ${toolCall.outcome} : ${toolCall.detail}`,
      });
      // Escalation: a call that lies (JSON-RPC error / broken payload) flips to
      // silent-failure; any other actionable failure degrades (the server itself
      // did respond to the handshake + tools/list — we do not declare it dead).
      if (toolCall.outcome === "silent-failure") status = "silent-failure";
      else if (isBlockingToolCall(toolCall) && status === "healthy") status = "degraded";
    }

    return build({ status, toolCount: tools.length, snapshot, toolCall, ...base });
  } finally {
    // Best-effort close; we never mask the result of the probe.
    await client.close().catch(() => {});
  }
}

/**
 * Calls a designated tool and judges the *shape* of its response (brief §4).
 *
 * The SDK already validates the `structuredContent` against the declared `outputSchema`
 * (Ajv), so a mismatch arrives here as an exception → `output-shape`.
 * An `isError: true` is a tool-level error (legitimate on the protocol side) that
 * the probe nonetheless reports as a call that does not "work".
 */
async function runSafeToolCall(
  client: Client,
  tools: readonly RawTool[],
  request: { name: string; args?: Record<string, unknown> },
  timeout: number,
): Promise<ToolCallResult> {
  const argsSource = request.args === undefined ? "synthetic" : "explicit";
  const tool = tools.find((t) => t.name === request.name);
  if (!tool) {
    return {
      name: request.name,
      argsSource,
      outcome: "not-found",
      detail: `tool absent from tools/list`,
    };
  }

  const args = request.args ?? synthesizeArgs(tool.inputSchema);
  try {
    const res = await client.callTool({ name: request.name, arguments: args }, undefined, { timeout });
    if (res.isError) {
      return {
        name: request.name,
        argsSource,
        outcome: "is-error",
        isError: true,
        detail: "the tool returned isError: true",
      };
    }
    return { name: request.name, argsSource, outcome: "ok", isError: false, detail: "valid response" };
  } catch (err) {
    const { outcome, detail } = classifyToolCall(err, argsSource);
    return { name: request.name, argsSource, outcome, detail };
  }
}
