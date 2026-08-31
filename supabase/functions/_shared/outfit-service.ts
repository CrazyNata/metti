import { AppError } from "./errors.ts";
import { asJsonObject, outfitFromRow, stringList } from "./serializers.ts";
import type { UserDataClient } from "./supabase-client.ts";
import { WardrobeService } from "./wardrobe-service.ts";
import type {
  AuthenticatedUser,
  JsonObject,
  OutfitDto,
  OutfitListOptions,
  OutfitUpdateInput,
  Page,
  SavedOutfitRow,
  SaveOutfitInput,
  WardrobeStatus,
} from "./types.ts";
import {
  idValue,
  isoDate,
  isoTimestamp,
  limitValue,
  lower,
  nextUtcDay,
  optionalString,
  outfitMetadata,
  pageValue,
  stringArray,
} from "./validation.ts";

export const OUTFIT_SELECT = [
  "id",
  "user_id",
  "title",
  "note",
  "prompt",
  "temperature_c",
  "weather_code",
  "item_ids",
  "is_worn",
  "worn_at",
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

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function rowStatus(row: SavedOutfitRow): WardrobeStatus {
  return row.archived_at || asJsonObject(row.metadata).status === "archived"
    ? "archived"
    : "active";
}

function rowMatches(row: SavedOutfitRow, options: OutfitListOptions): boolean {
  const metadata = asJsonObject(row.metadata);
  const status = rowStatus(row);
  const requestedStatus = options.status ?? "active";
  if (requestedStatus !== "all" && status !== requestedStatus) return false;
  if (
    options.occasion && lower(metadata.occasion) !== lower(options.occasion)
  ) return false;
  if (options.season && lower(metadata.season) !== lower(options.season)) {
    return false;
  }
  if (
    options.favorites !== undefined &&
    Boolean(metadata.favorite) !== options.favorites
  ) return false;
  if (options.tags?.length) {
    const tags = stringList(metadata.tags).map(lower);
    if (!options.tags.every((tag) => tags.includes(lower(tag)))) return false;
  }
  if (options.date && !row.created_at.startsWith(options.date)) return false;
  return true;
}

function pageInfo(page: number, limit: number, hasMore: boolean) {
  return { page, limit, hasMore, nextPage: hasMore ? page + 1 : null };
}

export interface WearHistoryEntry {
  outfitId: string;
  name: string;
  itemIds: string[];
  wornAt: string | null;
  createdAt: string;
}

export class OutfitService {
  constructor(
    private readonly client: UserDataClient,
    private readonly user: AuthenticatedUser,
    private readonly wardrobe: WardrobeService,
  ) {}

  private baseQuery(options: OutfitListOptions): URLSearchParams {
    const page = pageValue(options.page, 1, PAGE_MAX);
    const limit = limitValue(options.limit, 40, LIST_MAX);
    const query = new URLSearchParams({
      select: OUTFIT_SELECT,
      order: "created_at.desc,id.desc",
      limit: String(limit + 1),
      offset: String((page - 1) * limit),
    });
    const status = options.status ?? "active";
    if (status === "active") query.set("archived_at", "is.null");
    if (status === "archived") query.set("archived_at", "not.is.null");
    if (options.occasion) {
      query.set("metadata->>occasion", `eq.${queryValue(options.occasion)}`);
    }
    if (options.season) {
      query.set("metadata->>season", `eq.${queryValue(options.season)}`);
    }
    if (options.favorites !== undefined) {
      query.set("metadata->>favorite", `eq.${options.favorites}`);
    }
    const date = isoDate(options.date, "date");
    if (date) {
      const day = date.slice(0, 10);
      query.set("created_at", `gte.${day}T00:00:00.000Z`);
      query.append("created_at", `lt.${nextUtcDay(day)}`);
    }
    if (options.tags?.length) {
      query.set("metadata->tags", `cs.${JSON.stringify(options.tags)}`);
    }
    return query;
  }

  async getRow(
    outfitId: unknown,
    includeArchived = true,
  ): Promise<SavedOutfitRow> {
    const id = idValue(outfitId, "outfitId");
    const query = new URLSearchParams({
      select: OUTFIT_SELECT,
      id: `eq.${id}`,
      limit: "1",
    });
    if (!includeArchived) query.set("archived_at", "is.null");
    const rows = await this.client.listRows<SavedOutfitRow>(
      "saved_outfits",
      query,
    );
    const row = rows[0];
    if (!row) throw new AppError("not_found", "Outfit not found.", 404);
    return row;
  }

  private async fullDto(row: SavedOutfitRow): Promise<OutfitDto> {
    const items = await this.wardrobe.getDtosByIds(row.item_ids ?? [], true);
    return outfitFromRow(row, items);
  }

  async list(options: OutfitListOptions = {}): Promise<Page<OutfitDto>> {
    const page = pageValue(options.page, 1, PAGE_MAX);
    const limit = limitValue(options.limit, 40, LIST_MAX);
    const rows = await this.client.listRows<SavedOutfitRow>(
      "saved_outfits",
      this.baseQuery(options),
    );
    const matched = rows.filter((row) => rowMatches(row, options));
    const pageRows = matched.slice(0, limit);
    return {
      items: pageRows.map((row) => outfitFromRow(row)),
      pagination: pageInfo(
        page,
        limit,
        rows.length > limit || matched.length > limit,
      ),
    };
  }

  async get(outfitId: unknown): Promise<OutfitDto> {
    return this.fullDto(await this.getRow(outfitId));
  }

  async save(input: SaveOutfitInput): Promise<OutfitDto> {
    const itemIds = await this.wardrobe.assertOwnedItemIds(input.itemIds);
    const title = input.name === undefined
      ? "Сохранённый образ"
      : (optionalString(input.name, "name", 160) || "Сохранённый образ");
    const occasion = optionalString(input.occasion, "occasion", 80);
    const season = optionalString(input.season, "season", 80);
    const notes = optionalString(input.notes, "notes", 1500);
    const prompt = optionalString(input.prompt, "prompt", 1000);
    const tags = stringArray(input.tags, "tags", 20, 50);
    const metadata = outfitMetadata(
      { occasion, season, tags, favorite: input.favorite },
      {},
      "active",
    );
    const payload = {
      user_id: this.user.id,
      title,
      note: notes ?? null,
      prompt: prompt ?? null,
      temperature_c: input.temperatureC ?? null,
      weather_code: input.weatherCode ?? null,
      item_ids: itemIds,
      is_worn: false,
      worn_at: null,
      metadata,
      archived_at: null,
    };
    const row = await this.client.insertRow<SavedOutfitRow>(
      "saved_outfits",
      payload,
    );
    if (!row?.id) {
      throw new AppError(
        "data_access_error",
        "Не удалось сохранить образ.",
        502,
      );
    }
    return this.get(row.id);
  }

  async update(
    outfitId: unknown,
    input: OutfitUpdateInput,
  ): Promise<OutfitDto> {
    const current = await this.getRow(outfitId);
    const patch: Record<string, unknown> = {};
    if (hasOwn(input, "name")) {
      patch.title = optionalString(input.name, "name", 160) ||
        "Сохранённый образ";
    }
    if (hasOwn(input, "notes")) {
      patch.note = optionalString(input.notes, "notes", 1500) ?? null;
    }
    if (hasOwn(input, "prompt")) {
      patch.prompt = optionalString(input.prompt, "prompt", 1000) ?? null;
    }
    if (hasOwn(input, "itemIds")) {
      patch.item_ids = await this.wardrobe.assertOwnedItemIds(input.itemIds);
    }

    const metadataFields = ["occasion", "season", "tags", "favorite"];
    if (metadataFields.some((key) => hasOwn(input, key))) {
      const metadataInput = {
        occasion: hasOwn(input, "occasion")
          ? optionalString(input.occasion, "occasion", 80)
          : undefined,
        season: hasOwn(input, "season")
          ? optionalString(input.season, "season", 80)
          : undefined,
        tags: hasOwn(input, "tags")
          ? stringArray(input.tags, "tags", 20, 50)
          : undefined,
        favorite: hasOwn(input, "favorite")
          ? Boolean(input.favorite)
          : undefined,
      };
      patch.metadata = outfitMetadata(metadataInput, current.metadata);
    }
    if (!Object.keys(patch).length) {
      throw new AppError("invalid_input", "At least one field is required.");
    }

    const query = new URLSearchParams({
      id: `eq.${idValue(outfitId, "outfitId")}`,
      limit: "1",
    });
    const rows = await this.client.updateRows<SavedOutfitRow>(
      "saved_outfits",
      query,
      patch,
    );
    if (!rows[0]) throw new AppError("not_found", "Outfit not found.", 404);
    return this.get(rows[0].id);
  }

  async archive(outfitId: unknown): Promise<OutfitDto> {
    const current = await this.getRow(outfitId);
    if (rowStatus(current) === "archived") return this.get(current.id);
    const archivedAt = new Date().toISOString();
    const metadata = outfitMetadata({}, current.metadata, "archived") as Record<
      string,
      unknown
    >;
    metadata.archivedAt = archivedAt;
    const query = new URLSearchParams({
      id: `eq.${idValue(outfitId, "outfitId")}`,
      limit: "1",
    });
    const rows = await this.client.updateRows<SavedOutfitRow>(
      "saved_outfits",
      query,
      {
        archived_at: archivedAt,
        metadata: metadata as JsonObject,
      },
    );
    if (!rows[0]) throw new AppError("not_found", "Outfit not found.", 404);
    return this.get(rows[0].id);
  }

  async favorite(outfitId: unknown, favorite: boolean): Promise<OutfitDto> {
    const current = await this.getRow(outfitId);
    const metadata = outfitMetadata(
      { favorite: Boolean(favorite) },
      current.metadata,
    );
    const query = new URLSearchParams({
      id: `eq.${idValue(outfitId, "outfitId")}`,
      limit: "1",
    });
    const rows = await this.client.updateRows<SavedOutfitRow>(
      "saved_outfits",
      query,
      { metadata },
    );
    if (!rows[0]) throw new AppError("not_found", "Outfit not found.", 404);
    return this.get(rows[0].id);
  }

  async getWearHistory(
    options: { page?: number; limit?: number } = {},
  ): Promise<
    { entries: WearHistoryEntry[]; pagination: ReturnType<typeof pageInfo> }
  > {
    const page = pageValue(options.page, 1, PAGE_MAX);
    const limit = limitValue(options.limit, 40, LIST_MAX);
    const query = new URLSearchParams({
      select: OUTFIT_SELECT,
      is_worn: "eq.true",
      archived_at: "is.null",
      order: "worn_at.desc.nullslast,created_at.desc",
      limit: String(limit + 1),
      offset: String((page - 1) * limit),
    });
    const rows = await this.client.listRows<SavedOutfitRow>(
      "saved_outfits",
      query,
    );
    const pageRows = rows.slice(0, limit);
    return {
      entries: pageRows.map((row) => ({
        outfitId: row.id,
        name: row.title,
        itemIds: Array.isArray(row.item_ids)
          ? [...new Set(row.item_ids.map(String))]
          : [],
        wornAt: row.worn_at,
        createdAt: row.created_at,
      })),
      pagination: pageInfo(page, limit, rows.length > limit),
    };
  }

  async markAsWorn(
    input: { outfitId?: string; itemIds?: string[]; wornAt?: string },
  ): Promise<OutfitDto> {
    const wornAt = isoTimestamp(input.wornAt, "wornAt") ??
      new Date().toISOString();
    if (input.outfitId !== undefined) {
      const current = await this.getRow(input.outfitId);
      if (rowStatus(current) === "archived") {
        throw new AppError(
          "conflict",
          "Archived outfits cannot be marked as worn.",
          409,
        );
      }
      const patch: Record<string, unknown> = { is_worn: true, worn_at: wornAt };
      if (input.itemIds !== undefined) {
        patch.item_ids = await this.wardrobe.assertOwnedItemIds(input.itemIds);
      }
      const query = new URLSearchParams({
        id: `eq.${idValue(input.outfitId, "outfitId")}`,
        limit: "1",
      });
      const rows = await this.client.updateRows<SavedOutfitRow>(
        "saved_outfits",
        query,
        patch,
      );
      if (!rows[0]) throw new AppError("not_found", "Outfit not found.", 404);
      return this.get(rows[0].id);
    }

    if (input.itemIds === undefined) {
      throw new AppError("invalid_input", "Provide outfitId or itemIds.");
    }
    const itemIds = await this.wardrobe.assertOwnedItemIds(input.itemIds);
    const row = await this.client.insertRow<SavedOutfitRow>("saved_outfits", {
      user_id: this.user.id,
      title: "Надетый образ",
      note: null,
      prompt: null,
      temperature_c: null,
      weather_code: null,
      item_ids: itemIds,
      is_worn: true,
      worn_at: wornAt,
      metadata: { status: "active", source: "wear_history" } as JsonObject,
      archived_at: null,
    });
    if (!row?.id) {
      throw new AppError(
        "data_access_error",
        "Не удалось записать историю носки.",
        502,
      );
    }
    return this.get(row.id);
  }
}
