import { isBaseTop, isDress, isOuterLayer } from "./formula.ts";
import type {
  GenerateOutfitsInput,
  OutfitSuggestion,
  StylistItem,
} from "./types.ts";

function lower(value: unknown): string {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase();
}

function number(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function activitiesFor(input: GenerateOutfitsInput): string[] {
  const value: unknown = input.context.activities;
  const values: unknown[] = Array.isArray(value)
    ? value
    : typeof value === "string"
    ? value.split(/[,;]+/u)
    : [];
  return values
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLocaleLowerCase())
    .filter(Boolean);
}

function itemText(item: StylistItem): string {
  return [
    item.name,
    item.description,
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

function containsAny(value: unknown, terms: string[]): boolean {
  const text = lower(value);
  return terms.some((term) => text.includes(term));
}

function durationDays(input: GenerateOutfitsInput): number {
  const value = number(
    input.context.durationDays ?? input.context.tripDays ?? input.context.duration,
  );
  return value === null ? 7 : Math.max(1, Math.min(60, Math.round(value)));
}

function laundryAvailable(input: GenerateOutfitsInput): boolean {
  return input.context.laundryAvailable === true ||
    input.context.laundry === true ||
    lower(input.context.laundryAvailable) === "yes";
}

function temperature(input: GenerateOutfitsInput): number | null {
  return number(input.context.temperature ?? input.context.feelsLike);
}

function needsLayer(input: GenerateOutfitsInput): boolean {
  const current = temperature(input);
  const weatherCode = number(input.context.weatherCode ?? input.context.weather_code);
  const precipitation = number(input.context.precipitation);
  if (current !== null && current <= 15) return true;
  if (weatherCode !== null && (weatherCode >= 51 || weatherCode >= 71)) return true;
  return precipitation !== null && precipitation > 0;
}

function includesActivity(input: GenerateOutfitsInput, terms: string[]): boolean {
  const activities = activitiesFor(input);
  return activities.some((activity) => terms.some((term) => activity.includes(term))) ||
    containsAny(input.prompt, terms) ||
    containsAny(input.context.occasion, terms);
}

function colorCount(item: StylistItem): number {
  return new Set([...item.colors, ...item.secondaryColors].map(lower).filter(Boolean)).size;
}

/**
 * Rank wardrobe items for a capsule rather than for one isolated outfit.
 * Versatility is deliberately a modest bonus: weather, explicit activities,
 * style profile and exact anchors still come from the regular stylist score.
 */
export function scorePackingItem(
  item: StylistItem,
  input: GenerateOutfitsInput,
): number {
  const text = itemText(item);
  let score = 0;
  const category = isDress(item) ? "dress" : item.category;
  const categoryBase: Record<string, number> = {
    top: 15,
    bottom: 14,
    dress: 12,
    shoes: 12,
    outer: 9,
    accessory: 3,
  };
  score += categoryBase[category] ?? 0;

  if (containsAny(text, [
    "basic",
    "базов",
    "minimal",
    "однотон",
    "neutral",
    "нейтрал",
    "classic",
    "классич",
    "everyday",
    "повседнев",
    "travel",
    "универсал",
  ])) score += 7;
  if (input.styleProfile.preferredStyles.some((style) => containsAny(text, [lower(style)]))) score += 5;
  if (input.styleProfile.dislikedStyles.some((style) => containsAny(text, [lower(style)]))) score -= 8;
  if (input.styleProfile.favoriteColors.some((color) => item.colors.some((value) => lower(value).includes(lower(color))))) score += 4;
  if (input.styleProfile.dislikedColors.some((color) => item.colors.some((value) => lower(value).includes(lower(color))))) score -= 9;
  if (input.styleProfile.favoriteItems.includes(item.itemId)) score += 5;
  if (input.styleProfile.preferredFits.some((fit) => containsAny(text, [lower(fit)]))) score += 3;
  if (input.styleProfile.dislikedFits.some((fit) => containsAny(text, [lower(fit)]))) score -= 6;
  if (colorCount(item) <= 1) score += 3;
  if (item.statementLevel !== null && item.statementLevel >= 4) score -= 3;
  if (item.userFavorite) score += 4;
  score += Math.max(-4, Math.min(4, item.feedbackScore));
  score += Math.max(-3, 3 - Math.min(item.wearCount, 6));

  const current = temperature(input);
  if (current !== null) {
    if (current >= 24) {
      if (item.warmth !== null && item.warmth >= 5) score -= 14;
      if (containsAny(text, ["linen", "лён", "cotton", "хлопок", "shorts", "шорт", "sandal", "сандал"])) score += 5;
      if (isOuterLayer(item)) score -= 10;
    } else if (current <= 10) {
      if ((item.warmth ?? 0) >= 4) score += 8;
      if (isOuterLayer(item)) score += 9;
      if (containsAny(text, ["shorts", "шорт", "sandal", "сандал", "linen", "лён"])) score -= 10;
    } else if ((item.warmth ?? 0) === 3) {
      score += 3;
    }
  }
  if (needsLayer(input) && isOuterLayer(item)) score += 9;
  if (!needsLayer(input) && isOuterLayer(item) && current !== null && current >= 22) score -= 8;
  if (input.context.precipitation !== null && input.context.precipitation !== undefined) {
    const precipitation = number(input.context.precipitation);
    if (precipitation !== null && precipitation > 0) {
      if (item.waterproof === true || isOuterLayer(item)) score += 6;
      if (item.category === "shoes" && containsAny(text, ["boot", "сапог", "ботин"])) score += 4;
    }
  }

  const activities = activitiesFor(input);
  if (activities.some((activity) => ["beach", "пляж", "море", "pool", "бассейн"].some((term) => activity.includes(term)))) {
    if (containsAny(text, ["linen", "лён", "shorts", "шорт", "dress", "плать", "sandal", "сандал"])) score += 4;
  }
  if (includesActivity(input, ["dinner", "ужин", "evening", "вечер", "date", "свидан", "formal", "наряд"])) {
    if (isDress(item) || (item.formality !== null && item.formality >= 3)) score += 5;
  }
  if (includesActivity(input, ["walk", "прогул", "city", "город", "музей", "museum", "экскурс"])) {
    if (item.formality !== null && item.formality <= 4) score += 2;
  }
  if (includesActivity(input, ["hike", "поход", "горы", "mountain", "спорт", "sport"])) {
    if (containsAny(text, ["sport", "спортив", "sneaker", "кроссов", "waterproof", "мембран"])) score += 5;
    if (item.formality !== null && item.formality >= 5) score -= 4;
  }

  const season = lower(input.context.season);
  if (season && item.season.some((value) => lower(value).includes(season) || season.includes(lower(value)))) score += 4;
  if (laundryAvailable(input) && (isBaseTop(item) || isDress(item))) score -= 1;
  return score;
}

function targetCapsuleSize(input: GenerateOutfitsInput): number {
  const days = durationDays(input);
  const base = days <= 3 ? 6 : days <= 7 ? 9 : days <= 14 ? 11 : 13;
  return Math.max(6, Math.min(15, base + (laundryAvailable(input) ? -1 : 1)));
}

function duplicatePenalty(item: StylistItem, selected: StylistItem[]): number {
  const subcategory = lower(item.subcategory);
  const colors = new Set(item.colors.map(lower));
  return selected.reduce((penalty, value) => {
    if (value.category !== item.category && !isDress(value) && !isDress(item)) return penalty;
    const sameSubcategory = subcategory && subcategory === lower(value.subcategory);
    const sameColor = value.colors.some((color) => colors.has(lower(color)));
    return penalty + (sameSubcategory && sameColor ? 8 : sameSubcategory ? 3 : 0);
  }, 0);
}

function pickBest(
  pool: StylistItem[],
  selected: StylistItem[],
  input: GenerateOutfitsInput,
  count: number,
): void {
  for (let index = 0; index < count; index += 1) {
    const candidate = pool
      .filter((item) => !selected.some((value) => value.itemId === item.itemId))
      .map((item) => ({
        item,
        score: scorePackingItem(item, input) - duplicatePenalty(item, selected),
      }))
      .sort((left, right) => right.score - left.score || left.item.itemId.localeCompare(right.item.itemId))[0]?.item;
    if (!candidate) return;
    selected.push(candidate);
  }
}

export function selectPackingCapsule(
  items: StylistItem[],
  input: GenerateOutfitsInput,
): StylistItem[] {
  if (!items.length) return [];
  const ranked = [...items].sort((left, right) =>
    scorePackingItem(right, input) - scorePackingItem(left, input) ||
    left.itemId.localeCompare(right.itemId)
  );
  const selected: StylistItem[] = [];
  const byId = new Map(items.map((item) => [item.itemId, item]));
  [input.selectedItemId, ...input.lockedItemIds]
    .filter((id): id is string => typeof id === "string" && byId.has(id))
    .forEach((id) => {
      const value = byId.get(id);
      if (value && !selected.some((item) => item.itemId === value.itemId)) selected.push(value);
    });

  const tops = ranked.filter(isBaseTop);
  const dresses = ranked.filter(isDress);
  const bottoms = ranked.filter((item) => item.category === "bottom");
  const shoes = ranked.filter((item) => item.category === "shoes");
  const outer = ranked.filter(isOuterLayer);
  const bags = ranked.filter((item) => item.category === "accessory" && lower(item.subcategory) === "bag");
  const accessories = ranked.filter((item) => item.category === "accessory" && lower(item.subcategory) !== "bag");
  const days = durationDays(input);
  const includeDress = dresses.length > 0 && (
    !tops.length || !bottoms.length ||
    includesActivity(input, ["dinner", "ужин", "evening", "вечер", "date", "свидан", "formal", "наряд"])
  );
  if (includeDress) pickBest(dresses, selected, input, 1);
  pickBest(tops, selected, input, days <= 3 ? 1 : days <= 7 ? 2 : 3);
  pickBest(bottoms, selected, input, days <= 4 ? 1 : days <= 7 ? 2 : 3);
  pickBest(shoes, selected, input, days <= 4 ? 1 : 2);
  if (needsLayer(input)) pickBest(outer, selected, input, 1);
  pickBest(bags, selected, input, 1);
  if (days >= 5 || includeDress) pickBest(accessories, selected, input, 1);
  pickBest(ranked, selected, input, targetCapsuleSize(input) - selected.length);
  return selected.slice(0, targetCapsuleSize(input));
}

function outfitKey(itemIds: string[]): string {
  return [...new Set(itemIds)].sort().join("|");
}

function outfitFrom(
  itemIds: StylistItem[],
  index: number,
  language: "ru" | "en",
): OutfitSuggestion {
  const ids = [...new Set(itemIds.map((item) => item.itemId))];
  return {
    name: language === "en" ? `Trip look ${index + 1}` : `Образ для отпуска ${index + 1}`,
    itemIds: ids,
    creativity: index === 0 ? "safe" : index === 1 ? "balanced" : "bold",
    style: ["travel", "everyday"],
    occasion: ["trip"],
    score: Math.max(52, 76 - index * 3),
    explanation: language === "en"
      ? "A practical combination from the selected travel capsule."
      : "Практичный образ из выбранной отпускной капсулы.",
    warnings: [],
  };
}

/** Build complete offline candidates from the same exact capsule IDs. */
export function packingOutfitSuggestions(
  items: StylistItem[],
  input: GenerateOutfitsInput,
  language: "ru" | "en" = "ru",
  count = 3,
): OutfitSuggestion[] {
  const capsule = selectPackingCapsule(items, input);
  if (!capsule.length) return [];
  const byCategory = (predicate: (item: StylistItem) => boolean) => capsule.filter(predicate);
  const tops = byCategory(isBaseTop);
  const dresses = byCategory(isDress);
  const bottoms = byCategory((item) => item.category === "bottom");
  const shoes = byCategory((item) => item.category === "shoes");
  const layers = byCategory(isOuterLayer);
  const bags = byCategory((item) => item.category === "accessory" && lower(item.subcategory) === "bag");
  const accessories = byCategory((item) => item.category === "accessory" && lower(item.subcategory) !== "bag");
  const requested = Math.max(1, Math.min(5, Math.round(count)));
  const results: OutfitSuggestion[] = [];
  const seen = new Set<string>();
  const add = (values: Array<StylistItem | undefined>) => {
    const selected = values.filter((item): item is StylistItem => Boolean(item));
    const hasBase = selected.some(isDress) || (selected.some(isBaseTop) && selected.some((item) => item.category === "bottom"));
    if (!hasBase || (items.some((item) => item.category === "shoes") && !selected.some((item) => item.category === "shoes"))) return;
    const key = outfitKey(selected.map((item) => item.itemId));
    if (!key || seen.has(key)) return;
    seen.add(key);
    results.push(outfitFrom(selected, results.length, language));
  };

  const dressWanted = dresses.length > 0 && includesActivity(input, ["dinner", "ужин", "evening", "вечер", "date", "свидан", "formal", "наряд"]);
  for (let index = 0; index < requested * 2 && results.length < requested; index += 1) {
    const top = tops.length ? tops[index % tops.length] : undefined;
    const bottom = bottoms.length ? bottoms[(index + (dressWanted ? 1 : 0)) % bottoms.length] : undefined;
    const shoe = shoes.length ? shoes[index % shoes.length] : undefined;
    const layer = layers.length && (needsLayer(input) || index === 0) ? layers[index % layers.length] : undefined;
    const bag = bags.length && index % 2 === 0 ? bags[0] : undefined;
    const accent = accessories.length && index % 3 === 1 ? accessories[index % accessories.length] : undefined;
    add([top, bottom, shoe, layer, bag, accent]);
  }
  if (dressWanted || !results.length) {
    for (let index = 0; index < dresses.length && results.length < requested; index += 1) {
      add([
        dresses[index],
        shoes[index % Math.max(1, shoes.length)],
        layers.length && (needsLayer(input) || index === 0) ? layers[index % layers.length] : undefined,
        bags[0],
      ]);
    }
  }
  return results.slice(0, requested);
}
