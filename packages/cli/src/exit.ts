import { isBlockingToolCall, type DriftReport, type ProbeResult } from "@mcpup/core";

/**
 * Exit codes, designed for use in CI by early adopters:
 * an `mcp-check` in a pipeline must be able to fail the build on a drift.
 */
export const EXIT = {
  /** healthy or degraded: reachable and usable. */
  ok: 0,
  /** transport / handshake failed, timeout, connection refused. */
  unreachable: 1,
  /** 200 OK that hides a JSON-RPC error or an unreadable payload. */
  silentFailure: 2,
  /** schema changed vs the provided baseline (`--baseline`). */
  drift: 3,
  /** "safe" tool call failed (isError, output-shape, explicit args rejected, not found). */
  toolCall: 4,
  /** CLI usage error (sysexits EX_USAGE). */
  usage: 64,
} as const;

/**
 * Precedence: `unreachable(1) > silent-failure(2) > failed tool-call(4) > drift(3) > 0`.
 * A dead/silent endpoint takes precedence over the rest (we cannot
 * compare a schema we were unable to capture anyway).
 */
export function exitCodeFor(result: ProbeResult, drift: DriftReport | null): number {
  if (result.status === "unreachable") return EXIT.unreachable;
  if (result.status === "silent-failure") return EXIT.silentFailure;
  if (result.toolCall && isBlockingToolCall(result.toolCall)) return EXIT.toolCall;
  if (drift?.changed) return EXIT.drift;
  return EXIT.ok;
}
