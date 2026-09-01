import type {
  AuthenticatedUser,
  JsonObject,
  OutfitDto,
  ProfileDto,
  ProfileRow,
  SavedOutfitRow,
  StylePreferencesDto,
  WardrobeItemDto,
  WardrobeItemRow,
} from "./types.ts";

export function asJsonObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as JsonObject;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function stringList(value: unknown, max = 30): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
    ? value.split(",")
    : [];
  return [
    ...new Set(
      values
        .map((item) => typeof item === "string" ? item.trim() : "")
        .filter(Boolean)
        .slice(0, max),
    ),
  ];
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const result = asString(value);
    if (result) return result;
  }
  return null;
}

function numberValue(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function boolValue(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key, item]) =>
        key.length <= 40 && typeof item === "string" && item.trim()
      )
      .slice(0, 20)
      .map(([key, item]) => [key, String(item).trim().slice(0, 40)]),
  );
}

export function metadataStatus(
  row: { archived_at?: string | null; metadata?: JsonObject | null },
): "active" | "archived" {
  const metadata = asJsonObject(row.metadata);
  return row.archived_at || metadata.status === "archived"
    ? "archived"
    : "active";
}

export function wardrobeItemFromRow(
  row: WardrobeItemRow,
  imageUrl: string | null = null,
): WardrobeItemDto {
  const metadata = asJsonObject(row.metadata);
  const color = firstString(row.color, metadata.color);
  const colors = stringList(metadata.colors ?? (color ? [color] : []));
  const season = firstString(row.season, metadata.season);
  const seasons = stringList(metadata.seasons ?? (season ? [season] : []));
  const occasions = stringList(metadata.occasions ?? metadata.occasion);
  const tags = stringList(metadata.tags);
  const styles = stringList(metadata.styles);

  return {
    id: row.id,
    name: row.name,
    category: row.category,
    subcategory: asString(metadata.subcategory),
    brand: asString(row.brand),
    color,
    colors,
    size: asString(row.size),
    season,
    seasons,
    material: asString(metadata.material),
    pattern: asString(metadata.pattern),
    fit: asString(metadata.fit),
    length: asString(metadata.length),
    styles,
    occasions,
    tags,
    notes: asString(row.notes),
    favorite: boolValue(metadata.favorite),
    status: metadataStatus(row),
    imageUrl,
    createdAt: row.created_at,
  };
}

function stylePreferencesFromRow(
  row: ProfileRow | null,
  user: AuthenticatedUser,
): StylePreferencesDto {
  const preferences = asJsonObject(row?.preferences);
  const styleProfile = asJsonObject(row?.style_profile);
  const clothingSizeObject =
    Object.keys(asJsonObject(styleProfile.clothing_sizes)).length
      ? styleProfile.clothing_sizes
      : styleProfile.sizes;
  const clothingSizes = stringMap(clothingSizeObject);
  if (!Object.keys(clothingSizes).length) {
    const legacySize = firstString(styleProfile.size);
    if (legacySize) clothingSizes.general = legacySize;
  }

  return {
    styleTags: stringList(row?.style_tags),
    preferredColors: stringList(
      preferences.preferred_colors ?? preferences.favorite_colors,
    ),
    avoidedColors: stringList(preferences.avoided_colors),
    preferredBrands: stringList(preferences.preferred_brands),
    dislikedBrands: stringList(preferences.disliked_brands),
    preferredFits: stringList(preferences.preferred_fits ?? styleProfile.fit),
    clothingSizes,
    shoeSize: firstString(styleProfile.shoe_size),
    height: numberValue(styleProfile.height),
    gender: firstString(styleProfile.gender),
    styleNotes: firstString(preferences.style_notes, preferences.note),
  };
}

export function stylePreferencesFromProfile(
  row: ProfileRow | null,
  user: AuthenticatedUser,
): StylePreferencesDto {
  return stylePreferencesFromRow(row, user);
}

export function profileFromRow(
  row: ProfileRow | null,
  user: AuthenticatedUser,
): ProfileDto {
  const preferences = stylePreferencesFromRow(row, user);
  const fallbackName = firstString(
    user.user_metadata?.full_name,
    user.user_metadata?.name,
    user.email?.split("@")[0],
  ) ?? "Пользователь";
  return {
    id: user.id,
    displayName: firstString(row?.display_name) ?? fallbackName,
    email: user.email ?? null,
    city: firstString(row?.city) ?? "Prague",
    gender: preferences.gender,
    clothingSizes: preferences.clothingSizes,
    shoeSize: preferences.shoeSize,
    height: preferences.height,
    preferredFits: preferences.preferredFits,
    preferredColors: preferences.preferredColors,
    avoidedColors: preferences.avoidedColors,
    preferredBrands: preferences.preferredBrands,
    dislikedBrands: preferences.dislikedBrands,
    styleTags: preferences.styleTags,
    styleNotes: preferences.styleNotes,
  };
}

export function outfitFromRow(
  row: SavedOutfitRow,
  items?: WardrobeItemDto[],
): OutfitDto {
  const metadata = asJsonObject(row.metadata);
  const itemIds = Array.isArray(row.item_ids)
    ? [...new Set(row.item_ids.map(String))]
    : [];
  return {
    id: row.id,
    name: row.title,
    notes: asString(row.note),
    prompt: asString(row.prompt),
    itemIds,
    ...(items ? { items } : {}),
    occasion: firstString(metadata.occasion),
    season: firstString(metadata.season),
    tags: stringList(metadata.tags),
    favorite: boolValue(metadata.favorite),
    status: metadataStatus(row),
    isWorn: Boolean(row.is_worn),
    wornAt: row.worn_at ?? null,
    temperatureC: numberValue(row.temperature_c),
    weatherCode: numberValue(row.weather_code),
    imageUrl: firstString(metadata.imageUrl, metadata.image_url),
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? null,
  };
}
