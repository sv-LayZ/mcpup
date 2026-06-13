import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Configurable test MCP server, implementing the minimal Streamable HTTP
 * contract expected by `StreamableHTTPClientTransport`:
 *   - POST `initialize`  → valid result (protocolVersion echoed).
 *   - POST notification  → 202 Accepted, without a body.
 *   - GET  (SSE)         → 405 (tolerated by the client, optional stream).
 *   - DELETE             → 200 (session termination).
 *
 * The `mode` drives the response to `tools/list`, which lets us reproduce
 * exactly the failures the probe must catch — including those a generic
 * uptime monitor would see as "green".
 */
export type FixtureMode =
  | "healthy"
  | "silent-failure"
  | "malformed"
  | "drift"
  | "nonstandard-format";

/** Behavior of `tools/call` (independent of the `tools/list` mode). */
export type CallMode = "success" | "is-error" | "jsonrpc-error" | "invalid-params" | "bad-output";

// `add` declares an outputSchema → the client (Ajv) validates the structuredContent
// returned by tools/call. The `bad-output` mode returns a non-conforming shape.
const ADD_OUTPUT_SCHEMA = {
  type: "object",
  properties: { result: { type: "number" } },
  required: ["result"],
};

const HEALTHY_TOOLS = [
  {
    name: "echo",
    description: "Echo back the provided text.",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  },
  {
    name: "add",
    description: "Add two numbers.",
    inputSchema: {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
    },
    outputSchema: ADD_OUTPUT_SCHEMA,
  },
];

// Identical, except `echo` gained an `upper` property in its inputSchema.
const DRIFT_TOOLS = [
  {
    name: "echo",
    description: "Echo back the provided text.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" }, upper: { type: "boolean" } },
      required: ["text"],
    },
  },
  {
    name: "add",
    description: "Add two numbers.",
    inputSchema: {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
    },
    outputSchema: ADD_OUTPUT_SCHEMA,
  },
];

// A tool whose outputSchema uses a non-standard (OpenAPI/protobuf) integer
// format. `ajv-formats` doesn't know "uint64", so the SDK's default validator
// logs `unknown format … ignored in schema` while compiling it at tools/list.
const NONSTANDARD_FORMAT_TOOLS = [
  {
    name: "reserve",
    description: "Create a reservation.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: { id: { type: "integer", format: "uint64" } },
      required: ["id"],
    },
  },
];

interface RpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: { protocolVersion?: string } & Record<string, unknown>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export interface Fixture {
  url: string;
  setMode(mode: FixtureMode): void;
  setCallMode(mode: CallMode): void;
  close(): Promise<void>;
}

export async function startFixture(initialMode: FixtureMode = "healthy"): Promise<Fixture> {
  let mode = initialMode;
  let callMode: CallMode = "success";

  const server = createServer((req, res) => {
    const httpMethod = req.method ?? "GET";

    // The GET SSE stream is optional: 405 is explicitly tolerated by the client.
    if (httpMethod === "GET") return void res.writeHead(405).end();
    if (httpMethod === "DELETE") return void res.writeHead(200).end();
    if (httpMethod !== "POST") return void res.writeHead(405).end();

    void (async () => {
      const raw = await readBody(req);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return void res.writeHead(400).end();
      }

      const msg = (Array.isArray(parsed) ? parsed[0] : parsed) as RpcMessage | undefined;
      const id = msg?.id;
      const rpcMethod = msg?.method;

      // Notification (no id) → 202 Accepted, without a body.
      if (id === undefined || id === null) return void res.writeHead(202).end();

      const json = (payload: unknown) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };

      if (rpcMethod === "initialize") {
        const protocolVersion = msg?.params?.protocolVersion ?? "2025-06-18";
        return void json({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "fixture", version: "1.0.0" },
          },
        });
      }

      if (rpcMethod === "tools/list") {
        if (mode === "silent-failure") {
          // 200 OK hiding a JSON-RPC error: the canonical silent failure.
          return void json({
            jsonrpc: "2.0",
            id,
            error: { code: -32603, message: "internal explosion hidden behind a 200 OK" },
          });
        }
        if (mode === "malformed") {
          // 200 OK, JSON content-type, but truncated body → JSON.parse fails on the client side.
          res.writeHead(200, { "content-type": "application/json" });
          return void res.end(`{"jsonrpc":"2.0","id":${JSON.stringify(id)},"result":{"tools":[`);
        }
        const tools =
          mode === "drift"
            ? DRIFT_TOOLS
            : mode === "nonstandard-format"
              ? NONSTANDARD_FORMAT_TOOLS
              : HEALTHY_TOOLS;
        return void json({ jsonrpc: "2.0", id, result: { tools } });
      }

      if (rpcMethod === "tools/call") {
        switch (callMode) {
          case "is-error":
            // Tool-level error: 200 OK, valid result, but isError: true.
            return void json({
              jsonrpc: "2.0",
              id,
              result: { content: [{ type: "text", text: "boom" }], isError: true },
            });
          case "jsonrpc-error":
            // Silent failure during the call: 200 OK hiding a JSON-RPC error.
            return void json({
              jsonrpc: "2.0",
              id,
              error: { code: -32603, message: "tool exploded" },
            });
          case "invalid-params":
            return void json({
              jsonrpc: "2.0",
              id,
              error: { code: -32602, message: "missing required field" },
            });
          case "bad-output":
            // structuredContent that does not respect the outputSchema of `add`.
            return void json({
              jsonrpc: "2.0",
              id,
              result: { content: [{ type: "text", text: "?" }], structuredContent: { result: "not-a-number" } },
            });
          default:
            // valid structuredContent → works for echo (without schema) and add.
            return void json({
              jsonrpc: "2.0",
              id,
              result: { content: [{ type: "text", text: "ok" }], structuredContent: { result: 0 } },
            });
        }
      }

      // Any other method → MethodNotFound (the probe does not call any).
      return void json({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${rpcMethod}` },
      });
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    setMode: (m) => {
      mode = m;
    },
    setCallMode: (m) => {
      callMode = m;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}
