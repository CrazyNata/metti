import type { UserDataClient } from "../../_shared/supabase-client.ts";
import type {
  JsonObject,
  ProfileRow,
  SavedOutfitRow,
  WardrobeItemRow,
} from "../../_shared/types.ts";

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValues(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function queryMatches(
  row: Record<string, unknown>,
  query: URLSearchParams,
): boolean {
  const idFilter = query.get("id") ?? "";
  if (idFilter.startsWith("eq.") && row.id !== idFilter.slice(3)) return false;
  if (idFilter.startsWith("in.(")) {
    const ids = idFilter.slice(4, -1).split(",");
    if (!ids.includes(String(row.id))) return false;
  }

  const archivedFilter = query.get("archived_at");
  if (
    archivedFilter === "is.null" && row.archived_at !== null &&
    row.archived_at !== undefined
  ) return false;
  if (
    archivedFilter === "not.is.null" &&
    (row.archived_at === null || row.archived_at === undefined)
  ) return false;

  const categoryFilter = query.get("category");
  if (
    categoryFilter?.startsWith("eq.") &&
    row.category !== categoryFilter.slice(3)
  ) return false;

  for (const field of ["color", "brand", "season"]) {
    const filter = query.get(field);
    if (!filter?.startsWith("ilike.")) continue;
    const needle = filter.slice("ilike.".length).replace(/^\*/, "").replace(
      /\*$/,
      "",
    ).toLocaleLowerCase();
    const actual = String(row[field] ?? "").toLocaleLowerCase();
    if (!actual.includes(needle)) return false;
  }

  for (const key of ["subcategory", "occasion", "favorite", "season"]) {
    const filter = query.get(`metadata->>${key}`);
    if (!filter?.startsWith("eq.")) continue;
    const metadata = objectValue(row.metadata);
    if (String(metadata[key] ?? "") !== filter.slice(3)) return false;
  }

  const tagsFilter = query.get("metadata->tags");
  if (tagsFilter?.startsWith("cs.")) {
    let requested: string[] = [];
    try {
      requested = stringValues(JSON.parse(tagsFilter.slice(3)));
    } catch (_) {
      return false;
    }
    const actual = stringValues(objectValue(row.metadata).tags);
    if (!requested.every((tag) => actual.includes(tag))) return false;
  }

  const wornFilter = query.get("is_worn");
  if (wornFilter === "eq.true" && row.is_worn !== true) return false;
  if (wornFilter === "eq.false" && row.is_worn !== false) return false;

  const createdFilters = query.getAll("created_at");
  for (const filter of createdFilters) {
    if (filter.startsWith("gte.") && String(row.created_at) < filter.slice(5)) {
      return false;
    }
    if (filter.startsWith("lt.") && String(row.created_at) >= filter.slice(3)) {
      return false;
    }
  }

  return true;
}

function compareValues(left: unknown, right: unknown): number {
  if (left === right) return 0;
  if (left === null || left === undefined) return 1;
  if (right === null || right === undefined) return -1;
  return String(left) < String(right) ? 1 : -1;
}

export class MemoryDataClient implements UserDataClient {
  private wardrobeItems: WardrobeItemRow[] = [];
  private outfits: SavedOutfitRow[] = [];
  private profiles: ProfileRow[] = [];
  private sequence = 1;

  readonly uploadedImages = new Map<
    string,
    { bytes: Uint8Array; contentType: string; upsert: boolean }
  >();
  readonly removedImagePaths: string[] = [];
  failImageUpload = false;
  failImageRemove = false;
  failImageLinkUpdate = false;

  constructor(readonly ownerId: string) {}

  seedWardrobe(...rows: WardrobeItemRow[]): void {
    this.wardrobeItems.push(...rows);
  }

  seedOutfits(...rows: SavedOutfitRow[]): void {
    this.outfits.push(...rows);
  }

  seedProfile(row: ProfileRow): void {
    this.profiles.push(row);
  }

  wardrobe(id: string): WardrobeItemRow | undefined {
    return this.wardrobeItems.find((row) => row.id === id);
  }

  outfit(id: string): SavedOutfitRow | undefined {
    return this.outfits.find((row) => row.id === id);
  }

  profile(): ProfileRow | undefined {
    return this.profiles.find((row) => row.id === this.ownerId);
  }

  async listRows<T>(table: string, query: URLSearchParams): Promise<T[]> {
    const rows = this.rowsFor(table)
      .filter((row) => this.isOwned(row))
      .filter((row) => queryMatches(row, query));
    this.sortRows(rows, query.get("order") ?? "");
    const offset = Number(query.get("offset") ?? 0);
    const limit = Number(query.get("limit") ?? rows.length);
    return rows.slice(offset, offset + limit) as T[];
  }

  async insertRow<T>(table: string, payload: unknown): Promise<T> {
    const input = objectValue(payload);
    const now = new Date(Date.UTC(2026, 0, 1, 0, 0, this.sequence++))
      .toISOString();
    if (table === "wardrobe_items") {
      const row: WardrobeItemRow = {
        id: `item-${this.sequence}`,
        user_id: this.ownerId,
        name: String(input.name ?? ""),
        category: input.category as WardrobeItemRow["category"],
        color: (input.color as string | null | undefined) ?? null,
        size: (input.size as string | null | undefined) ?? null,
        season: (input.season as string | null | undefined) ?? null,
        brand: (input.brand as string | null | undefined) ?? null,
        notes: (input.notes as string | null | undefined) ?? null,
        image_path: (input.image_path as string | null | undefined) ?? null,
        metadata: (input.metadata as JsonObject | null | undefined) ?? {},
        created_at: now,
        updated_at: now,
        archived_at: (input.archived_at as string | null | undefined) ?? null,
      };
      this.wardrobeItems.push(row);
      return row as T;
    }
    if (table === "saved_outfits") {
      const row: SavedOutfitRow = {
        id: `outfit-${this.sequence}`,
        user_id: this.ownerId,
        title: String(input.title ?? ""),
        note: (input.note as string | null | undefined) ?? null,
        prompt: (input.prompt as string | null | undefined) ?? null,
        temperature_c: (input.temperature_c as number | null | undefined) ??
          null,
        weather_code: (input.weather_code as number | null | undefined) ?? null,
        item_ids: Array.isArray(input.item_ids)
          ? input.item_ids.map(String)
          : [],
        is_worn: input.is_worn === true,
        worn_at: (input.worn_at as string | null | undefined) ?? null,
        metadata: (input.metadata as JsonObject | null | undefined) ?? {},
        created_at: now,
        updated_at: now,
        archived_at: (input.archived_at as string | null | undefined) ?? null,
      };
      this.outfits.push(row);
      return row as T;
    }
    throw new Error(`Unsupported insert table: ${table}`);
  }

  async updateRows<T>(
    table: string,
    query: URLSearchParams,
    payload: unknown,
  ): Promise<T[]> {
    const input = objectValue(payload);
    if (
      table === "wardrobe_items" &&
      Object.prototype.hasOwnProperty.call(input, "image_path") &&
      this.failImageLinkUpdate
    ) {
      this.failImageLinkUpdate = false;
      throw new Error("image link update failed");
    }
    const rows = this.rowsFor(table).filter((row) => this.isOwned(row)).filter((
      row,
    ) => queryMatches(row, query));
    rows.forEach((row) => {
      Object.assign(row, input, { updated_at: new Date().toISOString() });
    });
    return rows as T[];
  }

  async upsertRow<T>(
    table: string,
    _query: URLSearchParams,
    payload: unknown,
  ): Promise<T> {
    if (table !== "profiles") {
      throw new Error(`Unsupported upsert table: ${table}`);
    }
    const input = objectValue(payload);
    const current = this.profile();
    if (current) {
      Object.assign(current, input, {
        id: this.ownerId,
        updated_at: new Date().toISOString(),
      });
      return current as T;
    }
    const row: ProfileRow = {
      id: this.ownerId,
      display_name: (input.display_name as string | null | undefined) ?? null,
      city: String(input.city ?? "Prague"),
      preferences: (input.preferences as JsonObject | null | undefined) ?? {},
      style_tags: Array.isArray(input.style_tags)
        ? input.style_tags.map(String)
        : [],
      style_profile: (input.style_profile as JsonObject | null | undefined) ??
        {},
      updated_at: new Date().toISOString(),
    };
    this.profiles.push(row);
    return row as T;
  }

  async uploadObject(
    bucket: string,
    path: string,
    bytes: Uint8Array,
    contentType: string,
    upsert = false,
  ): Promise<void> {
    if (this.failImageUpload) throw new Error("image upload failed");
    this.uploadedImages.set(`${bucket}/${path}`, {
      bytes: new Uint8Array(bytes),
      contentType,
      upsert,
    });
  }

  async removeObjects(bucket: string, paths: string[]): Promise<void> {
    if (this.failImageRemove) throw new Error("image remove failed");
    for (const path of paths) {
      this.removedImagePaths.push(path);
      this.uploadedImages.delete(`${bucket}/${path}`);
    }
  }

  async createSignedUrls(
    _bucket: string,
    paths: string[],
    _expiresIn: number,
  ): Promise<Map<string, string>> {
    return new Map(
      paths.map((
        path,
      ) => [path, `https://signed.example/${encodeURIComponent(path)}`]),
    );
  }

  private rowsFor(table: string): Array<Record<string, unknown>> {
    if (table === "wardrobe_items") {
      return this.wardrobeItems as unknown as Array<Record<string, unknown>>;
    }
    if (table === "saved_outfits") {
      return this.outfits as unknown as Array<Record<string, unknown>>;
    }
    if (table === "profiles") {
      return this.profiles as unknown as Array<Record<string, unknown>>;
    }
    throw new Error(`Unsupported table: ${table}`);
  }

  private isOwned(row: Record<string, unknown>): boolean {
    return row.user_id === this.ownerId || row.id === this.ownerId;
  }

  private sortRows(rows: Array<Record<string, unknown>>, order: string): void {
    const fields = order.split(",").map((part) => {
      const [name, direction] = part.split(".");
      return { name, descending: direction === "desc" };
    }).filter((field) => field.name);
    if (!fields.length) return;
    rows.sort((left, right) => {
      for (const field of fields) {
        const comparison = compareValues(left[field.name], right[field.name]);
        if (comparison) return field.descending ? comparison : -comparison;
      }
      return 0;
    });
  }
}

export function wardrobeRow(
  id: string,
  userId: string,
  values: Partial<WardrobeItemRow> = {},
): WardrobeItemRow {
  return {
    id,
    user_id: userId,
    name: values.name ?? id,
    category: values.category ?? "top",
    color: values.color ?? null,
    size: values.size ?? null,
    season: values.season ?? null,
    brand: values.brand ?? null,
    notes: values.notes ?? null,
    image_path: values.image_path ?? null,
    metadata: values.metadata ?? {},
    created_at: values.created_at ?? "2026-01-01T00:00:00.000Z",
    updated_at: values.updated_at ?? "2026-01-01T00:00:00.000Z",
    archived_at: values.archived_at ?? null,
  };
}

export function outfitRow(
  id: string,
  userId: string,
  values: Partial<SavedOutfitRow> = {},
): SavedOutfitRow {
  return {
    id,
    user_id: userId,
    title: values.title ?? id,
    note: values.note ?? null,
    prompt: values.prompt ?? null,
    temperature_c: values.temperature_c ?? null,
    weather_code: values.weather_code ?? null,
    item_ids: values.item_ids ?? [],
    is_worn: values.is_worn ?? false,
    worn_at: values.worn_at ?? null,
    metadata: values.metadata ?? {},
    created_at: values.created_at ?? "2026-01-01T00:00:00.000Z",
    updated_at: values.updated_at ?? "2026-01-01T00:00:00.000Z",
    archived_at: values.archived_at ?? null,
  };
}
