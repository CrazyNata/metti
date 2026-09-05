import type {
  CriticResult,
  GenerateOutfitsInput,
  OutfitCreativity,
  OutfitSuggestion,
  StylistItem,
  StylistMode,
} from "./types.ts";

function clamp(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 0;
}

function jaccard(left: string[], right: string[]): number {
  const a = new Set(left);
  const b = new Set(right);
  const union = new Set([...a, ...b]);
  if (!union.size) return 1;
  let intersection = 0;
  a.forEach((value) => {
    if (b.has(value)) intersection += 1;
  });
  return intersection / union.size;
}

function withIssues(
  outfit: OutfitSuggestion,
  issues: string[],
): OutfitSuggestion {
  if (!issues.length) return outfit;
  return {
    ...outfit,
    warnings: [...new Set([...outfit.warnings, ...issues.map((issue) => issue.slice(0, 160))])].slice(0, 8),
  };
}

export interface RankedOutfit extends OutfitSuggestion {
  stylistScore: number;
  criticScore: number | null;
  finalScore: number;
}

export function rankOutfits(
  outfits: OutfitSuggestion[],
  criticResults: CriticResult[] = [],
  maxCount = 5,
  diversityThreshold = 0.7,
): RankedOutfit[] {
  const critics = new Map(criticResults.map((result) => [result.outfitIndex, result]));
  const ranked = outfits.map((outfit, index) => {
    const critic = critics.get(index);
    const stylistScore = clamp(outfit.score);
    const criticScore = critic ? clamp(critic.criticScore) : null;
    const finalScore = criticScore === null
      ? Math.round(stylistScore)
      : Math.round(stylistScore * 0.4 + criticScore * 0.6);
    return {
      ...withIssues(outfit, critic?.issues ?? []),
      score: finalScore,
      stylistScore,
      criticScore,
      finalScore,
    };
  }).sort((left, right) => right.finalScore - left.finalScore || right.stylistScore - left.stylistScore);

  const diverse: RankedOutfit[] = [];
  for (const outfit of ranked) {
    if (diverse.some((kept) => jaccard(kept.itemIds, outfit.itemIds) >= diversityThreshold)) continue;
    diverse.push(outfit);
    if (diverse.length >= Math.max(1, Math.min(maxCount, 5))) break;
  }
  return diverse;
}

export function itemIdsForSimpleFallback(items: StylistItem[]): string[] {
  const selected: StylistItem[] = [];
  const add = (item: StylistItem | undefined) => {
    if (!item || selected.some((value) => value.itemId === item.itemId)) return;
    selected.push(item);
  };
  add(items.find((item) => item.subcategory === "dress"));
  if (!selected.length) {
    add(items.find((item) => item.category === "top" && item.subcategory !== "dress"));
    add(items.find((item) => item.category === "bottom"));
  }
  add(items.find((item) => item.category === "shoes"));
  add(items.find((item) => item.category === "outer"));
  add(items.find((item) => item.category === "accessory" && item.subcategory === "bag"));
  return selected.map((item) => item.itemId).slice(0, 6);
}

function normalized(value: unknown): string {
  return String(value ?? "").toLocaleLowerCase();
}

function isDress(item: StylistItem | undefined): boolean {
  return item?.category === "dress" || normalized(item?.subcategory) === "dress";
}

function isOuterLayer(item: StylistItem | undefined): boolean {
  if (!item) return false;
  return item.category === "outer" || [
    "outerwear",
    "blazer",
    "jacket",
    "coat",
    "trench",
    "parka",
    "bomber",
    "cardigan",
  ].includes(normalized(item.subcategory));
}

function isBaseTop(item: StylistItem | undefined): boolean {
  return item?.category === "top" && !isDress(item) && !isOuterLayer(item);
}

function mentions(value: string, terms: string[]): boolean {
  const text = normalized(value);
  return terms.some((term) => text.includes(term));
}

function pickRotated(
  candidates: StylistItem[],
  used: Set<string>,
  offset: number,
): StylistItem | undefined {
  if (!candidates.length) return undefined;
  for (let step = 0; step < candidates.length; step += 1) {
    const candidate = candidates[(offset + step) % candidates.length];
    if (!used.has(candidate.itemId)) return candidate;
  }
  return undefined;
}

export interface FallbackOutfitOptions {
  mode: StylistMode;
  prompt?: string;
  selectedItemId?: string;
  currentItemIds?: string[];
  lockedItemIds?: string[];
  preferredCreativity?: OutfitCreativity;
  variantOffset?: number;
}

function creativityForVariant(
  options: FallbackOutfitOptions,
  variant: number,
): OutfitCreativity {
  if (options.preferredCreativity) return options.preferredCreativity;
  return variant % 3 === 0 ? "safe" : variant % 3 === 1 ? "balanced" : "bold";
}

/**
 * Build several real-wardrobe combinations when the provider is unavailable
 * or returns too few materially different candidates. Anchors are retained,
 * while base layers rotate so a jacket-and-shoes request is still a complete
 * outfit rather than a two-item pair.
 */
export function fallbackOutfitSuggestions(
  items: StylistItem[],
  options: FallbackOutfitOptions,
  language: "ru" | "en" = "ru",
  count = 3,
): OutfitSuggestion[] {
  const byId = new Map(items.map((item) => [item.itemId, item]));
  const tops = items.filter(isBaseTop);
  const bottoms = items.filter((item) => item.category === "bottom");
  const shoes = items.filter((item) => item.category === "shoes");
  const dresses = items.filter(isDress);
  const outer = items.filter(isOuterLayer);
  const accessories = items.filter((item) => item.category === "accessory");
  const requestedCount = Math.max(1, Math.min(count, 5));
  const variantOffset = Math.abs(Math.trunc(options.variantOffset ?? 0));
  const prompt = options.prompt ?? "";
  const wantsOuter = mentions(prompt, [
    "куртк",
    "jacket",
    "coat",
    "пальто",
    "тренч",
    "блейзер",
    "blazer",
    "outerwear",
  ]);
  const allowsAccessories = !mentions(prompt, [
    "только",
    "больше ничего",
    "nothing else",
    "без аксессуар",
    "no accessory",
  ]);
  const anchors = [
    options.selectedItemId,
    ...(options.lockedItemIds ?? []),
  ].filter((value): value is string =>
    typeof value === "string" && byId.has(value)
  );
  const current = options.mode === "restyle"
    ? (options.currentItemIds ?? []).filter((value) => byId.has(value))
    : [];
  const results: OutfitSuggestion[] = [];
  const seen = new Set<string>();

  for (let variant = 0; variant < requestedCount; variant += 1) {
    const ids: string[] = [];
    const used = new Set<string>();
    const add = (item: StylistItem | undefined) => {
      if (!item || used.has(item.itemId)) return;
      used.add(item.itemId);
      ids.push(item.itemId);
    };
    anchors.forEach((id) => add(byId.get(id)));
    // Keep the current outfit as the first restyle fallback. Later variants
    // retain only locked items, allowing the base to rotate.
    if (variant === 0) current.forEach((id) => add(byId.get(id)));

    let hasDress = ids.some((id) => isDress(byId.get(id)));
    let hasTop = ids.some((id) => isBaseTop(byId.get(id)));
    let hasBottom = ids.some((id) => byId.get(id)?.category === "bottom");
    let hasShoes = ids.some((id) => byId.get(id)?.category === "shoes");
    let hasOuter = ids.some((id) => isOuterLayer(byId.get(id)));

    if (!hasDress && !hasTop) {
      add(pickRotated(tops, used, variantOffset + variant));
      hasTop = ids.some((id) => isBaseTop(byId.get(id)));
    }
    if (!hasDress && !hasBottom) {
      add(pickRotated(bottoms, used, variantOffset + variant));
      hasBottom = ids.some((id) => byId.get(id)?.category === "bottom");
    }
    if (!hasDress && !hasTop && !hasBottom) {
      add(pickRotated(dresses, used, variantOffset + variant));
      hasDress = ids.some((id) => isDress(byId.get(id)));
    }
    if (shoes.length && !hasShoes) {
      add(pickRotated(shoes, used, variantOffset + variant));
      hasShoes = ids.some((id) => byId.get(id)?.category === "shoes");
    }
    if (outer.length && !hasOuter && (wantsOuter || variant === 0)) {
      add(pickRotated(outer, used, variantOffset + variant));
      hasOuter = ids.some((id) => isOuterLayer(byId.get(id)));
    }
    if (allowsAccessories && accessories.length && variant % 2 === 0) {
      add(pickRotated(accessories, used, variantOffset + variant));
    }

    const key = ids.join("|");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    results.push({
      name: language === "en" ? `Wardrobe look ${results.length + 1}` : `Образ ${results.length + 1}`,
      itemIds: ids,
      creativity: creativityForVariant(options, variant),
      style: ["everyday"],
      occasion: ["everyday"],
      score: Math.max(40, 58 - variant * 2),
      explanation: language === "en"
        ? "A complete combination from items already in your wardrobe."
        : "Полный образ из вещей, которые уже есть в вашем гардеробе.",
      warnings: [],
    });
  }
  return results;
}
