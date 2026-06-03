# mcp-check

> One-shot **semantic** health check for MCP servers. Catches what an uptime monitor misses: silent failures and schema drift.

An HTTP `ping` tells you the port responds. `mcp-check` tells you whether your MCP server is actually **healthy for an agent**: full handshake, usable `tools/list`, and — the classic trap — no JSON-RPC error hidden under a `200 OK`.

```
$ mcp-check https://mcp.example.com/mcp
mcp-check  https://mcp.example.com/mcp
  ● SILENT FAILURE   20ms
  server acme-mcp v1.2.0  ·  protocol 2025-11-25
  error [jsonrpc-error] MCP error -32603: internal explosion masked by a 200 OK

  checks
    ✓ handshake     protocol 2025-11-25
    ✗ tools-list    MCP error -32603: …
    ✗ payload-parse 200 OK but broken payload (jsonrpc-error)
```

The handshake succeeds — a Pingdom would see "green". The agent, however, breaks. `mcp-check` says so, and exits with code 2.

## What it checks

- Full **`initialize` handshake** (not just "the port responds").
- **`tools/list`** parsed strictly: a `200 OK` containing a JSON-RPC error or an unreadable payload is a **silent failure**, not a success.
- **Schema drift**: captures a snapshot of tool schemas and compares it to a baseline (`--baseline`) to detect that an `inputSchema`/`outputSchema` has changed under your feet.
- **Safe tool call** (`--call`): calls a tool you designate and validates the **shape** of its response (not the HTTP code) — detects an `isError`, an output that does not respect the declared `outputSchema`, or a hidden JSON-RPC error. Arguments synthesized from the schema, or provided via `--call-args`.

## Installation

Published as [`@mcpup/cli`](https://www.npmjs.com/package/@mcpup/cli); the installed command is `mcp-check`.

```bash
# run without installing (Node ≥ 20)
npx @mcpup/cli <url>

# or install globally → provides the `mcp-check` command
npm i -g @mcpup/cli
mcp-check <url>

# Bun users
bunx @mcpup/cli <url>
```

## Usage

```
mcp-check <url> [options]

  -t, --token <token>     Bearer token (→ Authorization: Bearer <token>)
  -H, --header <k:v>      Additional HTTP header (repeatable)
      --timeout <ms>      Timeout per JSON-RPC request (default 10000)
      --call <tool>       Call a safe tool and validate the shape of its response
      --call-args <json>  JSON arguments for --call (otherwise synthesized from the schema)
      --save-snapshot <f> Write the current schema snapshot to <f>
      --baseline <f>      Compare the current schema to <f> and report the drift
      --json              Machine-readable output (JSON) for CI
  -h, --help · -V, --version
```

### Examples

```bash
# Simple health check
mcp-check https://mcp.example.com/mcp

# With auth
mcp-check https://mcp.example.com/mcp -t "$MCP_TOKEN" -H "X-Tenant: acme"

# Capture a schema baseline, then detect drift later
mcp-check https://mcp.example.com/mcp --save-snapshot mcp.baseline.json
mcp-check https://mcp.example.com/mcp --baseline mcp.baseline.json

# Call a safe tool and validate the shape of its response
mcp-check https://mcp.example.com/mcp --call ping
mcp-check https://mcp.example.com/mcp --call search --call-args '{"q":"test"}'
```

> ⚠️ `--call` actually executes the tool. Only point it at a side-effect-free tool (read-only) — you are the one asserting it is "safe". With **synthetic** arguments, an input validation rejection (`InvalidParams`) is considered *inconclusive* (exit 0); with `--call-args`, it fails the run.

## Exit codes (designed for CI)

| Code | Meaning |
|------|---------------|
| `0`  | `healthy` or `degraded` — reachable and usable |
| `1`  | `unreachable` — transport / handshake failed, timeout |
| `2`  | **silent failure** — `200 OK` hiding a JSON-RPC error or an unreadable payload |
| `3`  | **drift** — the schema changed vs `--baseline` |
| `4`  | **tool call failed** (`--call`) — `isError`, output outside `outputSchema`, or explicit args rejected |
| `64` | CLI misuse |

Precedence: `1 > 2 > 4 > 3 > 0`.

Put `mcp-check --baseline mcp.baseline.json` in your pipeline: the build fails (`exit 3`) as soon as a tool changes its schema without warning.

---

`mcp-check` is the open-source probe of **mcpup** — continuous monitoring (scheduling, history, alerting, status page) for MCP servers.
