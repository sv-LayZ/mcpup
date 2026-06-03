import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AuthConfig } from "./types.ts";

const DEFAULT_CLIENT_INFO = { name: "mcp-check", version: "0.0.0" } as const;

export interface ProbeClient {
  client: Client;
  transport: StreamableHTTPClientTransport;
}

/**
 * Builds an MCP client on the official Streamable HTTP transport.
 *
 * We do not reinvent the transport (POST + SSE, session, OAuth refresh): it is
 * a convenience provided by the SDK. The value of the probe is in the
 * validation layer on top (cf. validate.ts), not here.
 */
export function createClient(
  url: string,
  auth?: AuthConfig,
  clientInfo: { name: string; version: string } = DEFAULT_CLIENT_INFO,
): ProbeClient {
  const headers: Record<string, string> = {};
  if (auth?.bearerToken) headers["Authorization"] = `Bearer ${auth.bearerToken}`;
  // Explicit headers take precedence over the derived bearer.
  Object.assign(headers, auth?.headers ?? {});

  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers },
  });

  const client = new Client(clientInfo, { capabilities: {} });

  return { client, transport };
}
