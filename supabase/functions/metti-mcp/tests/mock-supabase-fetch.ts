import type { AuthenticatedUser } from "../../_shared/types.ts";
import { MemoryDataClient } from "./fake-client.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestBody(init?: RequestInit): Record<string, unknown> {
  if (typeof init?.body !== "string") return {};
  try {
    const value = JSON.parse(init.body);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  } catch (_) {
    return {};
  }
}

export function createSupabaseFetch(
  db: MemoryDataClient,
  user: AuthenticatedUser,
  validToken = "valid-token",
): typeof fetch {
  return (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const requestUrl = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.href
        : input.url,
    );
    const method =
      (init?.method ?? (input instanceof Request ? input.method : "GET"))
        .toUpperCase();
    const authorization = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    ).get("authorization");

    if (requestUrl.pathname.endsWith("/auth/v1/user")) {
      return authorization === `Bearer ${validToken}`
        ? jsonResponse(user)
        : jsonResponse({ error: "invalid_token" }, 401);
    }

    if (requestUrl.pathname.includes("/storage/v1/object/sign/wardrobe")) {
      if (authorization !== `Bearer ${validToken}`) {
        return jsonResponse({ error: "invalid_token" }, 401);
      }
      const marker = "/storage/v1/object/sign/wardrobe";
      const suffix = requestUrl.pathname.slice(
        requestUrl.pathname.indexOf(marker) + marker.length,
      );
      if (!suffix || suffix === "/") {
        const body = requestBody(init);
        const paths = Array.isArray(body.paths) ? body.paths.map(String) : [];
        return jsonResponse(
          paths.map((path) => ({
            path,
            signedURL: `/object/sign/wardrobe/${path}?token=test`,
          })),
        );
      }
      const path = decodeURIComponent(suffix.replace(/^\//, ""));
      return jsonResponse({
        signedURL: `/object/sign/wardrobe/${path}?token=test`,
      });
    }

    const restMarker = "/rest/v1/";
    const restIndex = requestUrl.pathname.indexOf(restMarker);
    if (restIndex >= 0) {
      if (authorization !== `Bearer ${validToken}`) {
        return jsonResponse({ error: "invalid_token" }, 401);
      }
      const table =
        requestUrl.pathname.slice(restIndex + restMarker.length).split("/")[0];
      const query = requestUrl.searchParams;
      if (method === "GET") {
        return jsonResponse(await db.listRows<unknown>(table, query));
      }
      if (method === "POST") {
        const body = requestBody(init);
        if (table === "profiles") {
          return jsonResponse([
            await db.upsertRow<unknown>(table, query, body),
          ]);
        }
        return jsonResponse([await db.insertRow<unknown>(table, body)]);
      }
      if (method === "PATCH") {
        return jsonResponse(
          await db.updateRows<unknown>(table, query, requestBody(init)),
        );
      }
    }

    return jsonResponse({ error: "not_found" }, 404);
  }) as typeof fetch;
}
