import { colorHarmonyForOutfit, colorHarmonyLabel } from "./color-harmony.ts";
import { compositionQualityForOutfit } from "./composition.ts";
import { scoreStylistItem } from "./filters.ts";
import type {
  GenerateOutfitsInput,
  OutfitSuggestion,
  StylistItem,
} from "./types.ts";

export interface CuratedStylistCandidate {
  itemIds: string[];
  score: number;
  formula: string;
  palette: string;
  notes: string[];
}

function lower(value: unknown): string {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase();
}

function hasAny(value: unknown, terms: string[]): boolean {
  const text = lower(value);
  return terms.some((term) => text.includes(term));
}

function isDress(item: StylistItem | undefined): boolean {
  return item?.category === "dress" || lower(item?.subcategory) === "dress";
}

function isOuter(item: StylistItem | undefined): boolean {
  if (!item) return false;
  return item.category === "outer" || hasAny(item.subcategory, [
    "outerwear",
    "blazer",
    "jacket",
    "coat",
    "trench",
    "parka",
    "bomber",
    "cardigan",
    "куртк",
    "пальто",
    "тренч",
    "жакет",
    "кардиган",
  ]);
}

function isBaseTop(item: StylistItem | undefined): boolean {
  return item?.category === "top" && !isDress(item) && !isOuter(item);
}

function isShoes(item: StylistItem | undefined): boolean {
  return item?.category === "shoes";
}

function topCandidates(
  items: StylistItem[],
  input: GenerateOutfitsInput,
  predicate: (item: StylistItem) => boolean,
  limit = 12,
): StylistItem[] {
  return items
    .filter(predicate)
    .sort((left, right) =>
      scoreStylistItem(right, input) - scoreStylistItem(left, input) ||
      left.itemId.localeCompare(right.itemId)
    )
    .slice(0, limit);
}

function fixedFor(
  fixed: StylistItem[],
  predicate: (item: StylistItem) => boolean,
  fallback: StylistItem[],
): StylistItem[] {
  const exact = fixed.filter(predicate);
  return exact.length ? exact : fallback;
}

function containsAll(itemIds: string[], requiredIds: string[]): boolean {
  const set = new Set(itemIds);
  return requiredIds.every((id) => set.has(id));
}

function overlap(left: string[], right: string[]): number {
  const rightValues = new Set(right.map(lower).filter(Boolean));
  return left.map(lower).filter((value) => value && rightValues.has(value)).length;
}

function pairCoherence(items: StylistItem[]): number {
  const garments = items.filter((item) => item.category !== "accessory");
  if (garments.length < 2) return 50;
  let score = 50;
  for (let left = 0; left < garments.length; left += 1) {
    for (let right = left + 1; right < garments.length; right += 1) {
      const first = garments[left];
      const second = garments[right];
      const sharedStyles = overlap(first.styles, second.styles);
      const sharedOccasions = overlap(first.occasions, second.occasions);
      if (sharedStyles) score += Math.min(5, sharedStyles * 2);
      if (sharedOccasions) score += Math.min(3, sharedOccasions);
      if (first.formality !== null && second.formality !== null) {
        const distance = Math.abs(first.formality - second.formality);
        if (distance <= 1) score += 2;
        if (distance >= 2) score -= Math.min(7, Math.round(distance * 2));
      }
      const firstStatement = (first.statementLevel ?? 0) >= 3;
      const secondStatement = (second.statementLevel ?? 0) >= 3;
      if (firstStatement && secondStatement) score -= 4;
      else if (firstStatement !== secondStatement) score += 1;
    }
  }
  return Math.max(0, Math.min(100, score));
}

function weatherNeedsLayer(input: GenerateOutfitsInput): boolean {
  const temperature = Number(input.context.temperature ?? input.context.feelsLike);
  if (Number.isFinite(temperature) && temperature <= 15) return true;
  return hasAny([
    input.prompt,
    input.instruction,
    input.context.weather,
    input.context.occasion,
  ].join(" "), [
    "куртк",
    "пальто",
    "тренч",
    "жакет",
    "jacket",
    "coat",
    "trench",
    "blazer",
    "outerwear",
  ]);
}

function candidateOutfit(itemIds: string[]): OutfitSuggestion {
  return {
    name: "curated stylist candidate",
    itemIds,
    creativity: "balanced",
    style: [],
    occasion: [],
    score: 0,
    explanation: "",
    warnings: [],
  };
}

function candidateScore(
  itemIds: string[],
  items: StylistItem[],
  input: GenerateOutfitsInput,
): { score: number; palette: string; notes: string[] } {
  const outfit = candidateOutfit(itemIds);
  const composition = compositionQualityForOutfit(outfit, items, input);
  const harmony = colorHarmonyForOutfit(outfit, items);
  const byId = new Map(items.map((item) => [item.itemId, item]));
  const chosen = itemIds.map((id) => byId.get(id)).filter(
    (item): item is StylistItem => Boolean(item),
  );
  const itemFit = chosen.length
    ? chosen.reduce((sum, item) => sum + scoreStylistItem(item, input), 0) / chosen.length
    : 0;
  const normalizedItemFit = Math.max(0, Math.min(100, 50 + itemFit * 2));
  const coherence = pairCoherence(chosen);
  const score = Math.max(0, Math.min(100, Math.round(
    composition.score * 0.4 + harmony.score * 0.25 + coherence * 0.2 + normalizedItemFit * 0.15,
  )));
  const notes = [
    colorHarmonyLabel(harmony, input.context.language === "en" ? "en" : "ru"),
    ...(composition.warnings.length ? [] : [
      input.context.language === "en" ? "balanced silhouette" : "сбалансированный силуэт",
    ]),
  ];
  return {
    score,
    palette: harmony.relation,
    notes,
  };
}

function formulaFor(itemIds: string[], byId: Map<string, StylistItem>): string {
  const chosen = itemIds.map((id) => byId.get(id)).filter(
    (item): item is StylistItem => Boolean(item),
  );
  const parts = chosen.some(isDress)
    ? ["dress"]
    : ["top", "bottom"];
  if (chosen.some(isShoes)) parts.push("shoes");
  if (chosen.some(isOuter)) parts.push("outer layer");
  return parts.join(" + ");
}

function candidateKey(itemIds: string[]): string {
  return [...itemIds].sort().join("|");
}

/**
 * Build a small, deterministic set of complete starting points before the
 * language model writes its final answer. This makes the model choose between
 * coherent bases instead of inventing a pair of individually attractive items.
 */
export function buildCuratedShortlist(
  input: GenerateOutfitsInput,
  limit = 8,
): CuratedStylistCandidate[] {
  if (input.mode === "shopping_recommendation" || !input.availableItems.length) return [];
  const byId = new Map(input.availableItems.map((item) => [item.itemId, item]));
  const fixedIds = [
    input.selectedItemId,
    ...input.lockedItemIds,
  ].flatMap((id) => typeof id === "string" && byId.has(id) ? [id] : []);
  const fixed = fixedIds.map((id) => byId.get(id)).filter(
    (item): item is StylistItem => Boolean(item),
  );
  const dresses = topCandidates(input.availableItems, input, isDress);
  const tops = topCandidates(input.availableItems, input, isBaseTop);
  const bottoms = topCandidates(input.availableItems, input, (item) => item.category === "bottom");
  const shoes = topCandidates(input.availableItems, input, isShoes);
  const outer = topCandidates(input.availableItems, input, isOuter, 8);
  const hasFixedDress = fixed.some(isDress);
  const hasFixedTop = fixed.some(isBaseTop);
  const hasFixedBottom = fixed.some((item) => item.category === "bottom");
  const fixedDress = fixedFor(fixed, isDress, dresses);
  const fixedTop = fixedFor(fixed, isBaseTop, tops);
  const fixedBottom = fixedFor(fixed, (item) => item.category === "bottom", bottoms);
  const fixedShoes = fixedFor(fixed, isShoes, shoes);
  const wardrobeHasShoes = shoes.length > 0;
  const shoeChoices = fixedShoes.length ? fixedShoes : [undefined];
  const fixedOuter = fixedFor(fixed, isOuter, []);
  const includeOuter = fixedOuter.length > 0 || weatherNeedsLayer(input);
  const outerChoices = fixedOuter.length ? fixedOuter : [undefined, ...outer.slice(0, 3)];
  const candidates: string[][] = [];
  const addCandidate = (values: Array<StylistItem | undefined>) => {
    const itemIds = [...new Set(values.filter(Boolean).map((item) => item!.itemId))];
    if (!itemIds.length || !containsAll(itemIds, fixedIds)) return;
    if (wardrobeHasShoes && !itemIds.some((id) => isShoes(byId.get(id)))) return;
    const key = candidateKey(itemIds);
    if (!candidates.some((candidate) => candidateKey(candidate) === key)) candidates.push(itemIds);
  };

  const wantsDress = hasFixedDress || (!hasFixedTop && !hasFixedBottom && dresses.length > 0);
  if (wantsDress) {
    for (const dress of fixedDress.slice(0, 4)) {
      for (const shoe of shoeChoices.slice(0, 6)) {
        const layers = includeOuter ? outerChoices : [undefined];
        for (const layer of layers) addCandidate([dress, shoe, layer]);
      }
    }
  }
  if (!hasFixedDress) {
    for (const top of fixedTop.slice(0, 6)) {
      for (const bottom of fixedBottom.slice(0, 6)) {
        for (const shoe of shoeChoices.slice(0, 6)) {
          const layers = includeOuter ? outerChoices : [undefined];
          for (const layer of layers) addCandidate([top, bottom, shoe, layer]);
        }
      }
    }
  }

  if (input.mode === "restyle") {
    const currentIds = [...new Set(input.currentItemIds.filter((id) => byId.has(id)))];
    if (currentIds.length && containsAll(currentIds, fixedIds)) addCandidate(currentIds.map((id) => byId.get(id)));
  }
  return candidates
    .map((itemIds) => {
      const quality = candidateScore(itemIds, input.availableItems, input);
      return {
        itemIds,
        score: quality.score,
        formula: formulaFor(itemIds, byId),
        palette: quality.palette,
        notes: quality.notes,
      } satisfies CuratedStylistCandidate;
    })
    .sort((left, right) => right.score - left.score || candidateKey(left.itemIds).localeCompare(candidateKey(right.itemIds)))
    .slice(0, Math.max(1, Math.min(limit, 12)));
}

export function curatedShortlistPrompt(input: GenerateOutfitsInput): string {
  const shortlist = buildCuratedShortlist(input);
  if (!shortlist.length) {
    return "Стартовая сетка не построена: используй только доступные вещи и честно верни пустой результат, если полного образа не собрать.";
  }
  return `Стартовая сетка редактора образа (это проверенные основы, а не новые вещи):
${JSON.stringify(shortlist, null, 2)}

Используй эту сетку как контроль качества:
- В первую очередь выбери один из верхних coherent-кандидатов и сохрани его точные itemIds.
- Можешь отказаться от кандидата только при явном конфликте с brief, фото или обязательным якорем; тогда выбери более слабый компромисс и отрази его в warnings.
- Не объединяй случайные itemIds из разных кандидатов только ради цвета.
- Не добавляй аксессуары и слои, если они не усиливают уже выбранную формулу.`;
}
