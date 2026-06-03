import { stableStringify } from "./snapshot.ts";
import type { DriftFieldChange, DriftReport, ModifiedTool, ToolSnapshot } from "./types.ts";

/**
 * Compares two schema snapshots and produces a structured drift report.
 *
 * This is the second pain point of the brief (§1.2): a tool changes the format of its
 * `inputSchema`/`outputSchema` without warning, and the agents that depend on it
 * break silently. Here we detect the addition/removal of tools and, for those that
 * persist, which fields have moved.
 */
export function diffSnapshots(baseline: ToolSnapshot, current: ToolSnapshot): DriftReport {
  const baseMap = new Map(baseline.tools.map((t) => [t.name, t] as const));
  const curMap = new Map(current.tools.map((t) => [t.name, t] as const));

  const added = [...curMap.keys()].filter((n) => !baseMap.has(n)).sort();
  const removed = [...baseMap.keys()].filter((n) => !curMap.has(n)).sort();

  const modified: ModifiedTool[] = [];
  for (const [name, cur] of curMap) {
    const base = baseMap.get(name);
    if (!base || base.hash === cur.hash) continue;

    const fields: DriftFieldChange[] = [];
    if (base.description !== cur.description) fields.push("description");
    if (stableStringify(base.inputSchema) !== stableStringify(cur.inputSchema)) {
      fields.push("inputSchema");
    }
    if (stableStringify(base.outputSchema) !== stableStringify(cur.outputSchema)) {
      fields.push("outputSchema");
    }
    modified.push({ name, fields, detail: fields.join(", ") });
  }
  modified.sort((a, b) => a.name.localeCompare(b.name));

  return {
    changed: added.length > 0 || removed.length > 0 || modified.length > 0,
    added,
    removed,
    modified,
    baselineHash: baseline.toolsHash,
    currentHash: current.toolsHash,
  };
}
