import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { runProbe } from "../src/probe.ts";
import { startFixture, type Fixture } from "./fixture-server.ts";

/**
 * Regression: probing a server whose tool `outputSchema` uses a non-standard
 * format (here `uint64`) must NOT spill Ajv's `unknown format … ignored in
 * schema` warnings onto the console. The MCP SDK compiles every outputSchema
 * with Ajv at `tools/list` time; `createClient` hands it a `logger: false` Ajv
 * so these third-party-schema warnings stay quiet (validation is unchanged).
 */
describe("probe does not leak Ajv format warnings", () => {
  let fx: Fixture;
  beforeAll(async () => {
    fx = await startFixture("nonstandard-format");
  });
  afterAll(async () => {
    await fx.close();
  });

  it("probes a uint64-format outputSchema without emitting 'unknown format' warnings", async () => {
    fx.setMode("nonstandard-format");

    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };

    try {
      const r = await runProbe(fx.url);
      // Validation still works: the tool is listed and the server is healthy.
      expect(r.status).toBe("healthy");
      expect(r.toolCount).toBe(1);
    } finally {
      console.warn = original;
    }

    expect(warnings.some((w) => /unknown format .* ignored in schema/i.test(w))).toBe(false);
  });
});
