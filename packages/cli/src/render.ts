import type { Check, DriftReport, ProbeResult, ProbeStatus, ToolCallResult } from "@mcpup/core";

const CODES = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
} as const;

type ColorName = Exclude<keyof typeof CODES, "reset">;

function makePaint(enabled: boolean) {
  return (text: string, ...styles: ColorName[]): string => {
    if (!enabled) return text;
    return styles.map((s) => CODES[s]).join("") + text + CODES.reset;
  };
}

const STATUS_LABEL: Record<ProbeStatus, string> = {
  healthy: "healthy",
  degraded: "degraded",
  "silent-failure": "SILENT FAILURE",
  unreachable: "unreachable",
};

function statusColor(status: ProbeStatus): ColorName {
  switch (status) {
    case "healthy":
      return "green";
    case "degraded":
      return "yellow";
    default:
      return "red";
  }
}

function checkLine(c: Check, paint: ReturnType<typeof makePaint>): string {
  const mark = c.ok ? paint("✓", "green") : paint("✗", "red");
  const name = c.name.padEnd(14);
  return `    ${mark} ${name}${paint(c.detail, "gray")}`;
}

function toolCallSection(tc: ToolCallResult, paint: ReturnType<typeof makePaint>): string[] {
  // ok → green ; synthetic bad-args (inconclusive) → yellow ; otherwise red.
  const inconclusive = tc.outcome === "bad-args" && tc.argsSource === "synthetic";
  const glyph =
    tc.outcome === "ok"
      ? paint("✓", "green")
      : inconclusive
        ? paint("⚠", "yellow")
        : paint("✗", "red");
  const verdict = inconclusive ? "inconclusive" : tc.outcome;
  return [
    `  ${paint("safe tool call", "bold")}`,
    `    ${glyph} ${tc.name} ${paint(`[${tc.argsSource}]`, "gray")} → ${verdict}`,
    `    ${paint(tc.detail, "gray")}`,
  ];
}

/** Human-readable render: status, server metadata, checks, and drift if compared. */
export function renderHuman(
  result: ProbeResult,
  drift: DriftReport | null,
  opts: { color: boolean; baselinePath?: string } = { color: false },
): string {
  const paint = makePaint(opts.color);
  const lines: string[] = [];

  lines.push(`${paint("mcp-check", "bold", "cyan")}  ${paint(result.endpoint, "dim")}`);

  const dot = paint("●", statusColor(result.status));
  const label = paint(STATUS_LABEL[result.status], statusColor(result.status), "bold");
  lines.push(`  ${dot} ${label}${paint(`   ${result.latencyMs}ms`, "gray")}`);

  if (result.serverInfo) {
    const meta = [
      `server ${result.serverInfo.name} v${result.serverInfo.version}`,
      result.protocolVersion ? `protocol ${result.protocolVersion}` : null,
      result.toolCount !== undefined ? `${result.toolCount} tool(s)` : null,
    ]
      .filter(Boolean)
      .join(paint("  ·  ", "gray"));
    lines.push(`  ${paint(meta, "gray")}`);
  }

  if (result.error) {
    lines.push(`  ${paint("error", "red")} ${paint(`[${result.error.category}]`, "gray")} ${result.error.message}`);
  }

  if (result.checks.length > 0) {
    lines.push("");
    lines.push(`  ${paint("checks", "bold")}`);
    for (const c of result.checks) lines.push(checkLine(c, paint));
  }

  if (result.toolCall) lines.push("", ...toolCallSection(result.toolCall, paint));

  if (drift) {
    lines.push("");
    const title = opts.baselinePath ? `drift  ${paint(`(vs ${opts.baselinePath})`, "gray")}` : "drift";
    lines.push(`  ${paint(title, "bold")}`);
    if (!drift.changed) {
      lines.push(`    ${paint("✓ no schema change", "green")}`);
    } else {
      for (const name of drift.added) lines.push(`    ${paint("+", "green")} ${name} ${paint("(new tool)", "gray")}`);
      for (const name of drift.removed) lines.push(`    ${paint("-", "red")} ${name} ${paint("(removed tool)", "gray")}`);
      for (const m of drift.modified) {
        lines.push(`    ${paint("~", "yellow")} ${m.name} ${paint(m.fields.join(", "), "gray")}`);
      }
    }
  }

  return lines.join("\n");
}

/** Machine-readable output for CI / scripts. */
export function renderJson(result: ProbeResult, drift: DriftReport | null): string {
  return JSON.stringify({ result, drift }, null, 2);
}
