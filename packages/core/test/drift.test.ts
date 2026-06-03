import { describe, it, expect } from "bun:test";
import { buildSnapshot } from "../src/snapshot.ts";
import { diffSnapshots } from "../src/diff.ts";
import type { RawTool } from "../src/types.ts";

const TS = "2026-06-03T00:00:00.000Z";

describe("snapshot + diffSnapshots", () => {
  it("identical schema → no drift (and capturedAt has no influence)", () => {
    const tools: RawTool[] = [
      { name: "a", description: "x", inputSchema: { type: "object", properties: { p: { type: "string" } } } },
    ];
    const base = buildSnapshot(tools, "u", TS);
    const cur = buildSnapshot(tools, "u", "2099-01-01T00:00:00.000Z");

    expect(diffSnapshots(base, cur).changed).toBe(false);
  });

  it("inputSchema modified → drift targeting the right tool and the right field", () => {
    const base = buildSnapshot(
      [{ name: "echo", description: "d", inputSchema: { type: "object", properties: { text: { type: "string" } } } }],
      "u",
      TS,
    );
    const cur = buildSnapshot(
      [
        {
          name: "echo",
          description: "d",
          inputSchema: { type: "object", properties: { text: { type: "string" }, upper: { type: "boolean" } } },
        },
      ],
      "u",
      TS,
    );

    const d = diffSnapshots(base, cur);
    expect(d.changed).toBe(true);
    expect(d.modified).toHaveLength(1);
    expect(d.modified[0]?.name).toBe("echo");
    expect(d.modified[0]?.fields).toContain("inputSchema");
    expect(d.added).toHaveLength(0);
    expect(d.removed).toHaveLength(0);
  });

  it("tool added / removed", () => {
    const base = buildSnapshot([{ name: "a", inputSchema: { type: "object" } }], "u", TS);
    const cur = buildSnapshot([{ name: "b", inputSchema: { type: "object" } }], "u", TS);

    const d = diffSnapshots(base, cur);
    expect(d.added).toEqual(["b"]);
    expect(d.removed).toEqual(["a"]);
    expect(d.changed).toBe(true);
  });

  it("schema key order indifferent to the hash → no false drift", () => {
    const t1: RawTool[] = [
      { name: "a", inputSchema: { type: "object", properties: { x: { type: "string" }, y: { type: "number" } } } },
    ];
    const t2: RawTool[] = [
      { name: "a", inputSchema: { properties: { y: { type: "number" }, x: { type: "string" } }, type: "object" } },
    ];

    expect(buildSnapshot(t1, "u", TS).toolsHash).toBe(buildSnapshot(t2, "u", TS).toolsHash);
  });
});
