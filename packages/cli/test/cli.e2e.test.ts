import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { fileURLToPath } from "node:url";
import { startFixture, type Fixture } from "../../core/test/fixture-server.ts";

const BIN = fileURLToPath(new URL("../src/bin.ts", import.meta.url));

async function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", BIN, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1" },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

describe("CLI mcp-check (end-to-end, real exit codes)", () => {
  let fx: Fixture;
  beforeAll(async () => {
    fx = await startFixture("healthy");
  });
  afterAll(async () => {
    await fx.close();
  });

  it("healthy server → exit 0, JSON status healthy", async () => {
    fx.setMode("healthy");
    const { code, stdout } = await run([fx.url, "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout).result.status).toBe("healthy");
  });

  it("silent failure → exit 2", async () => {
    fx.setMode("silent-failure");
    const { code, stdout } = await run([fx.url, "--json"]);
    expect(code).toBe(2);
    expect(JSON.parse(stdout).result.status).toBe("silent-failure");
  });

  it("unreachable endpoint → exit 1", async () => {
    const { code } = await run(["http://127.0.0.1:1/mcp", "--timeout", "2000", "--json"]);
    expect(code).toBe(1);
  });

  it("drift → exit 3 (--save-snapshot then --baseline)", async () => {
    fx.setMode("healthy");
    const snap = `/tmp/mcpup-cli-${process.pid}.snapshot.json`;
    const saved = await run([fx.url, "--save-snapshot", snap, "--json"]);
    expect(saved.code).toBe(0);

    fx.setMode("drift");
    const compared = await run([fx.url, "--baseline", snap, "--json"]);
    expect(compared.code).toBe(3);
    expect(JSON.parse(compared.stdout).drift.changed).toBe(true);
  });

  it("--call on a successful call → exit 0, outcome ok", async () => {
    fx.setMode("healthy");
    fx.setCallMode("success");
    const { code, stdout } = await run([fx.url, "--call", "echo", "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout).result.toolCall.outcome).toBe("ok");
  });

  it("--call on a tool returning isError → exit 4", async () => {
    fx.setMode("healthy");
    fx.setCallMode("is-error");
    const { code, stdout } = await run([fx.url, "--call", "echo", "--json"]);
    expect(code).toBe(4);
    expect(JSON.parse(stdout).result.toolCall.outcome).toBe("is-error");
  });

  it("--call-args invalid JSON → exit 64", async () => {
    const { code } = await run([fx.url, "--call", "echo", "--call-args", "{bad json"]);
    expect(code).toBe(64);
  });

  it("--call-args without --call → exit 64", async () => {
    const { code } = await run([fx.url, "--call-args", '{"x":1}']);
    expect(code).toBe(64);
  });

  it("--help → exit 0 and shows usage", async () => {
    const { code, stdout } = await run(["--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("USAGE");
  });

  it("missing URL → exit 64 (usage)", async () => {
    const { code } = await run([]);
    expect(code).toBe(64);
  });
});
