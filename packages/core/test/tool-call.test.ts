import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { runProbe } from "../src/probe.ts";
import { isBlockingToolCall } from "../src/validate.ts";
import { startFixture, type Fixture } from "./fixture-server.ts";

describe("runProbe with safe tool call", () => {
  let fx: Fixture;
  beforeAll(async () => {
    fx = await startFixture("healthy");
  });
  afterAll(async () => {
    await fx.close();
  });

  it("successful call → outcome ok, healthy status, non-blocking", async () => {
    fx.setCallMode("success");
    const r = await runProbe(fx.url, { callTool: { name: "echo" } });
    expect(r.toolCall?.outcome).toBe("ok");
    expect(r.toolCall?.argsSource).toBe("synthetic");
    expect(r.status).toBe("healthy");
    expect(r.checks.find((c) => c.name === "tool-call")?.ok).toBe(true);
    expect(isBlockingToolCall(r.toolCall!)).toBe(false);
  });

  it("isError: true → outcome is-error, degraded status, blocking", async () => {
    fx.setCallMode("is-error");
    const r = await runProbe(fx.url, { callTool: { name: "echo" } });
    expect(r.toolCall?.outcome).toBe("is-error");
    expect(r.toolCall?.isError).toBe(true);
    expect(r.status).toBe("degraded");
    expect(isBlockingToolCall(r.toolCall!)).toBe(true);
  });

  it("JSON-RPC error during the call → silent-failure", async () => {
    fx.setCallMode("jsonrpc-error");
    const r = await runProbe(fx.url, { callTool: { name: "echo" } });
    expect(r.toolCall?.outcome).toBe("silent-failure");
    expect(r.status).toBe("silent-failure");
  });

  it("InvalidParams + synthetic args → bad-args, healthy status (inconclusive)", async () => {
    fx.setCallMode("invalid-params");
    const r = await runProbe(fx.url, { callTool: { name: "echo" } });
    expect(r.toolCall?.outcome).toBe("bad-args");
    expect(r.toolCall?.argsSource).toBe("synthetic");
    expect(r.status).toBe("healthy");
    expect(isBlockingToolCall(r.toolCall!)).toBe(false);
  });

  it("InvalidParams + explicit args → blocking bad-args, degraded status", async () => {
    fx.setCallMode("invalid-params");
    const r = await runProbe(fx.url, { callTool: { name: "echo", args: { text: "hi" } } });
    expect(r.toolCall?.outcome).toBe("bad-args");
    expect(r.toolCall?.argsSource).toBe("explicit");
    expect(r.status).toBe("degraded");
    expect(isBlockingToolCall(r.toolCall!)).toBe(true);
  });

  it("structuredContent not respecting the outputSchema → output-shape, degraded", async () => {
    fx.setCallMode("bad-output");
    // `add` declares an outputSchema → the client-side Ajv validation triggers.
    const r = await runProbe(fx.url, { callTool: { name: "add" } });
    expect(r.toolCall?.outcome).toBe("output-shape");
    expect(r.status).toBe("degraded");
    expect(isBlockingToolCall(r.toolCall!)).toBe(true);
  });

  it("nonexistent tool → not-found (without a network call)", async () => {
    fx.setCallMode("success");
    const r = await runProbe(fx.url, { callTool: { name: "ghost" } });
    expect(r.toolCall?.outcome).toBe("not-found");
    expect(r.status).toBe("degraded");
  });

  it("without callTool → no toolCall nor tool-call check", async () => {
    fx.setCallMode("success");
    const r = await runProbe(fx.url);
    expect(r.toolCall).toBeUndefined();
    expect(r.checks.find((c) => c.name === "tool-call")).toBeUndefined();
  });
});
