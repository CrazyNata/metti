import { createMcpHttpHandler, handleMcpRequest } from "../server.ts";
import type { AuthenticatedUser, SupabaseConfig } from "../../_shared/types.ts";
import { assert, assertEquals } from "./assert.ts";
import { MemoryDataClient, outfitRow, wardrobeRow } from "./fake-client.ts";
import { createSupabaseFetch } from "./mock-supabase-fetch.ts";

const userA: AuthenticatedUser = { id: "user-a", email: "a@example.com" };
const config: SupabaseConfig = {
  url: "https://supabase.test",
  publishableKey: "publishable-test-key",
};

const jpegData = "\/9j\/2Q==";

function dependencies(
  db: MemoryDataClient,
  fetchImpl: typeof fetch,
) {
  return {
    config,
    fetchImpl,
    handler: createMcpHttpHandler(config, fetchImpl),
    rateLimiter: { allow: () => true },
  };
}

async function mcpRequest(
  db: MemoryDataClient,
  body: Record<string, unknown>,
  token = "valid-token",
): Promise<{ response: Response; payload: Record<string, any> }> {
  const fetchImpl = createSupabaseFetch(db, userA);
  const response = await handleMcpRequest(
    new Request("https://mcp.example.test/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-11-25",
      },
      body: JSON.stringify(body),
    }),
    dependencies(db, fetchImpl),
  );
  return { response, payload: await mcpPayload(response) };
}

async function mcpPayload(response: Response): Promise<Record<string, any>> {
  const body = await response.text();
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const data = body.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim())
      .join("\n");
    return JSON.parse(data) as Record<string, any>;
  }
  return JSON.parse(body) as Record<string, any>;
}

Deno.test("anonymous and invalid-token MCP requests are rejected", async () => {
  const db = new MemoryDataClient(userA.id);
  const fetchImpl = createSupabaseFetch(db, userA);
  const anonymous = await handleMcpRequest(
    new Request("https://mcp.example.test/mcp", { method: "POST", body: "{}" }),
    dependencies(db, fetchImpl),
  );
  assertEquals(anonymous.status, 401);
  assertEquals(anonymous.headers.get("www-authenticate"), "Bearer");

  const invalid = await mcpRequest(db, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {},
  }, "expired-token");
  assertEquals(invalid.response.status, 401);
  assertEquals(invalid.payload.error.code, "invalid_session");
});

Deno.test("authenticated MCP initializes and exposes strict tool schemas", async () => {
  const db = new MemoryDataClient(userA.id);
  db.seedProfile({
    id: userA.id,
    display_name: "Anna",
    city: "Prague",
    preferences: {},
    style_tags: [],
    style_profile: {},
  });
  const fetchImpl = createSupabaseFetch(db, userA);
  const deps = dependencies(db, fetchImpl);

  const initialize = await handleMcpRequest(
    new Request("https://mcp.example.test/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer valid-token",
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-11-25",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      }),
    }),
    deps,
  );
  assertEquals(initialize.status, 200);
  const initializePayload = await mcpPayload(initialize);
  assertEquals(initializePayload.result.serverInfo.name, "metti-wardrobe");

  const listed = await mcpRequest(db, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  });
  assertEquals(listed.response.status, 200);
  const tools = listed.payload.result.tools as Array<Record<string, any>>;
  const names = tools.map((tool) => tool.name);
  assertEquals(names.length, 20);
  for (const tool of tools) {
    assert(
      typeof tool.description === "string" && tool.description.length > 20,
    );
    assert(tool.inputSchema && tool.inputSchema.type === "object");
  }
  assert(names.includes("get_profile"));
  assert(names.includes("search_wardrobe"));
  assert(names.includes("create_wardrobe_item"));
  assert(names.includes("attach_image_to_wardrobe_item"));
  assert(names.includes("replace_wardrobe_item_image"));
  assert(names.includes("remove_wardrobe_item_image"));
  assert(names.includes("save_outfit"));
  assert(!names.includes("add_wardrobe_item"));
  assert(!names.includes("ask_ai_stylist"));

  const createTool = tools.find((tool) => tool.name === "create_wardrobe_item");
  assert(createTool?.inputSchema.required.includes("name"));
  assert(createTool?.inputSchema.required.includes("category"));
});

Deno.test("authenticated read and write tool calls use shared data and return structured results", async () => {
  const db = new MemoryDataClient(userA.id);
  db.seedProfile({
    id: userA.id,
    display_name: "Anna",
    city: "Prague",
    preferences: { favorite_colors: ["cream"] },
    style_tags: ["minimal"],
    style_profile: {},
  });
  db.seedWardrobe(
    wardrobeRow("a-jacket", userA.id, { name: "Jacket", category: "outer" }),
    wardrobeRow("a-jeans", userA.id, {
      name: "Jeans",
      category: "bottom",
      metadata: { subcategory: "jeans" },
    }),
    wardrobeRow("b-item", "user-b", { name: "Private item", category: "top" }),
  );

  const profile = await mcpRequest(db, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "get_profile", arguments: {} },
  });
  assertEquals(profile.response.status, 200);
  assertEquals(profile.payload.result.structuredContent.displayName, "Anna");
  assert(Array.isArray(profile.payload.result.content));

  const search = await mcpRequest(db, {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "search_wardrobe",
      arguments: { category: "jeans", limit: 10 },
    },
  });
  assertEquals(
    search.payload.result.structuredContent.items.map((
      item: Record<string, unknown>,
    ) => item.id),
    ["a-jeans"],
  );

  const created = await mcpRequest(db, {
    jsonrpc: "2.0",
    id: 45,
    method: "tools/call",
    params: {
      name: "create_wardrobe_item",
      arguments: {
        name: "Black blazer",
        category: "outerwear",
        subcategory: "blazer",
        colors: ["чёрный"],
        seasons: ["осень"],
        styles: ["Minimal"],
        image: { type: "image", data: jpegData, mimeType: "image/jpeg" },
      },
    },
  });
  assertEquals(created.payload.result.structuredContent.imageAttached, true);
  assertEquals(
    created.payload.result.structuredContent.imageStatus,
    "attached",
  );
  const createdId = created.payload.result.structuredContent.id as string;
  assertEquals(db.wardrobe(createdId)?.category, "outer");
  assertEquals(db.wardrobe(createdId)?.color, "black");
  assert(db.wardrobe(createdId)?.image_path?.startsWith(`${userA.id}/`));
  assertEquals(db.uploadedImages.size, 1);

  const foreign = await mcpRequest(db, {
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: { name: "get_wardrobe_item", arguments: { itemId: "b-item" } },
  });
  assertEquals(foreign.payload.result.isError, true);
  assertEquals(
    foreign.payload.result.structuredContent.error.code,
    "not_found",
  );

  const saved = await mcpRequest(db, {
    jsonrpc: "2.0",
    id: 7,
    method: "tools/call",
    params: {
      name: "save_outfit",
      arguments: {
        name: "Weekend layers",
        itemIds: ["a-jacket", "a-jeans"],
        occasion: "casual",
      },
    },
  });
  assertEquals(saved.payload.result.isError, undefined);
  const savedId = saved.payload.result.structuredContent.id as string;
  assert(savedId.length > 0);
  assertEquals(db.outfit(savedId)?.user_id, userA.id);

  const favorited = await mcpRequest(db, {
    jsonrpc: "2.0",
    id: 8,
    method: "tools/call",
    params: {
      name: "favorite_outfit",
      arguments: { outfitId: savedId, favorite: true },
    },
  });
  assertEquals(favorited.payload.result.isError, undefined);
  const favoriteList = await mcpRequest(db, {
    jsonrpc: "2.0",
    id: 9,
    method: "tools/call",
    params: {
      name: "list_outfits",
      arguments: { favorite: true, limit: 10 },
    },
  });
  assertEquals(
    favoriteList.payload.result.structuredContent.items.map(
      (item: Record<string, unknown>) => item.id,
    ),
    [savedId],
  );

  const invalid = await mcpRequest(db, {
    jsonrpc: "2.0",
    id: 10,
    method: "tools/call",
    params: {
      name: "get_wardrobe_item",
      arguments: { itemId: "../other-user-item" },
    },
  });
  assertEquals(invalid.payload.result.isError, true);
  assert(
    invalid.payload.result.content[0].text.includes("Input validation error"),
  );
});
