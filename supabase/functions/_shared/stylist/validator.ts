import { canonicalVocabularyList } from "./vocabulary.ts";
import type {
  MissingPiece,
  OutfitCreativity,
  OutfitSuggestion,
  StylistItem,
  StylistMode,
} from "./types.ts";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function textList(value: unknown, max = 8): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max))];
}

function score(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function creativity(
  value: unknown,
  index: number,
  preferred?: OutfitCreativity,
): OutfitCreativity {
  if (value === "safe" || value === "balanced" || value === "bold") {
    return value;
  }
  if (preferred) return preferred;
  return index % 3 === 0 ? "safe" : index % 3 === 1 ? "balanced" : "bold";
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

function neutralExplanation(value: string): string {
  return value
    .replace(/скрыва(?:ет|ть)\s+(?:недостатки|живот)/giu, "балансирует силуэт")
    .replace(/делает\s+фигуру\s+худее/giu, "создаёт более вертикальную линию")
    .replace(/стройнит/giu, "создаёт более собранный силуэт")
    .slice(0, 1000);
}

function categoryCounts(
  itemIds: string[],
  byId: Map<string, StylistItem>,
): Map<string, number> {
  const result = new Map<string, number>();
  itemIds.forEach((id) => {
    const category = byId.get(id)?.category ?? "unknown";
    result.set(category, (result.get(category) ?? 0) + 1);
  });
  return result;
}

function invalidStructure(
  itemIds: string[],
  byId: Map<string, StylistItem>,
  available: StylistItem[],
  mode: StylistMode,
): string | null {
  if (itemIds.length < 2) return "outfit_too_small";
  const counts = categoryCounts(itemIds, byId);
  const garmentCount = itemIds.filter((id) => byId.get(id)?.category !== "accessory").length;
  if (!garmentCount) return "accessory_only_outfit";
  if ((counts.get("shoes") ?? 0) > 1) return "multiple_shoes";
  if ((counts.get("bottom") ?? 0) > 1) return "multiple_bottoms";
  if ((counts.get("outer") ?? 0) > 1) return "multiple_outerwear";

  const hasShoes = (counts.get("shoes") ?? 0) > 0;
  const wardrobeHasShoes = available.some((item) => item.category === "shoes");
  if (wardrobeHasShoes && !hasShoes) return "missing_shoes";

  const hasDress = itemIds.some((id) => isDress(byId.get(id)));
  const regularTopCount = itemIds.filter((id) => {
    return isBaseTop(byId.get(id));
  }).length;
  if (hasDress && (counts.get("bottom") ?? 0) > 0) return "dress_with_bottom";
  if (regularTopCount > 1) return "multiple_base_tops";
  const wardrobeHasCompleteBase = mode !== "shopping_recommendation" && (
    available.some((item) => isDress(item)) ||
    (available.some((item) => isBaseTop(item)) &&
      available.some((item) => item.category === "bottom"))
  );
  const hasCompleteBase = hasDress || (
    regularTopCount > 0 && (counts.get("bottom") ?? 0) > 0
  );
  if (wardrobeHasCompleteBase && !hasCompleteBase) return "missing_base_layers";
  return null;
}

export interface OutfitValidationResult {
  outfits: OutfitSuggestion[];
  capsuleItemIds: string[];
  missingPieces: MissingPiece[];
  errors: string[];
}

export function validateOutfitResult(
  payload: unknown,
  options: {
    availableItems: StylistItem[];
    mode: StylistMode;
    selectedItemId?: string;
    lockedItemIds?: string[];
    preferredCreativity?: OutfitCreativity;
    count: number;
  },
): OutfitValidationResult {
  const root = record(payload);
  const rawOutfits = Array.isArray(root.outfits)
    ? root.outfits
    : Array.isArray(payload)
    ? payload
    : [];
  const byId = new Map(options.availableItems.map((item) => [item.itemId, item]));
  const errors: string[] = [];
  const outfits: OutfitSuggestion[] = [];
  const rawCapsule = root.capsuleItemIds ?? root.capsule_item_ids;
  const capsuleItemIds = Array.isArray(rawCapsule)
    ? [...new Set(rawCapsule.map((value) => String(value).trim()).filter(Boolean))]
    : [];
  const validCapsuleItemIds = capsuleItemIds.filter((itemId) => byId.has(itemId));
  if (validCapsuleItemIds.length !== capsuleItemIds.length) {
    errors.push("capsule:unknown_item_id");
  }
  const rawMissingPieces = Array.isArray(root.missingPieces)
    ? root.missingPieces
    : Array.isArray(root.missing_pieces)
    ? root.missing_pieces
    : [];
  const missingPieces: MissingPiece[] = rawMissingPieces.flatMap((value) => {
    const item = record(value);
    const category = text(item.category).slice(0, 80);
    if (!category) return [];
    return [{
      category,
      preferredColors: canonicalVocabularyList(
        item.preferredColors ?? item.preferred_colors,
        "color",
        5,
      ),
      priority: score(item.priority),
      reason: text(item.reason).slice(0, 300),
    }];
  }).slice(0, 8);

  rawOutfits.forEach((rawValue, index) => {
    const raw = record(rawValue);
    const rawIds = raw.itemIds ?? raw.item_ids;
    if (!Array.isArray(rawIds)) {
      errors.push(`${index}:missing_item_ids`);
      return;
    }
    const itemIds = rawIds.map((value) => String(value).trim()).filter(Boolean);
    if (!itemIds.length || itemIds.some((id) => !byId.has(id))) {
      // A hallucinated id invalidates the whole candidate; never repair it by
      // silently replacing or dropping a requested garment.
      errors.push(`${index}:unknown_item_id`);
      return;
    }
    if (new Set(itemIds).size !== itemIds.length) {
      errors.push(`${index}:duplicate_item_id`);
      return;
    }
    const structureError = invalidStructure(
      itemIds,
      byId,
      options.availableItems,
      options.mode,
    );
    if (structureError) {
      errors.push(`${index}:${structureError}`);
      return;
    }
    if (options.selectedItemId && !itemIds.includes(options.selectedItemId)) {
      errors.push(`${index}:selected_item_missing`);
      return;
    }
    if (options.mode === "restyle" && (options.lockedItemIds ?? []).some((id) => !itemIds.includes(id))) {
      errors.push(`${index}:locked_item_missing`);
      return;
    }
    const warnings = textList(raw.warnings, 8);
    const explanation = neutralExplanation(text(raw.explanation, "Собрала образ из вещей вашего гардероба."));
    outfits.push({
      name: text(raw.name, `Образ ${index + 1}`).slice(0, 160),
      itemIds,
      creativity: creativity(raw.creativity, index, options.preferredCreativity),
      style: canonicalVocabularyList(raw.style ?? raw.styles, "style", 8),
      occasion: canonicalVocabularyList(raw.occasion ?? raw.occasions, "occasion", 8),
      score: score(raw.score),
      explanation,
      warnings,
    });
  });

  return {
    outfits: outfits.slice(0, Math.max(1, Math.min(options.count, 5))),
    capsuleItemIds: validCapsuleItemIds.length
      ? validCapsuleItemIds
      : options.mode === "packing"
      ? [...new Set(outfits.flatMap((outfit) => outfit.itemIds))]
      : [],
    missingPieces,
    errors: [...new Set(errors)].slice(0, 30),
  };
}
