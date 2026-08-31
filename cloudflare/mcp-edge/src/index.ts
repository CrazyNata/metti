export interface Env {
  METTI_MCP_UPSTREAM_URL: string;
  SUPABASE_AUTH_SERVER_URL?: string;
  MCP_ALLOWED_ORIGINS?: string;
  MCP_ALLOWED_HOSTS?: string;
}

type FetchLike = typeof fetch;
type Route = "mcp" | "health" | "protected-resource-metadata";

const allowedMethods = "GET, POST, DELETE, OPTIONS";
const allowedHeaders =
  "authorization, content-type, accept, mcp-protocol-version, mcp-session-id, mcp-method, mcp-name, mcp-param-*, last-event-id";
const forwardedHeaders = [
  "authorization",
  "content-type",
  "accept",
  "mcp-protocol-version",
  "mcp-session-id",
  "last-event-id",
];

function csv(value: string | undefined): string[] {
  return String(value ?? "").split(",").map((item) => item.trim()).filter(
    Boolean,
  );
}

function originAllowed(request: Request, env: Env): boolean {
  const origin = request.headers.get("origin");
  const allowed = csv(env.MCP_ALLOWED_ORIGINS);
  if (!origin || !allowed.length || allowed.includes("*")) return true;
  return allowed.includes(origin);
}

function hostAllowed(request: Request, env: Env): boolean {
  const allowed = csv(env.MCP_ALLOWED_HOSTS).map((item) => item.toLowerCase());
  if (!allowed.length) return true;
  const hostname = new URL(request.url).hostname.toLowerCase();
  return allowed.includes(hostname);
}

function corsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Methods": allowedMethods,
    "Access-Control-Allow-Headers": allowedHeaders,
    "Access-Control-Expose-Headers": "Mcp-Session-Id, WWW-Authenticate",
    Vary: "Origin",
  });
  const allowed = csv(env.MCP_ALLOWED_ORIGINS);
  const origin = request.headers.get("origin");
  if (!allowed.length || allowed.includes("*")) {
    headers.set("Access-Control-Allow-Origin", "*");
  } else if (origin && allowed.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

function jsonResponse(
  body: unknown,
  status: number,
  request: Request,
  env: Env,
  extra: HeadersInit = {},
): Response {
  const headers = corsHeaders(request, env);
  headers.set("Content-Type", "application/json");
  new Headers(extra).forEach((value, key) => headers.set(key, value));
  return new Response(JSON.stringify(body), { status, headers });
}

function withCors(response: Response, request: Request, env: Env): Response {
  const headers = new Headers(response.headers);
  corsHeaders(request, env).forEach((value, key) => headers.set(key, value));
  headers.set("X-Metti-Edge", "cloudflare");
  if (
    response.status === 401 &&
    !/resource_metadata\s*=/i.test(headers.get("WWW-Authenticate") ?? "")
  ) {
    headers.set("WWW-Authenticate", oauthChallenge(request));
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isRoute(pathname: string, route: "mcp" | "health"): boolean {
  return pathname === `/${route}` || pathname === `/${route}/`;
}

function isProtectedResourceMetadataRoute(pathname: string): boolean {
  return [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/",
    "/.well-known/oauth-protected-resource/mcp",
    "/.well-known/oauth-protected-resource/mcp/",
  ].includes(pathname);
}

function authServerUrl(env: Env): string {
  const configured = String(env.SUPABASE_AUTH_SERVER_URL ?? "").trim();
  if (configured) return configured.replace(/\/+$/, "");

  const upstream = new URL(env.METTI_MCP_UPSTREAM_URL);
  return `${upstream.origin}/auth/v1`;
}

function resourceUrl(request: Request): string {
  return `${new URL(request.url).origin}/mcp`;
}

function resourceMetadataUrl(request: Request): string {
  return `${new URL(request.url).origin}/.well-known/oauth-protected-resource`;
}

function oauthChallenge(request: Request): string {
  return `Bearer resource_metadata="${resourceMetadataUrl(request)}", scope="email profile"`;
}

function protectedResourceMetadata(
  request: Request,
  env: Env,
): Record<string, unknown> {
  return {
    resource: resourceUrl(request),
    authorization_servers: [authServerUrl(env)],
    scopes_supported: ["email", "profile"],
    bearer_methods_supported: ["header"],
  };
}

function upstreamUrl(
  request: Request,
  env: Env,
  route: "mcp" | "health",
): URL {
  const value = String(env.METTI_MCP_UPSTREAM_URL ?? "").trim();
  if (!value) throw new Error("MCP upstream is not configured.");
  const upstream = new URL(value);
  if (upstream.protocol !== "https:" && upstream.protocol !== "http:") {
    throw new Error("MCP upstream protocol is invalid.");
  }
  upstream.pathname = `${upstream.pathname.replace(/\/+$/, "")}/${route}`;
  upstream.search = new URL(request.url).search;
  return upstream;
}

function hasBearerToken(request: Request): boolean {
  return /^Bearer\s+\S+\s*$/i.test(request.headers.get("authorization") ?? "");
}

function proxyHeaders(request: Request): Headers {
  const headers = new Headers();
  for (const name of forwardedHeaders) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  for (const [name, value] of request.headers) {
    if (name.toLowerCase().startsWith("mcp-") && !headers.has(name)) {
      headers.set(name, value);
    }
  }
  return headers;
}

async function proxy(
  request: Request,
  env: Env,
  route: "mcp" | "health",
  fetchImpl: FetchLike,
): Promise<Response> {
  let response: Response;
  try {
    const method = request.method.toUpperCase();
    const init: RequestInit = {
      method,
      headers: proxyHeaders(request),
    };
    if (method !== "GET" && method !== "HEAD" && request.body) {
      init.body = request.body;
    }
    response = await fetchImpl(upstreamUrl(request, env, route), init);
  } catch (_) {
    return jsonResponse(
      {
        error: {
          code: "upstream_unavailable",
          message: "MCP origin is unavailable.",
        },
      },
      502,
      request,
      env,
    );
  }
  return withCors(response, request, env);
}

export async function handleCloudflareRequest(
  request: Request,
  env: Env,
  fetchImpl: FetchLike = fetch,
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  const route: Route | null = isProtectedResourceMetadataRoute(pathname)
    ? "protected-resource-metadata"
    : isRoute(pathname, "mcp")
    ? "mcp"
    : isRoute(pathname, "health")
    ? "health"
    : null;

  if (!route) return jsonResponse({ error: "Not found." }, 404, request, env);
  if (!originAllowed(request, env) || !hostAllowed(request, env)) {
    return jsonResponse(
      { error: "Origin or host is not allowed." },
      403,
      request,
      env,
    );
  }
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request, env),
    });
  }

  if (route === "protected-resource-metadata") {
    if (request.method !== "GET") {
      return jsonResponse(
        { error: "Method not allowed." },
        405,
        request,
        env,
        { Allow: "GET, OPTIONS" },
      );
    }
    return jsonResponse(
      protectedResourceMetadata(request, env),
      200,
      request,
      env,
      { "Cache-Control": "public, max-age=300" },
    );
  }

  if (route === "health") {
    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed." }, 405, request, env, {
        Allow: "GET, OPTIONS",
      });
    }
    return proxy(request, env, route, fetchImpl);
  }

  if (!["GET", "POST", "DELETE"].includes(request.method)) {
    return jsonResponse(
      { error: "Method not allowed." },
      405,
      request,
      env,
      { Allow: allowedMethods },
    );
  }
  if (!hasBearerToken(request)) {
    return jsonResponse(
      {
        error: {
          code: "authentication_required",
          message: "Authentication is required.",
        },
      },
      401,
      request,
      env,
      { "WWW-Authenticate": oauthChallenge(request) },
    );
  }
  return proxy(request, env, route, fetchImpl);
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleCloudflareRequest(request, env);
  },
};
