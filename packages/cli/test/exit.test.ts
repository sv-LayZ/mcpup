import { describe, it, expect } from "bun:test";
import { exitCodeFor, EXIT } from "../src/exit.ts";
import type { DriftReport, ProbeResult, ProbeStatus, ToolCallResult } from "@mcpup/core";

function result(status: ProbeStatus, extra: Partial<ProbeResult> = {}): ProbeResult {
  return { status, endpoint: "http://x/mcp", latencyMs: 1, checks: [], ...extra };
}

const tc = (outcome: ToolCallResult["outcome"], argsSource: ToolCallResult["argsSource"] = "synthetic"): ToolCallResult => ({
  name: "t",
  argsSource,
  outcome,
  detail: "",
});

const drift = (changed: boolean): DriftReport => ({
  changed,
  added: [],
  removed: [],
  modified: [],
  baselineHash: "a",
  currentHash: "b",
});

describe("exitCodeFor", () => {
  it("healthy / degraded → 0", () => {
    expect(exitCodeFor(result("healthy"), null)).toBe(EXIT.ok);
    expect(exitCodeFor(result("degraded"), null)).toBe(EXIT.ok);
  });
  it("unreachable → 1", () => {
    expect(exitCodeFor(result("unreachable"), null)).toBe(EXIT.unreachable);
  });
  it("silent-failure → 2", () => {
    expect(exitCodeFor(result("silent-failure"), null)).toBe(EXIT.silentFailure);
  });
  it("drift detected → 3", () => {
    expect(exitCodeFor(result("healthy"), drift(true))).toBe(EXIT.drift);
  });
  it("no drift → 0", () => {
    expect(exitCodeFor(result("healthy"), drift(false))).toBe(EXIT.ok);
  });
  it("dead endpoint takes precedence over drift", () => {
    expect(exitCodeFor(result("unreachable"), drift(true))).toBe(EXIT.unreachable);
    expect(exitCodeFor(result("silent-failure"), drift(true))).toBe(EXIT.silentFailure);
  });

  it("blocking tool call → 4", () => {
    expect(exitCodeFor(result("degraded", { toolCall: tc("is-error") }), null)).toBe(EXIT.toolCall);
    expect(exitCodeFor(result("degraded", { toolCall: tc("output-shape") }), null)).toBe(EXIT.toolCall);
    expect(exitCodeFor(result("degraded", { toolCall: tc("not-found") }), null)).toBe(EXIT.toolCall);
    expect(exitCodeFor(result("degraded", { toolCall: tc("bad-args", "explicit") }), null)).toBe(EXIT.toolCall);
  });
  it("ok call / synthetic bad-args → 0 (non-blocking)", () => {
    expect(exitCodeFor(result("healthy", { toolCall: tc("ok") }), null)).toBe(EXIT.ok);
    expect(exitCodeFor(result("healthy", { toolCall: tc("bad-args", "synthetic") }), null)).toBe(EXIT.ok);
  });
  it("precedence: tool-call (4) takes precedence over drift (3)…", () => {
    expect(exitCodeFor(result("degraded", { toolCall: tc("is-error") }), drift(true))).toBe(EXIT.toolCall);
  });
  it("…but silent-failure (2) takes precedence over tool-call (4)", () => {
    expect(exitCodeFor(result("silent-failure", { toolCall: tc("is-error") }), null)).toBe(EXIT.silentFailure);
  });
});
