import { AppError } from "./errors.ts";
import {
  asJsonObject,
  stringList,
  wardrobeItemFromRow,
} from "./serializers.ts";
import type { UserDataClient } from "./supabase-client.ts";
import {
  type AuthenticatedUser,
  type JsonObject,
  type Page,
  WARDROBE_CATEGORIES,
  type WardrobeItemDto,
  type WardrobeItemInput,
  type WardrobeItemRow,
  type WardrobeItemUpdate,
  type WardrobeListOptions,
} from "./types.ts";
import {
  idArray,
  idValue,
  limitValue,
  lower,
  optionalString,
  pageValue,
  requiredString,
  safeImagePath,
  searchTerm,
  stringArray,
  wardrobeMetadata,
} from "./validation.ts";

export const WARDROBE_SELECT = [
  "id",
  "user_id",
  "name",
  "category",
  "color",
  "size",
  "season",
  "brand",
  "notes",
  "image_path",
  "metadata",
  "created_at",
  "updated_at",
  "archived_at",
].join(",");

const PAGE_MAX = 10_000;
const LIST_MAX = 100;

function queryValue(value: string): string {
  return value.replace(/[*,%(),]/g, " ").trim();
}

function categoryValue(value: unknown): WardrobeItemInput["category"] {
  if (
    typeof value !== "string" ||
    !WARDROBE_CATEGORIES.includes(value as WardrobeItemInput["category"])
  ) {
    throw new AppError("invalid_input", "category is invalid.");
  }
  return value as WardrobeItemInput["category"];
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function rowMatches(
  row: WardrobeItemRow,
  options: WardrobeListOptions,
): boolean {
  const metadata = asJsonObject(row.metadata);
  const status = row.archived_at || metadata.status === "archived"
    ? "archived"
    : "active";
  const requestedStatus = options.status ?? "active";
  if (requestedStatus !== "all" && status !== requestedStatus) return false;
  if (options.category && row.category !== options.category) return false;
  if (
    options.subcategory &&
    lower(metadata.subcategory) !== lower(options.subcategory)
  ) return false;
  const availableColors = [
    ...stringList(metadata.colors),
    ...stringList(row.color),
  ];
  const colors = options.colors?.length
    ? options.colors
    : options.color
    ? [options.color]
    : [];
  const brands = options.brands?.length
    ? options.brands
    : options.brand
    ? [options.brand]
    : [];
  const seasons = options.seasons?.length
    ? options.seasons
    : options.season
    ? [options.season]
    : [];
  if (
    colors.length &&
    !colors.some((value) =>
      availableColors.some((candidate) =>
        lower(candidate).includes(lower(value))
      )
    )
  ) return false;
  if (
    brands.length &&
    !brands.some((value) => lower(row.brand).includes(lower(value)))
  ) return false;
  if (
    seasons.length &&
    !seasons.some((value) => lower(row.season).includes(lower(value)))
  ) return false;
  const occasions = options.occasions?.length
    ? options.occasions
    : options.occasion
    ? [options.occasion]
    : [];
  if (
    occasions.length &&
    !occasions.some((occasion) =>
      stringList(metadata.occasions ?? metadata.occasion)
        .some((value) => lower(value) === lower(occasion))
    )
  ) return false;
  if (
    options.favorite !== undefined &&
    Boolean(metadata.favorite) !== options.favorite
  ) return false;
  if (options.tags?.length) {
    const tags = stringList(metadata.tags).map(lower);
    if (!options.tags.every((tag) => tags.includes(lower(tag)))) return false;
  }
  if (options.query) {
    const term = lower(options.query);
    const searchable = [
      row.name,
      row.category,
      row.color,
      row.brand,
      row.season,
      row.notes,
      metadata.subcategory,
    ]
      .map(lower).join(" ");
    if (!searchable.includes(term)) return false;
  }
  return true;
}

function hasWardrobeExtensions(
  input: WardrobeItemInput | WardrobeItemUpdate,
): boolean {
  return [
    "subcategory",
    "colors",
    "material",
    "pattern",
    "fit",
    "occasion",
    "occasions",
    "tags",
    "favorite",
  ].some((key) => hasOwn(input, key));
}

export class WardrobeService {
  constructor(
    private readonly client: UserDataClient,
    private readonly user: AuthenticatedUser,
  ) {}

  private async withImageUrls(
    rows: WardrobeItemRow[],
  ): Promise<WardrobeItemDto[]> {
    const paths = rows.map((row) => row.image_path).filter((
      path,
    ): path is string => Boolean(path));
    let urls = new Map<string, string>();
    if (paths.length) {
      try {
        urls = await this.client.createSignedUrls("wardrobe", paths, 900);
      } catch (_) {
        // Image URLs are optional. A Storage outage must not hide wardrobe data.
      }
    }
    return rows.map((row) =>
      wardrobeItemFromRow(
        row,
        row.image_path ? urls.get(row.image_path) ?? null : null,
      )
    );
  }

  private baseQuery(options: WardrobeListOptions): URLSearchParams {
    const page = pageValue(options.page, 1, PAGE_MAX);
    const limit = limitValue(options.limit, 40, LIST_MAX);
    const query = new URLSearchParams({
      select: WARDROBE_SELECT,
      order: "created_at.desc,id.desc",
      limit: String(limit + 1),
      offset: String((page - 1) * limit),
    });
    const status = options.status ?? "active";
    if (status === "active") query.set("archived_at", "is.null");
    if (status === "archived") query.set("archived_at", "not.is.null");
    if (options.category) {
      query.set("category", `eq.${queryValue(options.category)}`);
    }
    if (options.color) {
      query.set("color", `ilike.*${queryValue(options.color)}*`);
    }
    if (options.brand) {
      query.set("brand", `ilike.*${queryValue(options.brand)}*`);
    }
    if (options.season) {
      query.set("season", `ilike.*${queryValue(options.season)}*`);
    }
    if (options.subcategory) {
      query.set(
        "metadata->>subcategory",
        `eq.${queryValue(options.subcategory)}`,
      );
    }
    if (options.occasion) {
      query.set("metadata->>occasion", `eq.${queryValue(options.occasion)}`);
    }
    if (options.favorite !== undefined) {
      query.set("metadata->>favorite", `eq.${options.favorite}`);
    }
    if (options.tags?.length) {
      query.set("metadata->tags", `cs.${JSON.stringify(options.tags)}`);
    }
    if (options.query) {
      const term = queryValue(options.query);
      query.set(
        "or",
        `(name.ilike.*${term}*,color.ilike.*${term}*,brand.ilike.*${term}*,notes.ilike.*${term}*)`,
      );
    }
    return query;
  }

  async list(
    options: WardrobeListOptions = {},
  ): Promise<Page<WardrobeItemDto>> {
    const page = pageValue(options.page, 1, PAGE_MAX);
    const limit = limitValue(options.limit, 40, LIST_MAX);
    const rows = await this.client.listRows<WardrobeItemRow>(
      "wardrobe_items",
      this.baseQuery(options),
    );
    const matched = rows.filter((row) => rowMatches(row, options));
    const pageRows = matched.slice(0, limit);
    const items = await this.withImageUrls(pageRows);
    const hasMore = rows.length > limit || matched.length > limit;
    return {
      items,
      pagination: { page, limit, hasMore, nextPage: hasMore ? page + 1 : null },
    };
  }

  async search(
    options: WardrobeListOptions = {},
  ): Promise<Page<WardrobeItemDto>> {
    const query = searchTerm(options.query);
    return this.list({ ...options, query, limit: options.limit ?? 40 });
  }

  async getRow(
    itemId: unknown,
    includeArchived = true,
  ): Promise<WardrobeItemRow> {
    const id = idValue(itemId, "itemId");
    const query = new URLSearchParams({
      select: WARDROBE_SELECT,
      id: `eq.${id}`,
      limit: "1",
    });
    if (!includeArchived) query.set("archived_at", "is.null");
    const rows = await this.client.listRows<WardrobeItemRow>(
      "wardrobe_items",
      query,
    );
    const row = rows[0];
    if (!row) throw new AppError("not_found", "Wardrobe item not found.", 404);
    return row;
  }

  async get(itemId: unknown): Promise<WardrobeItemDto> {
    return (await this.withImageUrls([await this.getRow(itemId)]))[0];
  }

  async getRowsByIds(
    itemIds: string[],
    includeArchived = true,
  ): Promise<WardrobeItemRow[]> {
    if (!itemIds.length) return [];
    const ids = idArray(itemIds, "itemIds", 1, 100);
    const query = new URLSearchParams({
      select: WARDROBE_SELECT,
      id: `in.(${ids.join(",")})`,
      limit: String(ids.length),
    });
    if (!includeArchived) query.set("archived_at", "is.null");
    return this.client.listRows<WardrobeItemRow>("wardrobe_items", query);
  }

  async assertOwnedItemIds(
    itemIds: unknown,
    allowArchived = false,
  ): Promise<string[]> {
    const ids = idArray(itemIds, "itemIds", 1, 20);
    const rows = await this.getRowsByIds(ids, allowArchived);
    if (rows.length !== ids.length) {
      // The RLS-filtered query intentionally gives the same answer for a missing
      // item and an item belonging to another user.
      throw new AppError(
        "not_found",
        "One or more wardrobe items were not found.",
        404,
      );
    }
    return ids;
  }

  async getDtosByIds(
    itemIds: string[],
    includeArchived = true,
  ): Promise<WardrobeItemDto[]> {
    return this.withImageUrls(
      await this.getRowsByIds(itemIds, includeArchived),
    );
  }

  async add(input: WardrobeItemInput): Promise<WardrobeItemDto> {
    const name = requiredString(input.name, "name", 160);
    const category = categoryValue(input.category);
    const color = optionalString(input.color, "color", 80);
    const colors = stringArray(input.colors, "colors", 12, 50);
    const imagePath = safeImagePath(input.imagePath, this.user.id);
    const payload = {
      user_id: this.user.id,
      name,
      category,
      color: color === undefined ? colors?.[0] ?? null : color,
      size: optionalString(input.size, "size", 40) ?? null,
      season: optionalString(input.season, "season", 80) ?? null,
      brand: optionalString(input.brand, "brand", 120) ?? null,
      notes: optionalString(input.notes, "notes", 1000) ?? null,
      image_path: imagePath ?? null,
      metadata: wardrobeMetadata({ ...input, name, category }, {}, "active"),
    };
    const row = await this.client.insertRow<WardrobeItemRow>(
      "wardrobe_items",
      payload,
    );
    if (!row?.id) {
      throw new AppError(
        "data_access_error",
        "Не удалось сохранить вещь.",
        502,
      );
    }
    return this.get(row.id);
  }

  async update(
    itemId: unknown,
    input: WardrobeItemUpdate,
  ): Promise<WardrobeItemDto> {
    const current = await this.getRow(itemId);
    const patch: Record<string, unknown> = {};
    if (hasOwn(input, "name")) {
      patch.name = requiredString(input.name, "name", 160);
    }
    if (hasOwn(input, "category")) {
      patch.category = categoryValue(input.category);
    }
    if (hasOwn(input, "color")) {
      patch.color = optionalString(input.color, "color", 80) ?? null;
    }
    if (hasOwn(input, "size")) {
      patch.size = optionalString(input.size, "size", 40) ?? null;
    }
    if (hasOwn(input, "season")) {
      patch.season = optionalString(input.season, "season", 80) ?? null;
    }
    if (hasOwn(input, "brand")) {
      patch.brand = optionalString(input.brand, "brand", 120) ?? null;
    }
    if (hasOwn(input, "notes")) {
      patch.notes = optionalString(input.notes, "notes", 1000) ?? null;
    }
    if (hasOwn(input, "imagePath")) {
      patch.image_path = safeImagePath(input.imagePath, this.user.id) ?? null;
    }
    if (hasWardrobeExtensions(input)) {
      patch.metadata = wardrobeMetadata(input, current.metadata);
    }
    if (!Object.keys(patch).length) {
      throw new AppError("invalid_input", "At least one field is required.");
    }

    const query = new URLSearchParams({
      id: `eq.${idValue(itemId, "itemId")}`,
      limit: "1",
    });
    const rows = await this.client.updateRows<WardrobeItemRow>(
      "wardrobe_items",
      query,
      patch,
    );
    if (!rows[0]) {
      throw new AppError("not_found", "Wardrobe item not found.", 404);
    }
    return this.get(rows[0].id);
  }

  async archive(itemId: unknown): Promise<WardrobeItemDto> {
    const current = await this.getRow(itemId);
    if (
      current.archived_at ||
      asJsonObject(current.metadata).status === "archived"
    ) return this.get(current.id);
    const metadata = wardrobeMetadata(
      {},
      current.metadata,
      "archived",
    ) as Record<string, unknown>;
    metadata.archivedAt = new Date().toISOString();
    const query = new URLSearchParams({
      id: `eq.${idValue(itemId, "itemId")}`,
      limit: "1",
    });
    const rows = await this.client.updateRows<WardrobeItemRow>(
      "wardrobe_items",
      query,
      {
        archived_at: new Date().toISOString(),
        metadata,
      },
    );
    if (!rows[0]) {
      throw new AppError("not_found", "Wardrobe item not found.", 404);
    }
    return this.get(rows[0].id);
  }
}
