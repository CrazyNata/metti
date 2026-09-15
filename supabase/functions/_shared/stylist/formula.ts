import type {
  GenerateOutfitsInput,
  OutfitSuggestion,
  StylistItem,
} from "./types.ts";

function lower(value: unknown): string {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase();
}

function hasAny(value: unknown, terms: string[]): boolean {
  const text = lower(value);
  return terms.some((term) => text.includes(term));
}

export function isDress(item: StylistItem | undefined): boolean {
  return item?.category === "dress" || lower(item?.subcategory) === "dress";
}

export function isOuterLayer(item: StylistItem | undefined): boolean {
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

export function isBaseTop(item: StylistItem | undefined): boolean {
  return item?.category === "top" && !isDress(item) && !isOuterLayer(item);
}

export function dressIsExplicitlyExcluded(...values: unknown[]): boolean {
  const text = lower(values.filter(Boolean).join(" "));
  if (!text) return false;
  return [
    /(?:без|without|no)\s+(?:\S+\s+){0,3}(?:плать[^\s.!?]*|dress\b)/u,
    /(?:не\s+(?:хочу|надо|нужн[^\s.!?]*|предлаг[^\s.!?]*|показыва[^\s.!?]*)|(?:do\s+not|don't)\s+(?:suggest|show))[^.!?]{0,36}(?:плать[^\s.!?]*|dress\b)/u,
    /(?:плать[^\s.!?]*|dress\b)[^.!?]{0,28}(?:не\s+(?:хочу|надо|нужн[^\s.!?]*)|without|no)/u,
  ].some((pattern) => pattern.test(text));
}

export function dressIsExplicitlyRequested(...values: unknown[]): boolean {
  return hasAny(values.filter(Boolean).join(" "), ["плать", "dress"]);
}

/**
 * Decide whether the result set should reserve one complete dress formula.
 * A fixed top or bottom makes that formula impossible without breaking the
 * anchor contract; a fixed dress, on the other hand, always wins.
 */
export function shouldOfferDressVariant(input: GenerateOutfitsInput): boolean {
  if (input.mode === "shopping_recommendation") return false;
  const byId = new Map(input.availableItems.map((item) => [item.itemId, item]));
  const fixed = [input.selectedItemId, ...input.lockedItemIds]
    .filter((id): id is string => Boolean(id))
    .map((id) => byId.get(id))
    .filter((item): item is StylistItem => Boolean(item));
  if (fixed.some(isDress)) return true;
  if (fixed.some((item) => isBaseTop(item) || item.category === "bottom")) {
    return false;
  }
  if (
    dressIsExplicitlyExcluded(
      input.prompt,
      input.instruction,
      input.context.occasion,
    )
  ) return false;
  return input.availableItems.some(isDress);
}

export function outfitUsesDress(
  outfit: OutfitSuggestion,
  items: StylistItem[],
): boolean {
  const byId = new Map(items.map((item) => [item.itemId, item]));
  return outfit.itemIds.some((itemId) => isDress(byId.get(itemId)));
}
