import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type { RawTool, ToolEntry, ToolSnapshot } from "./types.ts";

/**
 * Serializes a value deterministically: object keys sorted, array order
 * preserved, keys with `undefined` value ignored (like `JSON.stringify`).
 *
 * This is the foundation of drift: two semantically identical schemas but with
 * a different key order must produce the SAME hash, otherwise we would report
 * a false drift on every run.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Stable hash of a tool over its semantic surface (name, description, schemas). */
export function hashTool(tool: RawTool): string {
  return sha256(
    stableStringify({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
    }),
  );
}

/**
 * Captures a normalized snapshot of `tools/list`: tools sorted by name, hash per
 * tool + aggregated hash. This is the baseline that we will diff on subsequent runs.
 */
export function buildSnapshot(
  tools: readonly RawTool[],
  endpoint: string,
  capturedAt: string = new Date().toISOString(),
): ToolSnapshot {
  const entries: ToolEntry[] = tools
    .map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema,
      outputSchema: t.outputSchema,
      hash: hashTool(t),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Order-stable aggregate (the entries are already sorted by name).
  const toolsHash = sha256(entries.map((e) => `${e.name}:${e.hash}`).join("\n"));

  return { schemaVersion: 1, capturedAt, endpoint, toolsHash, tools: entries };
}

/** Minimal guardrail on the shape of a snapshot file read from disk. */
function assertSnapshot(value: unknown): asserts value is ToolSnapshot {
  if (
    typeof value !== "object" ||
    value === null ||
    (value as Record<string, unknown>)["schemaVersion"] !== 1 ||
    !Array.isArray((value as Record<string, unknown>)["tools"])
  ) {
    throw new Error("Invalid snapshot: schemaVersion: 1 and a `tools` array are expected.");
  }
}

export async function readSnapshot(path: string): Promise<ToolSnapshot> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  assertSnapshot(parsed);
  return parsed;
}

export async function writeSnapshot(path: string, snapshot: ToolSnapshot): Promise<void> {
  await writeFile(path, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
}
