import { AppError } from "./errors.ts";
import type {
  JsonObject,
  ProfilePreferencesInput,
  WardrobeItemInput,
  WardrobeItemUpdate,
} from "./types.ts";

const MAX_ID_LENGTH = 128;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function requiredString(
  value: unknown,
  field: string,
  max = 200,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError("invalid_input", `${field} is required.`);
  }
  const result = value.trim();
  if (result.length > max) {
    throw new AppError("invalid_input", `${field} is too long.`);
  }
  return result;
}

export function optionalString(
  value: unknown,
  field: string,
  max = 500,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new AppError("invalid_input", `${field} must be a string.`);
  }
  const result = value.trim();
  if (result.length > max) {
    throw new AppError("invalid_input", `${field} is too long.`);
  }
  return result || null;
}

export function stringArray(
  value: unknown,
  field: string,
  maxItems = 30,
  maxLength = 80,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new AppError(
      "invalid_input",
      `${field} must be an array of strings.`,
    );
  }
  if (value.length > maxItems) {
    throw new AppError("invalid_input", `${field} has too many values.`);
  }
  const result = value.map((item) => {
    if (typeof item !== "string") {
      throw new AppError("invalid_input", `${field} must contain strings.`);
    }
    const normalized = item.trim();
    if (normalized.length > maxLength) {
      throw new AppError(
        "invalid_input",
        `${field} contains a value that is too long.`,
      );
    }
    return normalized;
  }).filter(Boolean);
  return [...new Set(result)];
}

export function idValue(value: unknown, field: string): string {
  if (
    typeof value !== "string" || value.length > MAX_ID_LENGTH ||
    !ID_PATTERN.test(value)
  ) {
    throw new AppError("invalid_input", `${field} is invalid.`);
  }
  return value;
}

export function idArray(
  value: unknown,
  field: string,
  min = 1,
  max = 20,
): string[] {
  if (!Array.isArray(value)) {
    throw new AppError("invalid_input", `${field} must be an array.`);
  }
  if (value.length < min || value.length > max) {
    throw new AppError(
      "invalid_input",
      `${field} must contain between ${min} and ${max} values.`,
    );
  }
  const result = value.map((item) => idValue(item, field));
  if (new Set(result).size !== result.length) {
    throw new AppError(
      "invalid_input",
      `${field} must not contain duplicates.`,
    );
  }
  return result;
}

export function pageValue(
  value: unknown,
  fallback: number,
  max: number,
): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number" || !Number.isInteger(value) || value < 1 ||
    value > max
  ) {
    throw new AppError("invalid_input", "Page value is invalid.");
  }
  return value;
}

export function limitValue(value: unknown, fallback = 40, max = 100): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number" || !Number.isInteger(value) || value < 1 ||
    value > max
  ) {
    throw new AppError("invalid_input", `Limit must be between 1 and ${max}.`);
  }
  return value;
}

export function isoDate(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}(?:T[^\s]+)?$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new AppError("invalid_input", `${field} must be a valid ISO date.`);
  }
  return value;
}

export function isoTimestamp(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new AppError("invalid_input", `${field} must be a valid timestamp.`);
  }
  return new Date(value).toISOString();
}

export function cloneMetadata(value: unknown): JsonObject {
  return { ...asRecord(value) } as JsonObject;
}

type WardrobeNormalizedField =
  | "color"
  | "season"
  | "subcategory"
  | "style"
  | "tag"
  | "length";

function tokenKey(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[‐‑–—-]/g, " ")
    .replace(/\s+/g, " ").trim();
}

const COLOR_ALIASES: Record<string, string> = {
  black: "black",
  "jet black": "black",
  черный: "black",
  чёрный: "black",
  черная: "black",
  чёрная: "black",
  черное: "black",
  чёрное: "black",
  черные: "black",
  чёрные: "black",
  white: "white",
  белый: "white",
  белая: "white",
  белое: "white",
  белые: "white",
  beige: "beige",
  бежевый: "beige",
  бежевая: "beige",
  бежевое: "beige",
  cream: "cream",
  молочный: "cream",
  молочная: "cream",
  brown: "brown",
  коричневый: "brown",
  коричневая: "brown",
  burgundy: "burgundy",
  wine: "burgundy",
  бордовый: "burgundy",
  бордовая: "burgundy",
  винный: "burgundy",
  navy: "navy",
  "navy blue": "navy",
  "темно-синий": "navy",
  "темно синий": "navy",
  "тёмно-синий": "navy",
  "тёмно синий": "navy",
  blue: "blue",
  "dark blue": "blue",
  синий: "blue",
  синяя: "blue",
  голубой: "blue",
  green: "green",
  зеленый: "green",
  зелёный: "green",
  red: "red",
  красный: "red",
  pink: "pink",
  розовый: "pink",
  purple: "purple",
  фиолетовый: "purple",
  yellow: "yellow",
  желтый: "yellow",
  жёлтый: "yellow",
  orange: "orange",
  оранжевый: "orange",
  gray: "gray",
  grey: "gray",
  серый: "gray",
  taupe: "taupe",
  тауп: "taupe",
  золотой: "gold",
  gold: "gold",
  серебряный: "silver",
  silver: "silver",
};

const SEASON_ALIASES: Record<string, string> = {
  spring: "spring",
  весна: "spring",
  summer: "summer",
  лето: "summer",
  autumn: "autumn",
  fall: "autumn",
  осень: "autumn",
  winter: "winter",
  зима: "winter",
  "all season": "all-season",
  "all seasons": "all-season",
  "year round": "all-season",
  "круглый год": "all-season",
};

const SUBCATEGORY_ALIASES: Record<string, string> = {
  "t shirt": "tshirt",
  tshirt: "tshirt",
  футболка: "tshirt",
  футболки: "tshirt",
  sweater: "sweater",
  свитер: "sweater",
  кофта: "sweater",
  turtleneck: "turtleneck",
  "turtle neck": "turtleneck",
  "mock neck": "turtleneck",
  "high neck": "turtleneck",
  водолазка: "turtleneck",
  водолазки: "turtleneck",
  гольф: "turtleneck",
  гольфы: "turtleneck",
  hoodie: "hoodie",
  худи: "hoodie",
  толстовка: "hoodie",
  blazer: "blazer",
  пиджак: "blazer",
  жакет: "blazer",
  shirt: "shirt",
  рубашка: "shirt",
  dress: "dress",
  платье: "dress",
  outerwear: "outerwear",
  coat: "outerwear",
  пальто: "outerwear",
  куртка: "outerwear",
  плащ: "outerwear",
  trench: "trench",
  "trench coat": "trench",
  тренч: "trench",
  skirt: "skirt",
  юбка: "skirt",
  shorts: "shorts",
  шорты: "shorts",
  pants: "pants",
  trousers: "pants",
  брюки: "pants",
  штаны: "pants",
  jeans: "jeans",
  джинсы: "jeans",
  sneakers: "sneakers",
  кеды: "sneakers",
  кроссовки: "sneakers",
  pumps: "pumps",
  туфли: "pumps",
  boots: "boots",
  сапоги: "boots",
  "ankle boots": "ankle-boots",
  ботинки: "ankle-boots",
  bag: "bag",
  сумка: "bag",
  сумки: "bag",
  "shoulder bag": "shoulder_bag",
  glasses: "glasses",
  очки: "glasses",
  headwear: "headwear",
  "головной убор": "headwear",
  jewelry: "jewelry",
  jewellery: "jewelry",
  украшения: "jewelry",
  бижутерия: "jewelry",
  "hair clip": "hair-clips",
  "hair clips": "hair-clips",
  hairclip: "hair-clips",
  hairclips: "hair-clips",
  barrette: "hair-clips",
  barrettes: "hair-clips",
  hairpin: "hair-clips",
  hairpins: "hair-clips",
  заколка: "hair-clips",
  заколки: "hair-clips",
  "заколка для волос": "hair-clips",
  "заколки для волос": "hair-clips",
};

function normalizeWardrobeToken(
  value: string,
  field: WardrobeNormalizedField,
): string {
  const normalized = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  const key = tokenKey(normalized);
  if (field === "color") return COLOR_ALIASES[key] ?? key;
  if (field === "season") return SEASON_ALIASES[key] ?? key;
  if (field === "subcategory") {
    return SUBCATEGORY_ALIASES[key] ?? key.replace(/\s+/g, "_");
  }
  if (field === "style" || field === "tag") return key.replace(/\s+/g, "-");
  return key;
}

export function normalizeWardrobeString(
  value: unknown,
  field: string,
  normalizedField: WardrobeNormalizedField,
  max = 80,
): string | null | undefined {
  const result = optionalString(value, field, max);
  if (result === undefined || result === null) return result;
  return normalizeWardrobeToken(result, normalizedField) || null;
}

export function normalizeWardrobeArray(
  value: unknown,
  field: string,
  normalizedField: WardrobeNormalizedField,
  maxItems = 30,
  maxLength = 80,
): string[] | undefined {
  const values = stringArray(value, field, maxItems, maxLength);
  if (values === undefined) return undefined;
  return [...new Set(values.map((item) =>
    normalizeWardrobeToken(item, normalizedField)
  ).filter(Boolean))];
}

function setOptional(
  metadata: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (value === undefined) return;
  if (value === null) delete metadata[key];
  else metadata[key] = value;
}

export function wardrobeMetadata(
  input: WardrobeItemInput | WardrobeItemUpdate,
  existing: unknown = {},
  status?: "active" | "archived",
): JsonObject {
  const metadata = cloneMetadata(existing) as Record<string, unknown>;
  setOptional(
    metadata,
    "subcategory",
    normalizeWardrobeString(input.subcategory, "subcategory", "subcategory"),
  );
  setOptional(
    metadata,
    "material",
    optionalString(input.material, "material", 80),
  );
  setOptional(
    metadata,
    "pattern",
    optionalString(input.pattern, "pattern", 80),
  );
  setOptional(metadata, "fit", optionalString(input.fit, "fit", 80));

  const length = normalizeWardrobeString(
    input.length,
    "length",
    "length",
    80,
  );
  setOptional(metadata, "length", length);

  const seasons = normalizeWardrobeArray(
    input.seasons,
    "seasons",
    "season",
    8,
    40,
  );
  const season = normalizeWardrobeString(
    input.season,
    "season",
    "season",
    80,
  );
  if (seasons !== undefined) {
    metadata.seasons = seasons;
    setOptional(metadata, "season", seasons[0] ?? null);
  }
  if (season !== undefined) {
    setOptional(metadata, "season", season);
    if (season === null) delete metadata.seasons;
    else {
      const existingSeasons = Array.isArray(metadata.seasons)
        && seasons !== undefined
        ? metadata.seasons.filter((item): item is string => typeof item === "string")
        : [];
      metadata.seasons = [
        season,
        ...existingSeasons.filter((item) => item !== season),
      ];
    }
  }

  const styles = normalizeWardrobeArray(
    input.styles,
    "styles",
    "style",
    12,
    60,
  );
  if (styles !== undefined) metadata.styles = styles;

  const occasions = stringArray(input.occasions, "occasions", 12, 60);
  const occasion = optionalString(input.occasion, "occasion", 60);
  if (occasions !== undefined) {
    setOptional(metadata, "occasions", occasions);
    setOptional(metadata, "occasion", occasions[0] ?? null);
  }
  if (occasion !== undefined) {
    setOptional(metadata, "occasion", occasion);
    if (occasion === null) delete metadata.occasions;
    else if (occasions === undefined) metadata.occasions = [occasion];
  }

  const colors = normalizeWardrobeArray(
    input.colors,
    "colors",
    "color",
    12,
    50,
  );
  if (colors !== undefined) setOptional(metadata, "colors", colors);
  const color = normalizeWardrobeString(input.color, "color", "color", 80);
  if (color !== undefined) {
    setOptional(metadata, "color", color);
    if (color === null) delete metadata.colors;
    else {
      const existingColors = Array.isArray(metadata.colors)
        && colors !== undefined
        ? metadata.colors.filter((item): item is string => typeof item === "string")
        : [];
      metadata.colors = [
        color,
        ...existingColors.filter((item) => item !== color),
      ];
    }
  }
  if (input.favorite !== undefined) metadata.favorite = Boolean(input.favorite);
  const tags = normalizeWardrobeArray(input.tags, "tags", "tag", 20, 50);
  if (tags !== undefined) metadata.tags = tags;
  if (status) metadata.status = status;
  return metadata as JsonObject;
}

export function outfitMetadata(
  input: {
    occasion?: string | null;
    season?: string | null;
    tags?: string[];
    favorite?: boolean;
  },
  existing: unknown = {},
  status?: "active" | "archived",
): JsonObject {
  const metadata = cloneMetadata(existing) as Record<string, unknown>;
  setOptional(
    metadata,
    "occasion",
    optionalString(input.occasion, "occasion", 80),
  );
  setOptional(metadata, "season", optionalString(input.season, "season", 80));
  const tags = stringArray(input.tags, "tags", 20, 50);
  if (tags !== undefined) metadata.tags = tags;
  if (input.favorite !== undefined) metadata.favorite = Boolean(input.favorite);
  if (status) metadata.status = status;
  return metadata as JsonObject;
}

export function searchTerm(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const term = requiredString(value, "query", 100).replace(/[*,%(),]/g, " ")
    .replace(/\s+/g, " ").trim();
  return term || undefined;
}

export function lower(value: unknown): string {
  return typeof value === "string" ? value.toLocaleLowerCase() : "";
}

export function nextUtcDay(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString();
}

export function safeImagePath(
  value: unknown,
  userId: string,
): string | null | undefined {
  const path = optionalString(value, "imagePath", 500);
  if (path === undefined || path === null) return path;
  if (
    path.includes("..") || path.startsWith("/") ||
    !path.startsWith(`${userId}/`)
  ) {
    throw new AppError(
      "invalid_input",
      "imagePath must point to the authenticated user folder.",
    );
  }
  return path;
}

export function profilePreferenceInput(
  value: unknown,
): ProfilePreferencesInput {
  const input = asRecord(value);
  const result: ProfilePreferencesInput = {};
  const lists: Array<keyof ProfilePreferencesInput> = [
    "styleTags",
    "preferredColors",
    "avoidedColors",
    "preferredBrands",
    "dislikedBrands",
    "preferredFits",
  ];
  lists.forEach((key) => {
    const values = stringArray(
      input[key],
      key,
      key === "styleTags" ? 12 : 20,
      80,
    );
    if (values === undefined) return;
    Object.assign(result, { [key]: values });
  });
  if (input.clothingSizes !== undefined) {
    if (
      !input.clothingSizes || typeof input.clothingSizes !== "object" ||
      Array.isArray(input.clothingSizes)
    ) {
      throw new AppError("invalid_input", "clothingSizes is invalid.");
    }
    const sizes = asRecord(input.clothingSizes);
    if (Object.keys(sizes).length > 20) {
      throw new AppError("invalid_input", "clothingSizes has too many values.");
    }
    result.clothingSizes = Object.fromEntries(
      Object.entries(sizes).map(([key, item]) => {
        if (
          !/^[A-Za-z0-9_-]{1,40}$/.test(key) || typeof item !== "string" ||
          item.trim().length > 40
        ) {
          throw new AppError("invalid_input", "clothingSizes is invalid.");
        }
        return [key, item.trim()];
      }),
    );
  }
  const shoeSize = optionalString(input.shoeSize, "shoeSize", 40);
  const gender = optionalString(input.gender, "gender", 60);
  const styleNotes = optionalString(input.styleNotes, "styleNotes", 1000);
  if (shoeSize !== undefined) result.shoeSize = shoeSize;
  if (gender !== undefined) result.gender = gender;
  if (styleNotes !== undefined) result.styleNotes = styleNotes;
  if (input.height !== undefined) {
    if (
      input.height !== null &&
      (typeof input.height !== "number" || !Number.isFinite(input.height) ||
        input.height < 40 || input.height > 250)
    ) {
      throw new AppError("invalid_input", "height must be between 40 and 250.");
    }
    result.height = input.height as number | null;
  }
  return result;
}
