import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { runProbe } from "../src/probe.ts";
import { diffSnapshots } from "../src/diff.ts";
import { startRealServer, type RealServer } from "./real-server.ts";

describe("runProbe against a real MCP server (official SDK)", () => {
  let srv: RealServer;
  beforeAll(async () => {
    srv = await startRealServer();
  });
  afterAll(async () => {
    await srv.close();
  });

  it("real SDK server → healthy, zod-generated schemas", async () => {
    srv.setDrift(false);
    const r = await runProbe(srv.url, { capturedAt: "2026-06-03T00:00:00.000Z" });

    expect(r.status).toBe("healthy");
    expect(r.toolCount).toBe(2);
    expect(r.serverInfo?.name).toBe("real-fixture");
    expect(r.snapshot?.tools.map((t) => t.name)).toEqual(["add", "echo"]);
    const echo = r.snapshot?.tools.find((t) => t.name === "echo");
    expect((echo?.inputSchema as { type?: string } | undefined)?.type).toBe("object");
  });

  it("real drift: adding a property to inputSchema → detected", async () => {
    srv.setDrift(false);
    const baseline = await runProbe(srv.url, { capturedAt: "2026-06-03T00:00:00.000Z" });
    srv.setDrift(true);
    const current = await runProbe(srv.url, { capturedAt: "2026-06-03T00:00:00.000Z" });

    expect(baseline.snapshot).toBeDefined();
    expect(current.snapshot).toBeDefined();
    const d = diffSnapshots(baseline.snapshot!, current.snapshot!);
    expect(d.changed).toBe(true);
    expect(d.modified.find((m) => m.name === "echo")?.fields).toContain("inputSchema");
  });
});
