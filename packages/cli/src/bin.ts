#!/usr/bin/env node
import { readFileSync } from "node:fs";
import {
  runProbe,
  buildSnapshot,
  diffSnapshots,
  readSnapshot,
  writeSnapshot,
  type AuthConfig,
  type DriftReport,
  type ProbeResult,
} from "@mcpup/core";
import { renderHuman, renderJson } from "./render.ts";
import { EXIT, exitCodeFor } from "./exit.ts";

const VERSION = (() => {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

interface ParsedArgs {
  url?: string;
  token?: string;
  headers: Record<string, string>;
  timeoutMs?: number;
  json: boolean;
  saveSnapshot?: string;
  baseline?: string;
  call?: string;
  callArgs?: string;
  help: boolean;
  version: boolean;
  error?: string;
}

const HELP = `mcp-check — one-shot semantic health-check for MCP servers

USAGE
  mcp-check <url> [options]

OPTIONS
  -t, --token <token>     Bearer token (→ Authorization: Bearer <token>)
  -H, --header <k:v>      Additional HTTP header (repeatable)
      --timeout <ms>      Timeout per JSON-RPC request (default 10000)
      --call <tool>       Calls a "safe" tool and validates the shape of its response
      --call-args <json>  JSON arguments for --call (otherwise synthesized from the schema)
      --save-snapshot <f> Writes the current schema snapshot to <f>
      --baseline <f>      Compares the current schema to <f> and reports drift
      --json              Machine-readable output (JSON) for CI
  -h, --help              Show this help
  -V, --version           Show the version

EXIT CODES
  0  healthy / degraded      2  silent failure (200 OK + JSON-RPC error)
  1  unreachable             3  drift detected (with --baseline)
                             4  "safe" tool call failed (with --call)

EXAMPLES
  mcp-check https://mcp.example.com/mcp
  mcp-check https://mcp.example.com/mcp -t $TOKEN --save-snapshot base.json
  mcp-check https://mcp.example.com/mcp --baseline base.json --json
  mcp-check https://mcp.example.com/mcp --call ping
  mcp-check https://mcp.example.com/mcp --call search --call-args '{"q":"test"}'
`;

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { headers: {}, json: false, help: false, version: false };

  // Allows `--opt=value` as well as `--opt value`.
  const tokens: string[] = [];
  for (const a of argv) {
    if (a.startsWith("--") && a.includes("=")) {
      const idx = a.indexOf("=");
      tokens.push(a.slice(0, idx), a.slice(idx + 1));
    } else {
      tokens.push(a);
    }
  }

  for (let i = 0; i < tokens.length; i++) {
    const arg = tokens[i]!;
    const next = (): string | undefined => tokens[++i];
    switch (arg) {
      case "-h":
      case "--help":
        out.help = true;
        break;
      case "-V":
      case "--version":
        out.version = true;
        break;
      case "--json":
        out.json = true;
        break;
      case "-t":
      case "--token":
        out.token = next();
        break;
      case "-H":
      case "--header": {
        const h = next();
        if (h) {
          const idx = h.indexOf(":");
          if (idx <= 0) {
            out.error = `invalid header "${h}" (expected k:v)`;
          } else {
            out.headers[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
          }
        }
        break;
      }
      case "--timeout": {
        const v = next();
        const n = Number(v);
        if (!v || Number.isNaN(n) || n <= 0) out.error = `invalid timeout "${v ?? ""}"`;
        else out.timeoutMs = n;
        break;
      }
      case "--save-snapshot":
        out.saveSnapshot = next();
        break;
      case "--baseline":
        out.baseline = next();
        break;
      case "--call":
        out.call = next();
        break;
      case "--call-args":
        out.callArgs = next();
        break;
      default:
        if (arg.startsWith("-")) out.error = `unknown option "${arg}"`;
        else if (out.url) out.error = `unexpected argument "${arg}"`;
        else out.url = arg;
    }
  }

  return out;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    process.stdout.write(HELP);
    return EXIT.ok;
  }
  if (args.version) {
    process.stdout.write(`mcp-check ${VERSION}\n`);
    return EXIT.ok;
  }
  if (args.error) {
    process.stderr.write(`error: ${args.error}\n\n${HELP}`);
    return EXIT.usage;
  }
  if (!args.url) {
    process.stderr.write(`error: missing URL\n\n${HELP}`);
    return EXIT.usage;
  }

  const auth: AuthConfig | undefined =
    args.token || Object.keys(args.headers).length > 0
      ? { bearerToken: args.token, headers: args.headers }
      : undefined;

  // --- Safe tool call: validate --call / --call-args --------------------
  if (args.callArgs !== undefined && !args.call) {
    process.stderr.write(`error: --call-args requires --call <tool>\n\n${HELP}`);
    return EXIT.usage;
  }
  let callTool: { name: string; args?: Record<string, unknown> } | undefined;
  if (args.call) {
    let parsedArgs: Record<string, unknown> | undefined;
    if (args.callArgs !== undefined) {
      try {
        const parsed = JSON.parse(args.callArgs) as unknown;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new Error("a JSON object is expected");
        }
        parsedArgs = parsed as Record<string, unknown>;
      } catch (err) {
        process.stderr.write(`error: invalid --call-args: ${(err as Error).message}\n\n${HELP}`);
        return EXIT.usage;
      }
    }
    callTool = { name: args.call, args: parsedArgs };
  }

  const result: ProbeResult = await runProbe(args.url, {
    auth,
    timeoutMs: args.timeoutMs,
    clientInfo: { name: "mcp-check", version: VERSION },
    callTool,
  });

  // --- Drift: compare the current snapshot to a baseline -----------------------
  let drift: DriftReport | null = null;
  if (args.baseline) {
    if (!result.snapshot) {
      process.stderr.write(
        `warning: no schema captured (${result.status}) — drift comparison skipped\n`,
      );
    } else {
      try {
        const baseline = await readSnapshot(args.baseline);
        const current = buildSnapshot(result.snapshot.tools, args.url, result.snapshot.capturedAt);
        drift = diffSnapshots(baseline, current);
      } catch (err) {
        process.stderr.write(
          `warning: baseline unreadable (${args.baseline}): ${(err as Error).message}\n`,
        );
      }
    }
  }

  // --- Save the current snapshot -------------------------------------------
  if (args.saveSnapshot && result.snapshot) {
    await writeSnapshot(args.saveSnapshot, result.snapshot);
    if (!args.json) process.stderr.write(`snapshot written → ${args.saveSnapshot}\n`);
  }

  // --- Render ---------------------------------------------------------------------
  if (args.json) {
    process.stdout.write(renderJson(result, drift) + "\n");
  } else {
    const color = process.stdout.isTTY === true && !process.env["NO_COLOR"];
    process.stdout.write(renderHuman(result, drift, { color, baselinePath: args.baseline }) + "\n");
  }

  return exitCodeFor(result, drift);
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`fatal error: ${(err as Error).message}\n`);
    process.exit(EXIT.usage);
  },
);
