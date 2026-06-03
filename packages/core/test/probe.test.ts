import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { runProbe } from "../src/probe.ts";
import { startFixture, type Fixture } from "./fixture-server.ts";

describe("runProbe", () => {
  let fx: Fixture;
  beforeAll(async () => {
    fx = await startFixture("healthy");
  });
  afterAll(async () => {
    await fx.close();
  });

  it("healthy server → healthy, all checks OK, tools sorted", async () => {
    fx.setMode("healthy");
    const r = await runProbe(fx.url, { capturedAt: "2026-06-03T00:00:00.000Z" });

    expect(r.status).toBe("healthy");
    expect(r.toolCount).toBe(2);
    expect(r.checks.every((c) => c.ok)).toBe(true);
    expect(r.serverInfo?.name).toBe("fixture");
    expect(r.protocolVersion).toBeTruthy();
    expect(r.snapshot?.tools.map((t) => t.name)).toEqual(["add", "echo"]);
  });

  it("200 OK hiding a JSON-RPC error → silent-failure", async () => {
    fx.setMode("silent-failure");
    const r = await runProbe(fx.url);

    expect(r.status).toBe("silent-failure");
    expect(r.error?.category).toBe("jsonrpc-error");
    expect(r.error?.code).toBe(-32603);
    expect(r.checks.find((c) => c.name === "payload-parse")?.ok).toBe(false);
    // The handshake itself succeeded: this really is a *silent* failure.
    expect(r.checks.find((c) => c.name === "handshake")?.ok).toBe(true);
  });

  it("200 OK with unreadable payload → silent-failure (malformed)", async () => {
    fx.setMode("malformed");
    const r = await runProbe(fx.url);

    expect(r.status).toBe("silent-failure");
    expect(r.error?.category).toBe("malformed");
  });

  it("unreachable endpoint → unreachable", async () => {
    const r = await runProbe("http://127.0.0.1:1/mcp", { timeoutMs: 2000 });

    expect(r.status).toBe("unreachable");
    expect(r.error?.category).toBe("transport");
    expect(r.checks.find((c) => c.name === "handshake")?.ok).toBe(false);
  });

  it("two probes of the same server → identical toolsHash (capturedAt excluded from the hash)", async () => {
    fx.setMode("healthy");
    const a = await runProbe(fx.url, { capturedAt: "2026-01-01T00:00:00.000Z" });
    const b = await runProbe(fx.url, { capturedAt: "2026-12-31T00:00:00.000Z" });

    expect(a.snapshot?.toolsHash).toBeTruthy();
    expect(a.snapshot?.toolsHash).toBe(b.snapshot?.toolsHash);
  });
});
