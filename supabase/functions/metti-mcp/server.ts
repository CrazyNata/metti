import {
  type CallToolResult,
  createMcpHandler,
  McpServer,
} from "https://esm.sh/@modelcontextprotocol/server@2.0.0?target=deno";
import * as z from "https://esm.sh/zod@4.2.0?target=deno";

import { authenticateRequest, getSupabaseConfig } from "../_shared/auth.ts";
import { AppError, publicErrorPayload, toAppError } from "../_shared/errors.ts";
import {
  type ImageServiceOptions,
  imageServiceOptionsFromEnv,
} from "../_shared/image-service.ts";
import { createApplicationServices } from "../_shared/services.ts";
import { SupabaseRestClient } from "../_shared/supabase-client.ts";
import type { ApplicationServices } from "../_shared/services.ts";
import type {
  AuthContext,
  AuthenticatedUser,
  JsonObject,
  OutfitListOptions,
  SupabaseConfig,
  WardrobeItemInput,
  WardrobeItemUpdate,
  WardrobeListOptions,
} from "../_shared/types.ts";

export const MCP_VERSION = "1.3.1";

const MCP_INSTRUCTIONS =
  "When the user attaches a photo and asks to add or update a wardrobe item, use the photo-capable wardrobe tool and pass the attachment in its top-level file argument. Do not create a metadata-only item for an attached photo. The backend downloads the temporary file immediately, stores the original separately, processes the card, and only reports imageAttached=true after the Storage links are ready. If the file argument is missing, ask the user to attach the photo again.";

type FetchLike = typeof fetch;
type McpHttpHandler = ReturnType<typeof createMcpHandler>;

const corsMethods = "GET, POST, DELETE, OPTIONS";
const corsHeaders =
  "authorization, content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id";

const categoryInputSchema = z.enum([
  "outer",
  "outerwear",
  "top",
  "bottom",
  "shoes",
  "accessory",
  "jeans",
  "bag",
]);
const statusSchema = z.enum(["active", "archived", "all"]);
const stringListSchema = (maxItems: number, maxLength = 80) =>
  z.array(z.string().trim().min(1).max(maxLength)).max(maxItems);
const idSchema = z.string().trim().min(1).max(128).regex(
  /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
);
const emptySchema = z.object({}).strict();
const imageMimeSchema = z.enum([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);
const imageInputSchema = z.union([
  z.object({
    type: z.literal("image"),
    data: z.string().trim().min(1).max(7_000_000),
    mimeType: imageMimeSchema,
  }).strict(),
  z.object({
    type: z.literal("resource_link"),
    uri: z.string().trim().min(1).max(2048),
    name: z.string().trim().max(160).optional(),
    description: z.string().trim().max(500).optional(),
    mimeType: imageMimeSchema.optional(),
  }).strict(),
  z.object({
    type: z.literal("resource"),
    resource: z.object({
      uri: z.string().trim().min(1).max(2048),
      mimeType: imageMimeSchema.optional(),
      blob: z.string().trim().min(1).max(7_000_000).optional(),
      text: z.string().max(4096).optional(),
    }).strict().refine(
      (resource) =>
        !(resource.blob !== undefined && resource.text !== undefined),
      { message: "A resource must contain blob or text, not both." },
    ),
  }).strict(),
]);
const openAiFileSchema = z.object({
  download_url: z.string().trim().url().max(2048),
  file_id: z.string().trim().min(1).max(256),
  mime_type: imageMimeSchema.optional(),
  file_name: z.string().trim().max(255).optional(),
}).strict();

const profilePreferencesSchema = z.object({
  styleTags: stringListSchema(12).optional(),
  preferredColors: stringListSchema(20, 50).optional(),
  avoidedColors: stringListSchema(20, 50).optional(),
  preferredBrands: stringListSchema(20, 80).optional(),
  dislikedBrands: stringListSchema(20, 80).optional(),
  preferredFits: stringListSchema(12, 50).optional(),
  clothingSizes: z.record(
    z.string().trim().min(1).max(40),
    z.string().trim().max(40),
  ).optional(),
  shoeSize: z.string().trim().max(40).nullable().optional(),
  height: z.number().finite().min(40).max(250).nullable().optional(),
  gender: z.string().trim().max(60).nullable().optional(),
  styleNotes: z.string().trim().max(1000).nullable().optional(),
}).strict();

const listWardrobeSchema = z.object({
  category: categoryInputSchema.optional(),
  subcategory: z.string().trim().min(1).max(80).optional(),
  color: z.string().trim().min(1).max(80).optional(),
  colors: stringListSchema(12, 50).optional(),
  brand: z.string().trim().min(1).max(120).optional(),
  brands: stringListSchema(12, 80).optional(),
  season: z.string().trim().min(1).max(80).optional(),
  seasons: stringListSchema(12, 80).optional(),
  style: z.string().trim().min(1).max(80).optional(),
  styles: stringListSchema(12, 60).optional(),
  length: z.string().trim().min(1).max(80).optional(),
  occasion: z.string().trim().min(1).max(80).optional(),
  occasions: stringListSchema(12, 60).optional(),
  favorite: z.boolean().optional(),
  status: statusSchema.optional().default("active"),
  tags: stringListSchema(20, 50).optional(),
  page: z.number().int().min(1).max(10000).optional().default(1),
  limit: z.number().int().min(1).max(100).optional().default(40),
}).strict();

const searchWardrobeSchema = z.object({
  query: z.string().trim().max(100).optional(),
  category: categoryInputSchema.optional(),
  subcategory: z.string().trim().min(1).max(80).optional(),
  color: z.string().trim().min(1).max(80).optional(),
  colors: stringListSchema(12, 50).optional(),
  brand: z.string().trim().min(1).max(120).optional(),
  brands: stringListSchema(12, 80).optional(),
  season: z.string().trim().min(1).max(80).optional(),
  seasons: stringListSchema(12, 80).optional(),
  style: z.string().trim().min(1).max(80).optional(),
  styles: stringListSchema(12, 60).optional(),
  length: z.string().trim().min(1).max(80).optional(),
  occasion: z.string().trim().min(1).max(80).optional(),
  occasions: stringListSchema(12, 60).optional(),
  favorite: z.boolean().optional(),
  status: statusSchema.optional().default("active"),
  tags: stringListSchema(20, 50).optional(),
  page: z.number().int().min(1).max(10000).optional().default(1),
  limit: z.number().int().min(1).max(100).optional().default(40),
}).strict();

const wardrobeItemFields = {
  name: z.string().trim().min(1).max(160),
  category: categoryInputSchema,
  subcategory: z.string().trim().max(80).optional(),
  brand: z.string().trim().max(120).nullable().optional(),
  color: z.string().trim().max(80).nullable().optional(),
  colors: stringListSchema(12, 50).optional(),
  size: z.string().trim().max(40).nullable().optional(),
  season: z.string().trim().max(80).nullable().optional(),
  seasons: stringListSchema(8, 40).optional(),
  material: z.string().trim().max(80).nullable().optional(),
  pattern: z.string().trim().max(80).nullable().optional(),
  fit: z.string().trim().max(80).nullable().optional(),
  length: z.string().trim().max(80).nullable().optional(),
  styles: stringListSchema(12, 60).optional(),
  occasion: z.string().trim().max(80).nullable().optional(),
  occasions: stringListSchema(12, 60).optional(),
  tags: stringListSchema(20, 50).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  favorite: z.boolean().optional(),
  imagePath: z.string().trim().max(500).nullable().optional(),
  image: imageInputSchema.optional(),
};

const createWardrobeItemSchema = z.object({
  ...wardrobeItemFields,
  // ChatGPT fills this documented top-level file parameter when the user
  // attaches an image. It stays optional for generic MCP clients and the
  // existing metadata-only fallback.
  file: openAiFileSchema.optional(),
}).strict();
const createWardrobeItemWithPhotoSchema = z.object({
  ...wardrobeItemFields,
  file: openAiFileSchema,
}).strict();
const updateWardrobeItemSchema = z.object({
  itemId: idSchema,
  name: wardrobeItemFields.name.optional(),
  category: wardrobeItemFields.category.optional(),
  subcategory: wardrobeItemFields.subcategory,
  brand: wardrobeItemFields.brand,
  color: wardrobeItemFields.color,
  colors: wardrobeItemFields.colors,
  size: wardrobeItemFields.size,
  season: wardrobeItemFields.season,
  seasons: wardrobeItemFields.seasons,
  material: wardrobeItemFields.material,
  pattern: wardrobeItemFields.pattern,
  fit: wardrobeItemFields.fit,
  length: wardrobeItemFields.length,
  styles: wardrobeItemFields.styles,
  occasion: wardrobeItemFields.occasion,
  occasions: wardrobeItemFields.occasions,
  tags: wardrobeItemFields.tags,
  notes: wardrobeItemFields.notes,
  favorite: wardrobeItemFields.favorite,
  imagePath: wardrobeItemFields.imagePath,
  image: wardrobeItemFields.image,
  file: openAiFileSchema.optional(),
}).strict();

const attachImageSchema = z.object({
  itemId: idSchema,
  image: imageInputSchema,
}).strict();

const listOutfitsSchema = z.object({
  favorite: z.boolean().optional(),
  favorites: z.boolean().optional(),
  occasion: z.string().trim().min(1).max(80).optional(),
  season: z.string().trim().min(1).max(80).optional(),
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  tags: stringListSchema(20, 50).optional(),
  status: statusSchema.optional().default("active"),
  page: z.number().int().min(1).max(10000).optional().default(1),
  limit: z.number().int().min(1).max(100).optional().default(40),
}).strict();

const saveOutfitSchema = z.object({
  name: z.string().trim().max(160).optional(),
  itemIds: z.array(idSchema).min(1).max(20),
  occasion: z.string().trim().max(80).nullable().optional(),
  season: z.string().trim().max(80).nullable().optional(),
  notes: z.string().trim().max(1500).nullable().optional(),
  tags: stringListSchema(20, 50).optional(),
  favorite: z.boolean().optional(),
  prompt: z.string().trim().max(1000).nullable().optional(),
  temperatureC: z.number().finite().min(-100).max(100).nullable().optional(),
  weatherCode: z.number().int().min(0).max(200).nullable().optional(),
}).strict();

const updateOutfitSchema = z.object({
  outfitId: idSchema,
  name: z.string().trim().max(160).optional(),
  itemIds: z.array(idSchema).min(1).max(20).optional(),
  occasion: z.string().trim().max(80).nullable().optional(),
  season: z.string().trim().max(80).nullable().optional(),
  notes: z.string().trim().max(1500).nullable().optional(),
  tags: stringListSchema(20, 50).optional(),
  favorite: z.boolean().optional(),
  prompt: z.string().trim().max(1000).nullable().optional(),
}).strict();

const markAsWornSchema = z.object({
  outfitId: idSchema.optional(),
  itemIds: z.array(idSchema).min(1).max(20).optional(),
  wornAt: z.string().trim().max(80).optional(),
}).strict();

const servicesFor = (
  config: SupabaseConfig,
  context: AuthContext,
  fetchImpl: FetchLike,
  imageOptions?: ImageServiceOptions,
): ApplicationServices =>
  createApplicationServices(
    new SupabaseRestClient(config, context.accessToken, fetchImpl),
    context.user,
    {
      image: {
        ...(imageOptions ?? imageServiceOptionsFromEnv()),
        processorAuthToken: context.accessToken,
      },
      wardrobe: { imageOrigin: "mcp" },
    },
  );

const categoryAliases: Record<
  string,
  { category: "outer" | "bottom" | "accessory"; subcategory?: string }
> = {
  outerwear: { category: "outer", subcategory: "outerwear" },
  jeans: { category: "bottom", subcategory: "jeans" },
  bag: { category: "accessory", subcategory: "bag" },
};

function normalizeWardrobeCategoryInput(
  input: Record<string, unknown>,
): WardrobeItemInput {
  const category = typeof input.category === "string"
    ? categoryAliases[input.category]
    : undefined;
  if (!category) return input as unknown as WardrobeItemInput;
  return {
    ...input,
    category: category.category,
    subcategory: input.subcategory ?? category.subcategory,
  } as unknown as WardrobeItemInput;
}

function normalizeWardrobeCreateInput(
  input: Record<string, unknown>,
): WardrobeItemInput {
  const normalized = normalizeWardrobeCategoryInput(input) as unknown as Record<
    string,
    unknown
  >;
  if (normalized.file === undefined) {
    return normalized as unknown as WardrobeItemInput;
  }
  if (normalized.image !== undefined) {
    throw new AppError("invalid_input", "Use file or image, not both.");
  }
  const { file, ...withoutFile } = normalized;
  return {
    ...withoutFile,
    imageFile: file,
  } as unknown as WardrobeItemInput;
}

function normalizeWardrobeUpdateInput(
  input: Record<string, unknown>,
): WardrobeItemUpdate {
  const normalized = normalizeWardrobeCategoryInput(input) as unknown as Record<
    string,
    unknown
  >;
  if (normalized.file === undefined) {
    return normalized as unknown as WardrobeItemUpdate;
  }
  if (normalized.image !== undefined) {
    throw new AppError("invalid_input", "Use file or image, not both.");
  }
  const { file, ...withoutFile } = normalized;
  return {
    ...withoutFile,
    imageFile: file,
  } as unknown as WardrobeItemUpdate;
}

function normalizeWardrobeFilter(
  input: Record<string, unknown>,
): WardrobeListOptions {
  const category = typeof input.category === "string"
    ? categoryAliases[input.category]
    : undefined;
  if (!category) return input as unknown as WardrobeListOptions;
  return {
    ...input,
    category: category.category,
    subcategory: input.subcategory ?? category.subcategory,
  } as unknown as WardrobeListOptions;
}

function normalizeOutfitFilter(
  input: Record<string, unknown>,
): OutfitListOptions {
  const result = { ...input };
  if (result.favorites === undefined && result.favorite !== undefined) {
    result.favorites = result.favorite;
  }
  delete result.favorite;
  return result as unknown as OutfitListOptions;
}

function structured(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

function toolSuccess(value: unknown): CallToolResult {
  const payload = structured(value);
  return {
    structuredContent: payload,
    content: [{ type: "text", text: JSON.stringify(payload) }],
  };
}

function toolFailure(error: unknown): CallToolResult {
  const payload = publicErrorPayload(error);
  return {
    isError: true,
    structuredContent: payload,
    content: [{ type: "text", text: JSON.stringify(payload) }],
  };
}

async function runTool(
  operation: () => Promise<unknown>,
): Promise<CallToolResult> {
  try {
    return toolSuccess(await operation());
  } catch (error) {
    return toolFailure(error);
  }
}

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
};

const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
};

export function registerTools(
  server: McpServer,
  services: ApplicationServices,
): McpServer {
  server.registerTool("get_profile", {
    description:
      "Retrieve the authenticated user profile relevant to personal styling. Use this before making recommendations when fit, sizes, colors or style context matter. This reads only the current user profile.",
    inputSchema: emptySchema,
    annotations: readAnnotations,
  }, () => runTool(() => services.profile.get()));

  server.registerTool("get_style_preferences", {
    description:
      "Retrieve the authenticated user’s saved style preferences, including preferred and avoided colors, brands, fits and notes. Use this when tailoring wardrobe analysis or outfit suggestions.",
    inputSchema: emptySchema,
    annotations: readAnnotations,
  }, () => runTool(() => services.profile.getPreferences()));

  server.registerTool("update_style_preferences", {
    description:
      "Update the authenticated user’s saved style preferences. This changes the user profile; send only fields the user explicitly provided and omit unchanged fields.",
    inputSchema: profilePreferencesSchema,
    annotations: writeAnnotations,
  }, (args) => runTool(() => services.profile.updatePreferences(args)));

  server.registerTool("list_wardrobe", {
    description:
      "Retrieve clothing items from the authenticated user’s wardrobe. Use this for outfit recommendations, packing, wardrobe analysis or finding clothes the user already owns. Results are paginated and active items are returned by default. The category aliases jeans and bag map to the existing bottom/accessory categories with matching subcategories.",
    inputSchema: listWardrobeSchema,
    annotations: readAnnotations,
  }, (args) =>
    runTool(() =>
      services.wardrobe.list(
        normalizeWardrobeFilter(args as Record<string, unknown>),
      )
    ));

  server.registerTool("search_wardrobe", {
    description:
      "Search the authenticated user’s wardrobe by free-text query and optional categories, colors, brands, seasons, occasions, tags or favorite state. Use this to narrow candidates before composing an outfit; it never searches other users’ items. The category aliases jeans and bag map to the existing bottom/accessory categories with matching subcategories.",
    inputSchema: searchWardrobeSchema,
    annotations: readAnnotations,
  }, (args) =>
    runTool(() =>
      services.wardrobe.search(
        normalizeWardrobeFilter(args as Record<string, unknown>),
      )
    ));

  server.registerTool("get_wardrobe_item", {
    description:
      "Retrieve full details for one wardrobe item owned by the authenticated user, including a short-lived signed image URL when an image exists. Use this after finding a candidate item by id.",
    inputSchema: z.object({ itemId: idSchema }).strict(),
    annotations: readAnnotations,
  }, (args) => runTool(() => services.wardrobe.get(args.itemId)));

  server.registerTool("create_wardrobe_item_with_photo", {
    description:
      "Create a clothing or accessory item from the photo attached in the current ChatGPT message. This is the required tool for an attached photo: pass the attachment in the top-level file parameter. The backend downloads the temporary file immediately, stores originalImage separately, runs the category-aware wardrobe image-processing service, validates the result and stores a square processed card only after quality is sufficient. Do not invent unknown characteristics. If the photo is unavailable, do not call this tool; ask the user to attach it again.",
    inputSchema: createWardrobeItemWithPhotoSchema,
    _meta: { "openai/fileParams": ["file"] },
    annotations: { ...writeAnnotations, idempotentHint: false },
  }, (args) =>
    runTool(() =>
      services.wardrobe.add(
        normalizeWardrobeCreateInput(args as Record<string, unknown>),
      )
    ));

  server.registerTool("create_wardrobe_item", {
    description:
      "Create a clothing or accessory item in the authenticated user's wardrobe without requiring a photo. Use create_wardrobe_item_with_photo when the user attached a photo; never silently omit an attached file. If the user supplied an image through another MCP client, use the image parameter. Infer only reliable characteristics and do not invent an unknown brand, material or size. The backend stores originalImage separately, runs the shared wardrobe image-processing service with wardrobe_card or eyewear_card automatically, validates the result and stores a square processed card when quality is sufficient. If processing is unavailable or quality is unsafe, the original remains visible with imageStatus=needs_review; it is never reported as attached processed output. Do not send user_id: ownership comes from the bearer token.",
    inputSchema: createWardrobeItemSchema,
    _meta: { "openai/fileParams": ["file"] },
    annotations: { ...writeAnnotations, idempotentHint: false },
  }, (args) =>
    runTool(() =>
      services.wardrobe.add(
        normalizeWardrobeCreateInput(args as Record<string, unknown>),
      )
    ));

  server.registerTool("add_wardrobe_item", {
    description:
      "Add a clothing or accessory item from the photo attached in the current ChatGPT message. The top-level file parameter is required for this tool. The backend downloads the attachment immediately, stores originalImage separately, runs the category-aware wardrobe/eyewear card pipeline and only reports imageStatus=attached after the processed image is uploaded and linked. Do not call this tool without file and do not send user_id; ownership comes from the bearer token. For metadata without a photo, use create_wardrobe_item.",
    inputSchema: createWardrobeItemWithPhotoSchema,
    _meta: { "openai/fileParams": ["file"] },
    annotations: { ...writeAnnotations, idempotentHint: false },
  }, (args) =>
    runTool(() =>
      services.wardrobe.add(
        normalizeWardrobeCreateInput(args as Record<string, unknown>),
      )
    ));

  server.registerTool("update_wardrobe_item", {
    description:
      "Edit one wardrobe item owned by the authenticated user. This changes user data. Pass file when ChatGPT provides a new photo; the server downloads it, validates it and replaces the existing private Storage image without creating a duplicate item. imagePath is only for a file that is already in the user's private Storage folder. Do not send file and imagePath together or send user_id; ownership is checked from the bearer token and at the database RLS layer.",
    inputSchema: updateWardrobeItemSchema,
    _meta: { "openai/fileParams": ["file"] },
    annotations: writeAnnotations,
  }, (args) => {
    const { itemId, ...changes } = args;
    return runTool(() =>
      services.wardrobe.update(
        itemId,
        normalizeWardrobeUpdateInput(changes as Record<string, unknown>),
      )
    );
  });

  server.registerTool("archive_wardrobe_item", {
    description:
      "Soft-archive one wardrobe item owned by the authenticated user. This changes user data but keeps the database row recoverable for future restore tooling; archived items are excluded from lists by default.",
    inputSchema: z.object({ itemId: idSchema }).strict(),
    annotations: { ...writeAnnotations, destructiveHint: true },
  }, (args) => runTool(() => services.wardrobe.archive(args.itemId)));

  server.registerTool(
    "attach_image_to_wardrobe_item",
    {
      description:
        "Attach an available user-provided image resource to an existing wardrobe item owned by the authenticated user. Use this only when the MCP client provides an image, resource_link or embedded resource. The backend keeps the original, runs the shared category-aware image pipeline and stores a processed wardrobe card only after quality validation; use replace_wardrobe_item_image when the item already has a photo.",
      inputSchema: attachImageSchema,
      annotations: { ...writeAnnotations, idempotentHint: false },
    },
    (args) =>
      runTool(() => services.wardrobe.attachImage(args.itemId, args.image)),
  );

  server.registerTool(
    "replace_wardrobe_item_image",
    {
      description:
        "Replace the photo of an existing wardrobe item owned by the authenticated user with an available MCP image or resource. The backend stores a new original version, processes it through the shared wardrobe/eyewear pipeline, links the processed card only after validation and keeps the old image until the new link is ready.",
      inputSchema: attachImageSchema,
      annotations: { ...writeAnnotations, idempotentHint: false },
    },
    (args) =>
      runTool(() => services.wardrobe.replaceImage(args.itemId, args.image)),
  );

  server.registerTool("remove_wardrobe_item_image", {
    description:
      "Remove the photo from a wardrobe item owned by the authenticated user. This deletes the linked object from the existing private Storage bucket and keeps the wardrobe item itself.",
    inputSchema: z.object({ itemId: idSchema }).strict(),
    annotations: { ...writeAnnotations, destructiveHint: true },
  }, (args) => runTool(() => services.wardrobe.removeImage(args.itemId)));

  server.registerTool("list_outfits", {
    description:
      "List saved outfits belonging to the authenticated user with optional favorite, occasion, season, date, tag and status filters. Use this to review saved looks; call get_outfit for full item details.",
    inputSchema: listOutfitsSchema,
    annotations: readAnnotations,
  }, (args) =>
    runTool(() =>
      services.outfits.list(
        normalizeOutfitFilter(args as Record<string, unknown>),
      )
    ));

  server.registerTool("get_outfit", {
    description:
      "Retrieve one saved outfit owned by the authenticated user, including its wardrobe item details and signed image URLs where available.",
    inputSchema: z.object({ outfitId: idSchema }).strict(),
    annotations: readAnnotations,
  }, (args) => runTool(() => services.outfits.get(args.outfitId)));

  server.registerTool("save_outfit", {
    description:
      "Save an outfit made from the authenticated user’s existing wardrobe items. This changes user data. itemIds must refer to items the same authenticated user owns; the server verifies them and never accepts a user_id argument.",
    inputSchema: saveOutfitSchema,
    annotations: { ...writeAnnotations, idempotentHint: false },
  }, (args) => runTool(() => services.outfits.save(args)));

  server.registerTool("update_outfit", {
    description:
      "Edit a saved outfit owned by the authenticated user. This changes user data and validates every replacement item id against that same user’s wardrobe.",
    inputSchema: updateOutfitSchema,
    annotations: writeAnnotations,
  }, (args) => {
    const { outfitId, ...changes } = args;
    return runTool(() => services.outfits.update(outfitId, changes));
  });

  server.registerTool("archive_outfit", {
    description:
      "Soft-archive a saved outfit owned by the authenticated user. This changes user data while keeping the row for possible future restore; archived outfits are hidden from default lists.",
    inputSchema: z.object({ outfitId: idSchema }).strict(),
    annotations: { ...writeAnnotations, destructiveHint: true },
  }, (args) => runTool(() => services.outfits.archive(args.outfitId)));

  server.registerTool(
    "favorite_outfit",
    {
      description:
        "Set or clear the favorite flag for a saved outfit owned by the authenticated user. This changes user data and is safe to repeat with the same value.",
      inputSchema: z.object({ outfitId: idSchema, favorite: z.boolean() })
        .strict(),
      annotations: writeAnnotations,
    },
    (args) =>
      runTool(() => services.outfits.favorite(args.outfitId, args.favorite)),
  );

  server.registerTool("get_wear_history", {
    description:
      "Retrieve recent outfits marked as worn by the authenticated user. Use this to answer questions about repeated looks or items that have not been used recently.",
    inputSchema: z.object({
      page: z.number().int().min(1).max(10000).optional().default(1),
      limit: z.number().int().min(1).max(100).optional().default(40),
    }).strict(),
    annotations: readAnnotations,
  }, (args) => runTool(() => services.outfits.getWearHistory(args)));

  server.registerTool("mark_as_worn", {
    description:
      "Mark an existing saved outfit as worn, or record a worn set of the authenticated user’s wardrobe items as a new wear-history entry. This changes user data. Provide outfitId or itemIds; never provide user_id.",
    inputSchema: markAsWornSchema,
    annotations: writeAnnotations,
  }, (args) => runTool(() => services.outfits.markAsWorn(args)));

  return server;
}

export function createMcpHttpHandler(
  config: SupabaseConfig,
  fetchImpl: FetchLike = fetch,
  imageOptions?: ImageServiceOptions,
): McpHttpHandler {
  return createMcpHandler(({ authInfo }) => {
    const user = authInfo?.extra?.mettiUser as AuthenticatedUser | undefined;
    const accessToken = typeof authInfo?.token === "string"
      ? authInfo.token
      : "";
    if (!user?.id || !accessToken) {
      throw new AppError(
        "authentication_required",
        "Authentication is required.",
        401,
      );
    }
    const context: AuthContext = {
      accessToken,
      authorization: `Bearer ${accessToken}`,
      user,
    };
    return registerTools(
      new McpServer(
        { name: "metti-wardrobe", version: MCP_VERSION },
        { instructions: MCP_INSTRUCTIONS },
      ),
      servicesFor(config, context, fetchImpl, imageOptions),
    );
  });
}

class FixedWindowRateLimiter {
  private readonly buckets = new Map<
    string,
    { startedAt: number; count: number }
  >();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
  ) {}

  allow(key: string, now = Date.now()): boolean {
    const current = this.buckets.get(key);
    if (!current || now - current.startedAt >= this.windowMs) {
      this.buckets.set(key, { startedAt: now, count: 1 });
      return true;
    }
    if (current.count >= this.limit) return false;
    current.count += 1;
    return true;
  }
}

let defaultRateLimiter: FixedWindowRateLimiter | null = null;
let defaultHandler: McpHttpHandler | null = null;
let defaultHandlerConfig = "";

function envNumber(
  name: string,
  fallback: number,
  env: typeof Deno.env = Deno.env,
): number {
  const value = Number(env.get(name));
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function imageOptionsFromEnv(
  env: typeof Deno.env = Deno.env,
): ImageServiceOptions {
  return imageServiceOptionsFromEnv(
    env,
    "https://metti-image-processor.road-guide-natasha7261.workers.dev/process",
  );
}

function getDefaultRateLimiter(): FixedWindowRateLimiter {
  if (!defaultRateLimiter) {
    defaultRateLimiter = new FixedWindowRateLimiter(
      envNumber("MCP_RATE_LIMIT_PER_MINUTE", 120),
    );
  }
  return defaultRateLimiter;
}

function getDefaultHandler(
  config: SupabaseConfig,
  fetchImpl: FetchLike = fetch,
): McpHttpHandler {
  const imageOptions = imageOptionsFromEnv();
  const key = `${config.url}|${config.publishableKey}|${
    JSON.stringify(imageOptions)
  }`;
  if (!defaultHandler || defaultHandlerConfig !== key) {
    defaultHandler = createMcpHttpHandler(config, fetchImpl, imageOptions);
    defaultHandlerConfig = key;
  }
  return defaultHandler;
}

function configuredOrigins(env: typeof Deno.env = Deno.env): string[] {
  return String(env.get("MCP_ALLOWED_ORIGINS") ?? "").split(",").map((value) =>
    value.trim()
  ).filter(Boolean);
}

function configuredHosts(env: typeof Deno.env = Deno.env): string[] {
  return String(env.get("MCP_ALLOWED_HOSTS") ?? "").split(",").map((value) =>
    value.trim().toLowerCase()
  ).filter(Boolean);
}

function originAllowed(
  request: Request,
  env: typeof Deno.env = Deno.env,
): boolean {
  const origin = request.headers.get("origin");
  const allowed = configuredOrigins(env);
  if (!origin || !allowed.length || allowed.includes("*")) return true;
  return allowed.includes(origin);
}

function hostAllowed(
  request: Request,
  env: typeof Deno.env = Deno.env,
): boolean {
  const allowed = configuredHosts(env);
  if (!allowed.length) return true;
  const host = request.headers.get("host") ?? "";
  let hostname = "";
  try {
    hostname = new URL(`http://${host}`).hostname.toLowerCase();
  } catch (_) {
    return false;
  }
  return allowed.includes(hostname) || allowed.includes(host.toLowerCase());
}

function headersFor(request: Request): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Methods": corsMethods,
    "Access-Control-Allow-Headers": corsHeaders,
    "Access-Control-Expose-Headers": "Mcp-Session-Id, WWW-Authenticate",
    Vary: "Origin",
  });
  const configured = configuredOrigins();
  const origin = request.headers.get("origin");
  if (!configured.length || configured.includes("*")) {
    headers.set("Access-Control-Allow-Origin", "*");
  } else if (origin && configured.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

function jsonResponse(
  body: unknown,
  status: number,
  request: Request,
  extra: HeadersInit = {},
): Response {
  const headers = headersFor(request);
  headers.set("Content-Type", "application/json");
  new Headers(extra).forEach((value, key) => headers.set(key, value));
  return new Response(JSON.stringify(body), { status, headers });
}

function withCors(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  headersFor(request).forEach((value, key) => {
    if (!headers.has(key)) headers.set(key, value);
  });
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function limitRequestBody(
  request: Request,
  maxBytes: number,
): Promise<Request | null> {
  if (!request.body || request.method === "GET") return request;
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > maxBytes) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = new Uint8Array(next.value);
      total += chunk.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const headers = new Headers(request.headers);
  headers.set("content-length", String(total));
  return new Request(request, { body, headers });
}

function health(request: Request): Response {
  let configured = true;
  try {
    getSupabaseConfig();
  } catch (_) {
    configured = false;
  }
  return jsonResponse(
    {
      status: configured ? "ok" : "degraded",
      service: "metti-mcp",
      version: MCP_VERSION,
      transport: "streamable-http",
      checks: { supabaseConfigured: configured },
    },
    configured ? 200 : 503,
    request,
  );
}

export interface McpRequestDependencies {
  config?: SupabaseConfig;
  fetchImpl?: FetchLike;
  handler?: McpHttpHandler;
  rateLimiter?: { allow(key: string): boolean };
}

export async function handleMcpRequest(
  request: Request,
  dependencies: McpRequestDependencies = {},
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: headersFor(request) });
  }
  if (!originAllowed(request) || !hostAllowed(request)) {
    return jsonResponse(
      { error: "Origin or host is not allowed." },
      403,
      request,
    );
  }
  if (new URL(request.url).pathname.endsWith("/health")) return health(request);
  if (!["GET", "POST", "DELETE"].includes(request.method)) {
    return jsonResponse({ error: "Method not allowed." }, 405, request, {
      Allow: "GET, POST, DELETE, OPTIONS",
    });
  }
  const maxBodyBytes = envNumber("MCP_MAX_BODY_BYTES", 8 * 1024 * 1024);
  const boundedRequest = await limitRequestBody(request, maxBodyBytes);
  if (!boundedRequest) {
    return jsonResponse({ error: "Request body is too large." }, 413, request);
  }

  let context: AuthContext;
  let config: SupabaseConfig;
  try {
    config = dependencies.config ?? getSupabaseConfig();
    context = await authenticateRequest(
      request,
      config,
      dependencies.fetchImpl ?? fetch,
    );
  } catch (error) {
    const safe = toAppError(error);
    return jsonResponse(
      publicErrorPayload(safe),
      safe.status,
      request,
      safe.code === "authentication_required" || safe.code === "invalid_session"
        ? { "WWW-Authenticate": "Bearer" }
        : {},
    );
  }

  const limiter = dependencies.rateLimiter ?? getDefaultRateLimiter();
  if (!limiter.allow(context.user.id)) {
    return jsonResponse(
      { error: { code: "rate_limited", message: "Too many requests." } },
      429,
      request,
      { "Retry-After": "60" },
    );
  }

  const authInfo = {
    token: context.accessToken,
    clientId: context.user.id,
    scopes: [] as string[],
    expiresAt: Math.floor(Date.now() / 1000) + 300,
    extra: { mettiUser: context.user } as unknown as JsonObject,
  };
  try {
    const handler = dependencies.handler ??
      getDefaultHandler(config, dependencies.fetchImpl ?? fetch);
    return withCors(
      await handler.fetch(boundedRequest, { authInfo }),
      request,
    );
  } catch (error) {
    console.error("metti-mcp request failed", error);
    return jsonResponse(
      { error: { code: "internal_error", message: "Internal server error." } },
      500,
      request,
    );
  }
}
