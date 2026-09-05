/**
 * Controlled vocabulary used by the stylist contract. Existing wardrobe rows
 * remain backward compatible; this vocabulary is applied to new AI output
 * and is also shown to the model as the canonical spelling.
 */
export const STYLIST_VOCABULARY = {
  category: ["outer", "top", "bottom", "shoes", "accessory"],
  style: [
    "casual",
    "smart_casual",
    "minimal",
    "classic",
    "sporty",
    "streetwear",
    "romantic",
    "boho",
    "edgy",
    "preppy",
    "business",
    "evening",
    "everyday",
  ],
  occasion: [
    "everyday",
    "work",
    "business",
    "smart_casual",
    "formal_event",
    "evening",
    "date",
    "party",
    "travel",
    "vacation",
    "sport",
    "outdoor",
  ],
  season: ["spring", "summer", "autumn", "winter", "all-season"],
  fit: ["slim", "regular", "relaxed", "oversized", "tailored", "loose"],
  silhouette: [
    "straight",
    "fitted",
    "relaxed",
    "oversized",
    "a_line",
    "wide_leg",
    "slim_leg",
    "structured",
    "fluid",
  ],
  length: ["cropped", "regular", "long", "midi", "maxi", "mini", "ankle"],
  pattern: [
    "solid",
    "stripe",
    "check",
    "plaid",
    "floral",
    "geometric",
    "animal",
    "logo",
    "abstract",
  ],
  material: [
    "cotton",
    "linen",
    "wool",
    "cashmere",
    "denim",
    "leather",
    "suede",
    "silk",
    "synthetic",
    "knit",
    "unknown",
  ],
  color: [
    "black",
    "white",
    "gray",
    "beige",
    "cream",
    "brown",
    "taupe",
    "navy",
    "blue",
    "green",
    "red",
    "pink",
    "purple",
    "yellow",
    "orange",
    "burgundy",
    "gold",
    "silver",
  ],
} as const;

export type StylistStyle = (typeof STYLIST_VOCABULARY.style)[number];
export type StylistOccasion = (typeof STYLIST_VOCABULARY.occasion)[number];
export type StylistSeason = (typeof STYLIST_VOCABULARY.season)[number];

type VocabularyField = keyof typeof STYLIST_VOCABULARY;

const aliases: Readonly<Record<string, string>> = {
  minimalist: "minimal",
  minimalistic: "minimal",
  clean: "minimal",
  "clean minimal": "minimal",
  sport: "sporty",
  athletic: "sporty",
  "smart casual": "smart_casual",
  "smart-casual": "smart_casual",
  "formal event": "formal_event",
  formal: "formal_event",
  daily: "everyday",
  day_to_day: "everyday",
  "all season": "all-season",
  "all seasons": "all-season",
  "a-line": "a_line",
  "wide leg": "wide_leg",
  "slim leg": "slim_leg",
};

function key(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[‐‑–—-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalVocabularyValue(
  value: unknown,
  field: VocabularyField,
): string | null {
  const normalized = key(value);
  if (!normalized) return null;
  const candidate = aliases[normalized] ?? normalized.replace(/\s+/g, "_");
  const allowed = STYLIST_VOCABULARY[field] as readonly string[];
  return allowed.includes(candidate) ? candidate : null;
}

export function canonicalVocabularyList(
  value: unknown,
  field: VocabularyField,
  max = 8,
): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((item) => canonicalVocabularyValue(item, field))
    .filter((item): item is string => Boolean(item))
    .slice(0, max))];
}

export const STYLIST_VOCABULARY_PROMPT = `# Controlled vocabulary
Возвращай только значения из этих словарей. Если значение неизвестно или не подходит — используй пустой массив или null, а не новое слово.
${JSON.stringify(STYLIST_VOCABULARY, null, 2)}`;
