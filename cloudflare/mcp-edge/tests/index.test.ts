import { type Env, handleCloudflareRequest } from "../src/index.ts";

const env: Env = {
  METTI_MCP_UPSTREAM_URL:
    "https://fkicjvawvaddjdmcpiei.supabase.co/functions/v1/metti-mcp",
  MCP_ALLOWED_ORIGINS: "https://chatgpt.com",
  MCP_ALLOWED_HOSTS: "mcp.example.com",
};

Deno.test("Cloudflare edge rejects unauthenticated MCP requests", async () => {
  const response = await handleCloudflareRequest(
    new Request("https://mcp.example.com/mcp", { method: "POST" }),
    env,
    async () => new Response("should not reach origin"),
  );
  if (response.status !== 401) throw new Error("Expected HTTP 401.");
  if (response.headers.get("www-authenticate") !== "Bearer") {
    throw new Error("Expected bearer challenge.");
  }
});

Deno.test("Cloudflare edge forwards MCP auth and protocol headers", async () => {
  let receivedUrl = "";
  let receivedHeaders = new Headers();
  let receivedBody = "";
  const response = await handleCloudflareRequest(
    new Request("https://mcp.example.com/mcp?trace=1", {
      method: "POST",
      headers: {
        origin: "https://chatgpt.com",
        authorization: "Bearer user-token",
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-11-25",
        "mcp-session-id": "session-1",
      },
      body: '{"jsonrpc":"2.0"}',
    }),
    env,
    async (input, init) => {
      const request = new Request(input, init);
      receivedUrl = request.url;
      receivedHeaders = request.headers;
      receivedBody = await request.text();
      return new Response('{"ok":true}', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  );

  if (response.status !== 200) throw new Error("Expected HTTP 200.");
  if (!receivedUrl.includes("/functions/v1/metti-mcp/mcp?trace=1")) {
    throw new Error(`Unexpected upstream URL: ${receivedUrl}`);
  }
  if (receivedHeaders.get("authorization") !== "Bearer user-token") {
    throw new Error("Authorization was not forwarded.");
  }
  if (receivedHeaders.get("mcp-session-id") !== "session-1") {
    throw new Error("MCP session header was not forwarded.");
  }
  if (receivedHeaders.get("origin")) {
    throw new Error(
      "Browser origin must not be forwarded to the origin policy.",
    );
  }
  if (receivedBody !== '{"jsonrpc":"2.0"}') {
    throw new Error("MCP request body was not preserved.");
  }
  if (response.headers.get("x-metti-edge") !== "cloudflare") {
    throw new Error("Cloudflare edge marker is missing.");
  }
  if (
    response.headers.get("access-control-allow-origin") !==
      "https://chatgpt.com"
  ) {
    throw new Error("Configured CORS origin is missing.");
  }
});

Deno.test("Cloudflare edge proxies health and handles preflight", async () => {
  let calls = 0;
  const originFetch = async () => {
    calls += 1;
    return new Response('{"status":"ok"}', {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const health = await handleCloudflareRequest(
    new Request("https://mcp.example.com/health"),
    env,
    originFetch,
  );
  if (health.status !== 200) throw new Error("Expected health HTTP 200.");
  if (calls !== 1) throw new Error("Health did not reach the MCP origin.");

  const preflight = await handleCloudflareRequest(
    new Request("https://mcp.example.com/mcp", {
      method: "OPTIONS",
      headers: { origin: "https://chatgpt.com" },
    }),
    env,
    async () => new Response("should not reach origin"),
  );
  if (preflight.status !== 204) throw new Error("Expected preflight HTTP 204.");
  if (
    preflight.headers.get("access-control-allow-methods")?.includes("POST") !==
      true
  ) {
    throw new Error("Preflight methods are missing.");
  }
});

Deno.test("Cloudflare edge blocks disallowed origins and hosts", async () => {
  const badOrigin = await handleCloudflareRequest(
    new Request("https://mcp.example.com/mcp", {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        authorization: "Bearer user-token",
      },
    }),
    env,
    async () => new Response("should not reach origin"),
  );
  if (badOrigin.status !== 403) throw new Error("Expected origin rejection.");

  const badHost = await handleCloudflareRequest(
    new Request("https://evil.example/mcp", {
      method: "POST",
      headers: { authorization: "Bearer user-token" },
    }),
    env,
    async () => new Response("should not reach origin"),
  );
  if (badHost.status !== 403) throw new Error("Expected host rejection.");
});
