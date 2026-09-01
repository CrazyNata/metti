import { AppError } from "./errors.ts";
import { ImageService, type PreparedImage } from "./image-service.ts";
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
  type WardrobeImageInput,
  type WardrobeItemActionDto,
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
  normalizeWardrobeArray,
  normalizeWardrobeString,
  optionalString,
  pageValue,
  requiredString,
  safeImagePath,
  searchTerm,
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
  const aliases: Record<string, WardrobeItemInput["category"]> = {
    outerwear: "outer",
    jeans: "bottom",
    bag: "accessory",
  };
  const normalized = typeof value === "string"
    ? aliases[value.trim().toLocaleLowerCase()] ?? value.trim()
    : value;
  if (
    typeof normalized !== "string" ||
    !WARDROBE_CATEGORIES.includes(normalized as WardrobeItemInput["category"])
  ) {
    throw new AppError("invalid_input", "category is invalid.");
  }
  return normalized as WardrobeItemInput["category"];
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
    ...stringList(metadata.color),
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
  const availableSeasons = [
    ...stringList(metadata.seasons),
    ...stringList(metadata.season),
    ...stringList(row.season),
  ];
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
    !seasons.some((value) =>
      availableSeasons.some((candidate) =>
        lower(candidate).includes(lower(value))
      )
    )
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
  const styles = options.styles?.length
    ? options.styles
    : options.style
    ? [options.style]
    : [];
  if (
    styles.length &&
    !styles.some((style) =>
      stringList(metadata.styles).some((candidate) =>
        lower(candidate) === lower(style)
      )
    )
  ) return false;
  if (
    options.length &&
    lower(metadata.length) !== lower(options.length)
  ) return false;
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
      metadata.material,
      metadata.pattern,
      metadata.fit,
      metadata.length,
      ...stringList(metadata.colors),
      ...stringList(metadata.seasons),
      ...stringList(metadata.styles),
      ...stringList(metadata.tags),
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
    "seasons",
    "material",
    "pattern",
    "fit",
    "length",
    "styles",
    "occasion",
    "occasions",
    "tags",
    "favorite",
  ].some((key) => hasOwn(input, key));
}

function normalizeListOptions(
  options: WardrobeListOptions,
): WardrobeListOptions {
  const normalized: WardrobeListOptions = { ...options };
  if (options.category !== undefined) {
    normalized.category = categoryValue(options.category);
  }
  if (hasOwn(options, "subcategory")) {
    normalized.subcategory = normalizeWardrobeString(
      options.subcategory,
      "subcategory",
      "subcategory",
      80,
    ) ?? undefined;
  }
  if (hasOwn(options, "color")) {
    normalized.color = normalizeWardrobeString(
      options.color,
      "color",
      "color",
      80,
    ) ?? undefined;
  }
  if (options.colors !== undefined) {
    normalized.colors = normalizeWardrobeArray(
      options.colors,
      "colors",
      "color",
      12,
      50,
    ) ?? [];
  }
  if (hasOwn(options, "season")) {
    normalized.season = normalizeWardrobeString(
      options.season,
      "season",
      "season",
      80,
    ) ?? undefined;
  }
  if (options.seasons !== undefined) {
    normalized.seasons = normalizeWardrobeArray(
      options.seasons,
      "seasons",
      "season",
      12,
      80,
    ) ?? [];
  }
  if (hasOwn(options, "style")) {
    normalized.style = normalizeWardrobeString(
      options.style,
      "style",
      "style",
      80,
    ) ?? undefined;
  }
  if (options.styles !== undefined) {
    normalized.styles = normalizeWardrobeArray(
      options.styles,
      "styles",
      "style",
      12,
      60,
    ) ?? [];
  }
  if (hasOwn(options, "length")) {
    normalized.length = normalizeWardrobeString(
      options.length,
      "length",
      "length",
      80,
    ) ?? undefined;
  }
  if (options.tags !== undefined) {
    normalized.tags = normalizeWardrobeArray(
      options.tags,
      "tags",
      "tag",
      20,
      50,
    ) ?? [];
  }
  return normalized;
}

export class WardrobeService {
  constructor(
    private readonly client: UserDataClient,
    private readonly user: AuthenticatedUser,
    private readonly images = new ImageService(client, user),
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

  private actionDto(
    item: WardrobeItemDto,
    imageAttached: boolean,
    imageStatus: WardrobeItemActionDto["imageStatus"],
  ): WardrobeItemActionDto {
    return { ...item, imageAttached, imageStatus };
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
    if (options.style) {
      query.set("metadata->styles", `cs.${JSON.stringify([options.style])}`);
    }
    if (options.length) {
      query.set("metadata->>length", `eq.${queryValue(options.length)}`);
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
    const normalizedOptions = normalizeListOptions(options);
    const page = pageValue(normalizedOptions.page, 1, PAGE_MAX);
    const limit = limitValue(normalizedOptions.limit, 40, LIST_MAX);
    const rows = await this.client.listRows<WardrobeItemRow>(
      "wardrobe_items",
      this.baseQuery(normalizedOptions),
    );
    const matched = rows.filter((row) => rowMatches(row, normalizedOptions));
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

  async add(input: WardrobeItemInput): Promise<WardrobeItemActionDto> {
    const name = requiredString(input.name, "name", 160);
    const category = categoryValue(input.category);
    const color = normalizeWardrobeString(input.color, "color", "color", 80);
    const colors = normalizeWardrobeArray(
      input.colors,
      "colors",
      "color",
      12,
      50,
    );
    const season = normalizeWardrobeString(
      input.season,
      "season",
      "season",
      80,
    );
    const seasons = normalizeWardrobeArray(
      input.seasons,
      "seasons",
      "season",
      8,
      40,
    );
    const imagePath = safeImagePath(input.imagePath, this.user.id);
    if (input.image !== undefined && imagePath) {
      throw new AppError(
        "invalid_input",
        "Use image or imagePath, not both.",
      );
    }
    const imageResolution = input.image !== undefined
      ? await this.images.resolve(input.image)
      : null;
    const payload = {
      user_id: this.user.id,
      name,
      category,
      color: color === undefined ? colors?.[0] ?? null : color,
      size: optionalString(input.size, "size", 40) ?? null,
      season: season === undefined ? seasons?.[0] ?? null : season,
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
    const withoutImage = () => this.get(row.id);
    if (!imageResolution?.file) {
      return this.actionDto(
        await withoutImage(),
        Boolean(imagePath),
        imagePath ? "attached" : input.image !== undefined ? "pending" : "none",
      );
    }

    let uploadedPath: string | null = null;
    try {
      uploadedPath = await this.images.uploadForItem(
        row.id,
        imageResolution.file,
      );
      const updated = await this.client.updateRows<WardrobeItemRow>(
        "wardrobe_items",
        new URLSearchParams({ id: `eq.${idValue(row.id, "itemId")}`, limit: "1" }),
        { image_path: uploadedPath },
      );
      if (!updated[0]) {
        throw new AppError(
          "data_access_error",
          "Не удалось привязать фотографию к вещи.",
          502,
        );
      }
      return this.actionDto(await withoutImage(), true, "attached");
    } catch (_) {
      // The item remains valid without a photo. Remove a successfully uploaded
      // object if the database link could not be written, so no orphan is left.
      if (uploadedPath) await this.images.removePath(uploadedPath).catch(() => {});
      return this.actionDto(await withoutImage(), false, "pending");
    }
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
      patch.color = normalizeWardrobeString(
        input.color,
        "color",
        "color",
        80,
      ) ?? null;
    } else if (hasOwn(input, "colors")) {
      const colors = normalizeWardrobeArray(
        input.colors,
        "colors",
        "color",
        12,
        50,
      );
      patch.color = colors?.[0] ?? null;
    }
    if (hasOwn(input, "size")) {
      patch.size = optionalString(input.size, "size", 40) ?? null;
    }
    if (hasOwn(input, "season")) {
      patch.season = normalizeWardrobeString(
        input.season,
        "season",
        "season",
        80,
      ) ?? null;
    } else if (hasOwn(input, "seasons")) {
      const seasons = normalizeWardrobeArray(
        input.seasons,
        "seasons",
        "season",
        8,
        40,
      );
      patch.season = seasons?.[0] ?? null;
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

  private async updateImagePath(
    itemId: string,
    imagePath: string | null,
  ): Promise<WardrobeItemRow> {
    const rows = await this.client.updateRows<WardrobeItemRow>(
      "wardrobe_items",
      new URLSearchParams({ id: `eq.${idValue(itemId, "itemId")}`, limit: "1" }),
      { image_path: imagePath },
    );
    if (!rows[0]) {
      throw new AppError(
        "not_found",
        "Wardrobe item not found.",
        404,
      );
    }
    return rows[0];
  }

  private async saveResolvedImage(
    current: WardrobeItemRow,
    image: PreparedImage,
    replace: boolean,
  ): Promise<WardrobeItemActionDto> {
    const existingPath = replace ? current.image_path : null;
    let uploadedPath: string | null = null;
    try {
      uploadedPath = await this.images.uploadForItem(
        current.id,
        image,
        existingPath,
      );
      if (uploadedPath !== current.image_path) {
        await this.updateImagePath(current.id, uploadedPath);
      }
      return this.actionDto(await this.get(current.id), true, "attached");
    } catch (error) {
      // Replacing an existing path uses Storage upsert, so deleting it here
      // would remove the previous image after a successful overwrite. Only a
      // newly-created object needs compensation.
      if (uploadedPath && uploadedPath !== current.image_path) {
        await this.images.removePath(uploadedPath).catch(() => {});
      }
      if (error instanceof AppError) throw error;
      throw new AppError(
        "data_access_error",
        "Не удалось прикрепить фотографию.",
        502,
      );
    }
  }

  async attachImage(
    itemId: unknown,
    imageInput: WardrobeImageInput,
  ): Promise<WardrobeItemActionDto> {
    const current = await this.getRow(itemId);
    if (current.image_path) {
      throw new AppError(
        "conflict",
        "This item already has a photo. Use replace_wardrobe_item_image.",
        409,
      );
    }
    const resolution = await this.images.resolve(imageInput);
    if (!resolution.file) {
      return this.actionDto(await this.get(current.id), false, "pending");
    }
    return this.saveResolvedImage(current, resolution.file, false);
  }

  async replaceImage(
    itemId: unknown,
    imageInput: WardrobeImageInput,
  ): Promise<WardrobeItemActionDto> {
    const current = await this.getRow(itemId);
    const resolution = await this.images.resolve(imageInput);
    if (!resolution.file) {
      return this.actionDto(await this.get(current.id), false, "pending");
    }
    return this.saveResolvedImage(current, resolution.file, true);
  }

  async removeImage(itemId: unknown): Promise<WardrobeItemActionDto> {
    const current = await this.getRow(itemId);
    if (!current.image_path) {
      return this.actionDto(await this.get(current.id), false, "none");
    }

    const imagePath = current.image_path;
    await this.updateImagePath(current.id, null);
    try {
      await this.images.removePath(imagePath);
    } catch (_) {
      // Keep the database and Storage consistent if object deletion fails.
      await this.client.updateRows<WardrobeItemRow>(
        "wardrobe_items",
        new URLSearchParams({ id: `eq.${idValue(current.id, "itemId")}`, limit: "1" }),
        { image_path: imagePath },
      ).catch(() => {});
      throw new AppError(
        "data_access_error",
        "Не удалось удалить фотографию.",
        502,
      );
    }
    return this.actionDto(await this.get(current.id), false, "none");
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
