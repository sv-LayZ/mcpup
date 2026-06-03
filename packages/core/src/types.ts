/**
 * Public types of the probe engine.
 *
 * The status of an MCP endpoint is NOT binary (up/down): a server can
 * respond `200 OK` while being semantically broken. These types encode
 * this nuance — it is the core of the product's value (cf. brief §2).
 */

/**
 * - `healthy`        : handshake OK, `tools/list` OK, plausible schemas.
 * - `degraded`       : reachable and parsable, but a tool schema is suspect.
 * - `silent-failure` : `200 OK` that hides a JSON-RPC error or an unreadable payload.
 *                      This is what a generic uptime monitor sees as "green".
 * - `unreachable`    : transport/handshake failed, timeout, connection refused.
 */
export type ProbeStatus = "healthy" | "degraded" | "silent-failure" | "unreachable";

export type CheckName = "handshake" | "tools-list" | "payload-parse" | "schema-valid" | "tool-call";

export interface Check {
  name: CheckName;
  ok: boolean;
  detail: string;
}

export interface AuthConfig {
  /** Added as `Authorization: Bearer <token>`. */
  bearerToken?: string;
  /** Arbitrary headers (merged; take priority over the bearer in case of collision). */
  headers?: Record<string, string>;
}

export interface ProbeOptions {
  auth?: AuthConfig;
  /** Timeout per JSON-RPC request (handshake and tools/list). Default 10,000 ms. */
  timeoutMs?: number;
  /** Identity announced by the probe to the server during `initialize`. */
  clientInfo?: { name: string; version: string };
  /** ISO timestamp injected into the snapshot (default: now). Injectable for tests. */
  capturedAt?: string;
  /**
   * Optional call of a designated safe tool (brief §4). `args` absent →
   * synthesis from the `inputSchema`; `args` provided → call with those arguments.
   */
  callTool?: { name: string; args?: Record<string, unknown> };
}

/**
 * Outcome of the safe tool call. Notably distinguishes a real success from a
 * broken response (`is-error`, `output-shape`) and rejected best-effort args.
 */
export type ToolCallOutcome =
  | "ok"
  | "is-error"
  | "output-shape"
  | "bad-args"
  | "not-found"
  | "silent-failure"
  | "unreachable";

export interface ToolCallResult {
  name: string;
  argsSource: "synthetic" | "explicit";
  outcome: ToolCallOutcome;
  /** `true` if the tool returned `isError` (tool-level error, not protocol). */
  isError?: boolean;
  detail: string;
}

export interface ServerInfo {
  name: string;
  version: string;
}

export type ErrorCategory =
  | "transport"
  | "handshake"
  | "jsonrpc-error"
  | "malformed"
  | "timeout"
  | "unknown";

export interface ProbeError {
  category: ErrorCategory;
  /** Original JSON-RPC code when there is one. */
  code?: number;
  message: string;
}

/** Minimal shape of a tool as returned by `tools/list`. */
export interface RawTool {
  name: string;
  description?: string;
  inputSchema: unknown;
  outputSchema?: unknown;
}

export interface ToolEntry {
  name: string;
  description: string;
  inputSchema: unknown;
  outputSchema?: unknown;
  /** SHA-256 of the normalized shape {name, description, inputSchema, outputSchema}. */
  hash: string;
}

export interface ToolSnapshot {
  schemaVersion: 1;
  /** ISO 8601; excluded from the hash, so it does not influence drift detection. */
  capturedAt: string;
  endpoint: string;
  /** Aggregated SHA-256 of all `ToolEntry.hash` (tools sorted by name). */
  toolsHash: string;
  tools: ToolEntry[];
}

export interface ProbeResult {
  status: ProbeStatus;
  endpoint: string;
  latencyMs: number;
  protocolVersion?: string;
  serverInfo?: ServerInfo;
  capabilities?: Record<string, unknown>;
  instructions?: string;
  toolCount?: number;
  checks: Check[];
  /** Present as soon as `tools/list` could be captured and parsed. */
  snapshot?: ToolSnapshot;
  /** Present only if `ProbeOptions.callTool` was requested. */
  toolCall?: ToolCallResult;
  error?: ProbeError;
}

export type DriftFieldChange = "description" | "inputSchema" | "outputSchema";

export interface ModifiedTool {
  name: string;
  fields: DriftFieldChange[];
  detail: string;
}

export interface DriftReport {
  changed: boolean;
  /** Tools present now, absent from the baseline. */
  added: string[];
  /** Tools present in the baseline, gone now. */
  removed: string[];
  modified: ModifiedTool[];
  baselineHash: string;
  currentHash: string;
}
