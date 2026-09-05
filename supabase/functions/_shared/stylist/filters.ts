import type { WardrobeItemDto } from "../types.ts";
import type {
  GenerateOutfitsInput,
  StylistContext,
  StylistItem,
} from "./types.ts";

const DEFAULT_MAX_ITEMS = 80;

const lower = (value: unknown): string => String(value ?? "").toLocaleLowerCase();
const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];

function containsAny(value: unknown, terms: string[]): boolean {
  const text = lower(value);
  return terms.some((term) => text.includes(term));
}

function allItemText(item: StylistItem): string {
  return [
    item.category,
    item.subcategory,
    ...item.colors,
    ...item.secondaryColors,
    item.material,
    item.pattern,
    ...item.season,
    ...item.styles,
    ...item.occasions,
    item.fit,
    item.silhouette,
    item.length,
    item.brand,
    item.notes,
  ].map(lower).join(" ");
}

export function toStylistItem(
  item: WardrobeItemDto,
  wearCount = item.wearCount ?? 0,
  lastWornAt = item.lastWornAt ?? null,
  feedbackScore = 0,
): StylistItem {
  const colors = item.colors?.length
    ? item.colors
    : item.color
    ? [item.color]
    : [];
  const season = item.seasons?.length
    ? item.seasons
    : item.season
    ? [item.season]
    : [];
  return {
    itemId: String(item.id),
    category: item.category,
    subcategory: item.subcategory ?? null,
    colors: [...new Set(colors.map(String))],
    secondaryColors: list(item.secondaryColors),
    material: item.material ?? null,
    pattern: item.pattern ?? null,
    season: [...new Set(season.map(String))],
    styles: list(item.styles),
    occasions: list(item.occasions),
    formality: item.formality ?? null,
    fit: item.fit ?? null,
    silhouette: item.silhouette ?? null,
    length: item.length ?? null,
    warmth: item.warmth ?? null,
    waterproof: item.waterproof ?? null,
    statementLevel: item.statementLevel ?? null,
    imageUrl: item.imageUrl ?? null,
    brand: item.brand ?? null,
    notes: item.notes ?? null,
    wearCount: Number.isFinite(Number(wearCount)) ? Number(wearCount) : 0,
    lastWornAt,
    feedbackScore: Number.isFinite(Number(feedbackScore)) ? Number(feedbackScore) : 0,
    userFavorite: Boolean(item.favorite),
  };
}

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function temperature(context: StylistContext): number | null {
  return numeric(context.temperature ?? context.feelsLike);
}

function occasionText(context: StylistContext, prompt: string): string {
  return lower([context.occasion, prompt].filter(Boolean).join(" "));
}

function styleScore(item: StylistItem, input: GenerateOutfitsInput): number {
  const text = allItemText(item);
  const profile = input.styleProfile;
  let score = 0;
  if (profile.preferredStyles.some((style) => text.includes(lower(style)))) score += 8;
  if (profile.dislikedStyles.some((style) => text.includes(lower(style)))) score -= 12;
  if (profile.favoriteColors.some((color) =>
    item.colors.some((candidate) => lower(candidate).includes(lower(color)))
  )) score += 7;
  if (profile.dislikedColors.some((color) =>
    item.colors.some((candidate) => lower(candidate).includes(lower(color)))
  )) score -= 16;
  if (profile.preferredFits.some((fit) => text.includes(lower(fit)))) score += 5;
  if (profile.dislikedFits.some((fit) => text.includes(lower(fit)))) score -= 10;
  if (profile.favoriteItems.includes(item.itemId)) score += 6;
  if (item.userFavorite) score += 5;
  return score;
}

function weatherScore(item: StylistItem, context: StylistContext): number {
  const value = temperature(context);
  if (value === null) return 0;
  const text = allItemText(item);
  let score = 0;
  if (value <= 5) {
    if ((item.warmth ?? 0) >= 4) score += 14;
    if (item.category === "outer" || containsAny(text, ["coat", "jacket", "пальто", "куртк", "тренч"])) score += 12;
    if (containsAny(text, ["shorts", "шорт", "t-shirt", "tshirt", "футбол"])) score -= 18;
  } else if (value <= 15) {
    if ((item.warmth ?? 0) >= 3) score += 6;
    if (item.category === "outer") score += 8;
    if (containsAny(text, ["shorts", "шорт"])) score -= 14;
  } else if (value >= 25) {
    if ((item.warmth ?? 0) >= 5) score -= 22;
    if (item.category === "outer") score -= 16;
    if (containsAny(text, ["shorts", "шорт", "linen", "лён", "футбол", "tshirt"])) score += 8;
  } else if ((item.warmth ?? 0) === 3) {
    score += 4;
  }

  const precipitation = numeric(context.precipitation);
  if (precipitation !== null && precipitation > 0) {
    if (item.waterproof === true || item.category === "outer") score += 8;
    if (item.category === "shoes" && containsAny(text, ["boots", "сапог", "ботин"])) score += 5;
  }
  return score;
}

function occasionScore(item: StylistItem, context: StylistContext, prompt: string): number {
  const request = occasionText(context, prompt);
  const text = allItemText(item);
  let score = 0;
  const formal = containsAny(request, [
    "formal",
    "dinner",
    "ужин",
    "свадь",
    "вечер",
    "наряд",
    "офис",
    "делов",
  ]);
  const casual = containsAny(request, [
    "casual",
    "everyday",
    "прогул",
    "повсед",
    "кэжуал",
    "weekend",
  ]);
  if (formal) {
    score += item.formality !== null ? item.formality * 3 : 0;
    if (item.formality !== null && item.formality <= 1) score -= 10;
    if (containsAny(text, ["gym", "спорт", "hoodie", "худи"])) score -= 8;
  }
  if (casual) {
    if (item.formality !== null && item.formality >= 5) score -= 4;
    if (containsAny(text, ["sneaker", "кроссов", "jeans", "джинс"])) score += 4;
  }
  if (item.occasions.some((value) => request.includes(lower(value)))) score += 8;
  return score;
}

function recencyScore(item: StylistItem): number {
  const lastWornAt = item.lastWornAt;
  if (!lastWornAt) return Math.max(0, 3 - Math.min(item.wearCount, 3));
  const timestamp = Date.parse(lastWornAt);
  if (!Number.isFinite(timestamp)) return 0;
  const days = Math.max(0, (Date.now() - timestamp) / 86_400_000);
  if (days < 2) return item.userFavorite ? -4 : -12;
  if (days < 7) return item.userFavorite ? 0 : -5;
  return Math.min(4, Math.floor(days / 30));
}

export function scoreStylistItem(
  item: StylistItem,
  input: GenerateOutfitsInput,
): number {
  const categoryBase: Record<string, number> = {
    top: 10,
    bottom: 10,
    shoes: 9,
    outer: 7,
    accessory: 2,
  };
  return (categoryBase[item.category] ?? 0) +
    styleScore(item, input) +
    weatherScore(item, input.context) +
    occasionScore(item, input.context, input.prompt) +
    recencyScore(item) +
    Math.max(-6, Math.min(6, item.feedbackScore)) +
    (item.statementLevel !== null && item.statementLevel >= 4 ? 1 : 0);
}

function ensureCategoryCoverage(
  selected: StylistItem[],
  ranked: StylistItem[],
  category: string,
): void {
  if (selected.some((item) => item.category === category)) return;
  const candidate = ranked.find((item) => item.category === category);
  if (candidate) selected.push(candidate);
}

export interface FilteredWardrobe {
  items: StylistItem[];
  scores: Record<string, number>;
}

export function filterWardrobe(
  items: StylistItem[],
  input: GenerateOutfitsInput,
  maxItems = DEFAULT_MAX_ITEMS,
): FilteredWardrobe {
  const scores: Record<string, number> = {};
  const ranked = [...items].sort((left, right) => {
    const rightScore = scoreStylistItem(right, input);
    const leftScore = scoreStylistItem(left, input);
    scores[right.itemId] = rightScore;
    scores[left.itemId] = leftScore;
    return rightScore - leftScore || left.itemId.localeCompare(right.itemId);
  });
  const selected: StylistItem[] = [];
  const add = (item: StylistItem | undefined) => {
    if (!item || selected.some((value) => value.itemId === item.itemId)) return;
    selected.push(item);
  };
  [input.selectedItemId, ...input.currentItemIds, ...input.lockedItemIds]
    .filter(Boolean)
    .forEach((itemId) => add(items.find((item) => item.itemId === itemId)));
  // Keep a minimal base for the model even when soft scoring strongly favors
  // accessories or outerwear.
  ["top", "bottom", "shoes"].forEach((category) =>
    ensureCategoryCoverage(selected, ranked, category)
  );
  ranked.forEach((item) => {
    if (selected.length >= Math.max(1, Math.min(maxItems, 100))) return;
    add(item);
  });

  const limited = selected.slice(0, Math.max(1, Math.min(maxItems, 100)));
  return {
    items: limited,
    scores,
  };
}
