import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import type { AuthConfig } from "./types.ts";

const DEFAULT_CLIENT_INFO = { name: "mcpup", version: "0.0.0" } as const;

export interface ProbeClient {
  client: Client;
  transport: StreamableHTTPClientTransport;
}

/**
 * The MCP SDK validates tool `outputSchema`s with Ajv the moment `tools/list`
 * is cached, and its default Ajv logs `unknown format "<x>" ignored in schema`
 * for any format `ajv-formats` doesn't know. A probe inspects arbitrary,
 * third-party schemas it does not own — non-standard but legitimate formats
 * (OpenAPI/protobuf `int64`, `uint64`, …) are common and not actionable by the
 * probe operator, so those warnings are pure noise.
 *
 * We hand the SDK an Ajv identical to its default but with `logger: false`,
 * which silences the warnings without changing validation (unknown formats are
 * ignored either way; standard formats stay validated via `addFormats`). A
 * fresh instance per client keeps schema compilation isolated between probes
 * (no cross-server `$id` collisions), mirroring the SDK's per-client validator.
 */
function quietJsonSchemaValidator(): AjvJsonSchemaValidator {
  const ajv = new Ajv({
    strict: false,
    validateFormats: true,
    validateSchema: false,
    allErrors: true,
    logger: false,
  });
  addFormats(ajv);
  return new AjvJsonSchemaValidator(ajv);
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

  const client = new Client(clientInfo, {
    capabilities: {},
    jsonSchemaValidator: quietJsonSchemaValidator(),
  });

  return { client, transport };
}
