# mcpup

> Semantic health monitoring for MCP servers. A "Checkly for MCP" that catches what generic uptime monitors miss: silent failures, schema drift, broken tools.

See [mcpup-brief.md](mcpup-brief.md) for the full product context.

## Packages

| Package | Role |
|---|---|
| [`@mcpup/core`](packages/core) | Probe engine: `initialize` handshake, `tools/list`, strict parsing, schema snapshot & drift. Reusable by the CLI and the future SaaS. |
| [`@mcpup/cli`](packages/cli) | Open-source CLI: one-shot semantic health check. Top-of-funnel of the product. |

## Development

[Bun](https://bun.sh) monorepo (runtime, tests, bundler).

```bash
bun install          # install workspace dependencies
bun test             # runs the whole suite (core + CLI e2e)
bun run check <url>  # run the CLI against an endpoint

# per package
cd packages/core && bun run typecheck
cd packages/cli  && bun run typecheck
```

Publishing the CLI: see [RELEASING.md](RELEASING.md).

## Status

Building block 1 of the brief (§10): the **probe client** that de-risks everything else, shipped as the `mcp-check` CLI.

- ✅ `initialize` handshake + `tools/list` over Streamable HTTP transport (official `@modelcontextprotocol/sdk`).
- ✅ **Silent failure** detection (`200 OK` hiding a JSON-RPC error / unreadable payload).
- ✅ Schema snapshot + **drift detection** (structural diff vs baseline).
- ✅ **Safe tool call** (`--call`): args synthesized from the schema, validation of the shape of the response (isError, `outputSchema` mismatch via Ajv).
- ✅ `mcp-check` CLI with CI exit codes (0/1/2/3/4) and `--json` output.
- ✅ Validated by tests against a hand-rolled fixture **and** a real MCP server from the SDK.

### Next building blocks (out of current scope)

Scheduling & history · alerting (email/Slack/webhook) · dashboard · status page.
