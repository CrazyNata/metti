import type {
  GenerateOutfitsInput,
  OutfitSuggestion,
  StylistItem,
} from "./types.ts";

/**
 * Deterministic checks for the complete composition. The model still makes
 * the creative choice, but a high provider score cannot hide a set that is
 * visibly busy, top-heavy, mismatched in formality, or impractical.
 */
export interface CompositionQuality {
  score: number;
  warnings: string[];
  activeAccentCount: number;
  patternedItemCount: number;
}

function lower(value: unknown): string {
  return String(value ?? "").toLocaleLowerCase();
}

function itemText(item: StylistItem): string {
  return [
    item.name,
    item.description,
    item.category,
    item.subcategory,
    item.pattern,
    item.material,
    item.fit,
    item.silhouette,
    item.length,
    item.brand,
    item.notes,
    ...item.colors,
    ...item.secondaryColors,
    ...item.styles,
    ...item.occasions,
  ].map(lower).join(" ");
}

function hasAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function isDress(item: StylistItem | undefined): boolean {
  return item?.category === "dress" || lower(item?.subcategory) === "dress";
}

function isOuter(item: StylistItem | undefined): boolean {
  if (!item) return false;
  return item.category === "outer" || hasAny(lower(item.subcategory), [
    "outerwear",
    "jacket",
    "coat",
    "trench",
    "parka",
    "bomber",
    "cardigan",
    "куртк",
    "пальто",
    "тренч",
    "кардиган",
  ]);
}

function isGarment(item: StylistItem): boolean {
  return item.category !== "accessory";
}

function isNeutralPattern(pattern: unknown): boolean {
  const value = lower(pattern).trim();
  return !value || hasAny(value, [
    "solid",
    "plain",
    "none",
    "однотон",
    "без принта",
    "нет",
  ]);
}

function hasVisiblePattern(item: StylistItem): boolean {
  if (item.pattern && !isNeutralPattern(item.pattern)) return true;
  const text = itemText(item);
  return hasAny(text, [
    "клет",
    "полос",
    "горош",
    "цветоч",
    "принт",
    "графич",
    "graphic",
    "logo",
    "логотип",
    "label",
    "animal",
    "животн",
    "леопард",
    "зебр",
    "питон",
    "cow print",
    "коров",
    "plaid",
    "checkered",
    "checked",
    "striped",
  ]);
}

function isActiveAccent(item: StylistItem): boolean {
  if ((item.statementLevel ?? 0) >= 4) return true;
  const text = itemText(item);
  return hasVisiblePattern(item) || hasAny(text, [
    "пайет",
    "sequins",
    "металлик",
    "metallic",
    "люрекс",
    "блест",
    "неон",
    "neon",
    "лаков",
    "patent",
  ]);
}

function hasAnimalPrint(item: StylistItem): boolean {
  return hasAny(itemText(item), [
    "animal",
    "животн",
    "леопард",
    "зебр",
    "питон",
    "snake print",
    "cow print",
    "коров",
  ]);
}

function hasVolume(item: StylistItem | undefined): boolean {
  if (!item) return false;
  return hasAny(itemText(item), [
    "oversized",
    "oversize",
    "объём",
    "объем",
    "широк",
    "wide leg",
    "wide-leg",
    "baggy",
    "loose",
    "relaxed",
    "boxy",
    "свободн",
    "мешковат",
    "кокон",
    "balloon",
  ]);
}

function hasFittedLine(item: StylistItem | undefined): boolean {
  if (!item) return false;
  return hasAny(itemText(item), [
    "fitted",
    "slim",
    "tailored",
    "притал",
    "облег",
    "узк",
    "cropped",
    "укороч",
    "подогнан",
  ]);
}

function formality(item: StylistItem): number | null {
  if (item.formality !== null && Number.isFinite(Number(item.formality))) {
    return Math.max(1, Math.min(5, Number(item.formality)));
  }
  const text = itemText(item);
  if (hasAny(text, [
    "смокинг",
    "костюм",
    "вечерн",
    "formal",
    "туфл",
    "heels",
    "каблук",
    "loafers",
    "лофер",
  ])) return 4;
  if (hasAny(text, [
    "кроссов",
    "sneaker",
    "hoodie",
    "худи",
    "футбол",
    "t-shirt",
    "tshirt",
    "джинс",
    "jeans",
    "jogger",
    "шорт",
    "shorts",
  ])) return 2;
  return null;
}

function targetFormality(input: GenerateOutfitsInput): number | null {
  const text = lower([
    input.prompt,
    input.instruction,
    input.context.occasion,
  ].filter(Boolean).join(" "));
  if (hasAny(text, [
    "formal",
    "black tie",
    "business",
    "офис",
    "делов",
    "свадь",
    "церемон",
    "наряд",
    "вечер",
    "ужин",
    "свидан",
  ])) return 4;
  if (hasAny(text, [
    "casual",
    "everyday",
    "повсед",
    "кэжуал",
    "прогул",
    "город",
    "weekend",
    "спорт",
    "street",
    "уличн",
  ])) return 2;
  return null;
}

function isBoldRequested(input: GenerateOutfitsInput, outfit: OutfitSuggestion): boolean {
  if (outfit.creativity === "bold" || input.preferredCreativity === "bold") return true;
  const text = lower([
    input.prompt,
    input.instruction,
    input.styleProfile.preferredStyles.join(" "),
    input.styleProfile.learnedPreferences.join(" "),
  ].join(" "));
  return hasAny(text, [
    "смел",
    "эксперимент",
    "ярк",
    "максимал",
    "выразител",
    "bold",
    "statement",
    "edgy",
  ]);
}

function isCalmProfile(input: GenerateOutfitsInput): boolean {
  const text = lower([
    ...input.styleProfile.preferredStyles,
    ...input.styleProfile.learnedPreferences,
  ].join(" "));
  return hasAny(text, [
    "спокой",
    "минимал",
    "лаконич",
    "сдержан",
    "clean",
    "minimal",
    "quiet",
    "classic",
    "классичес",
    "элегант",
    "elegant",
  ]);
}

function warning(language: "ru" | "en", ru: string, en: string): string {
  return language === "en" ? en : ru;
}

function pushWarning(warnings: string[], value: string): void {
  if (!warnings.includes(value)) warnings.push(value);
}

/**
 * Score interactions between the exact items in one outfit. Unknown metadata
 * is neutral: a missing attribute must never become a reason to reject a real
 * wardrobe item.
 */
export function compositionQualityForOutfit(
  outfit: OutfitSuggestion,
  items: StylistItem[],
  input: GenerateOutfitsInput,
  language: "ru" | "en" = "ru",
): CompositionQuality {
  const byId = new Map(items.map((item) => [item.itemId, item]));
  const chosen = outfit.itemIds.map((id) => byId.get(id)).filter(
    (item): item is StylistItem => item !== undefined,
  );
  if (!chosen.length) {
    return { score: 0, warnings: [], activeAccentCount: 0, patternedItemCount: 0 };
  }

  const garments = chosen.filter(isGarment);
  const active = garments.filter(isActiveAccent);
  const patterned = garments.filter(hasVisiblePattern);
  const bold = isBoldRequested(input, outfit);
  const forcedIds = new Set([
    input.selectedItemId,
    ...input.lockedItemIds,
  ].filter((id): id is string => Boolean(id)));
  const forcedActive = active.filter((item) => forcedIds.has(item.itemId)).length;
  const warnings: string[] = [];
  let score = 82;

  // A safe or balanced look needs one visual focal point. Let bold requests
  // carry a second accent, but still make three simultaneous accents costly.
  const allowedAccents = bold ? 2 : 1;
  if (active.length > allowedAccents) {
    const excess = active.length - allowedAccents;
    const forcedRelief = Math.min(excess, Math.max(0, forcedActive - allowedAccents));
    score -= excess * (bold ? 7 : 11) - forcedRelief * 4;
    pushWarning(
      warnings,
      warning(
        language,
        "В образе слишком много активных акцентов; лучше оставить один главный фокус.",
        "The look has too many active accents; keep one clear focal point.",
      ),
    );
  } else if (active.length === 1 && garments.length >= 3) {
    score += 3;
  }
  if (patterned.length > 1) {
    score -= (patterned.length - 1) * (bold ? 8 : 14);
    pushWarning(
      warnings,
      warning(
        language,
        "Несколько принтов конкурируют между собой; спокойная база собрала бы комплект лучше.",
        "Several patterns compete; a quieter base would make the outfit stronger.",
      ),
    );
  }
  if (active.some(hasAnimalPrint) && active.some((item) => item.category !== "shoes" && !hasAnimalPrint(item))) {
    score -= bold ? 3 : 7;
    pushWarning(
      warnings,
      warning(
        language,
        "Анималистичная обувь уже является фокусом, поэтому остальные акценты стоит смягчить.",
        "Animal-print footwear is already a focal point, so the other accents should stay quiet.",
      ),
    );
  }

  const top = garments.find((item) => item.category === "top" && !isDress(item));
  const bottom = garments.find((item) => item.category === "bottom");
  const outer = garments.find(isOuter);
  if (top && bottom && hasVolume(top) && hasVolume(bottom)) {
    score -= 9;
    pushWarning(
      warnings,
      warning(
        language,
        "Объёмный верх и широкий низ утяжеляют силуэт одновременно.",
        "The oversized top and wide bottom add volume in the same place.",
      ),
    );
  } else if (bottom && hasVolume(bottom) && hasFittedLine(top)) {
    score += 4;
  }
  if (outer && top && hasVolume(outer) && hasVolume(top) && patterned.length > 0) {
    score -= 4;
  }

  const knownFormality = garments.map(formality).filter(
    (value): value is number => value !== null,
  );
  if (knownFormality.length >= 2) {
    const range = Math.max(...knownFormality) - Math.min(...knownFormality);
    if (range >= 2.5) {
      score -= 10;
      pushWarning(
        warnings,
        warning(
          language,
          "Вещи заметно расходятся по формальности; обувь и верх должны говорить на одном языке.",
          "The pieces sit far apart in formality; the shoes and clothing should speak the same language.",
        ),
      );
    } else if (range >= 1.8) {
      score -= 5;
    }
  }
  const target = targetFormality(input);
  if (target !== null && knownFormality.length) {
    const average = knownFormality.reduce((sum, value) => sum + value, 0) / knownFormality.length;
    const distance = Math.abs(average - target);
    if (distance >= 1.5) {
      score -= Math.round(Math.min(10, distance * 5));
      pushWarning(
        warnings,
        warning(
          language,
          target >= 3
            ? "Для этого повода комплект выглядит слишком повседневным."
            : "Для этого повода комплект выглядит слишком нарядным.",
          target >= 3
            ? "This look is too casual for the occasion."
            : "This look is too dressed up for the occasion.",
        ),
      );
    }
  }

  const temperature = Number(input.context.temperature ?? input.context.feelsLike);
  if (Number.isFinite(temperature)) {
    const hasWarmLayer = chosen.some((item) => isOuter(item) || (item.warmth ?? 0) >= 4);
    if (temperature <= 5 && !hasWarmLayer) {
      score -= 12;
      pushWarning(
        warnings,
        warning(
          language,
          "Для такой температуры не хватает тёплого слоя.",
          "The outfit needs a warmer layer for this temperature.",
        ),
      );
    } else if (temperature >= 25 && chosen.some((item) => isOuter(item) || (item.warmth ?? 0) >= 5)) {
      score -= 9;
      pushWarning(
        warnings,
        warning(
          language,
          "Для жары в комплекте есть лишний тёплый слой.",
          "The outfit includes an unnecessary warm layer for hot weather.",
        ),
      );
    }
  }
  const precipitation = Number(input.context.precipitation);
  if (Number.isFinite(precipitation) && precipitation > 0) {
    const hasWeatherProtection = chosen.some((item) => item.waterproof === true || isOuter(item));
    if (!hasWeatherProtection) {
      score -= 4;
      pushWarning(
        warnings,
        warning(
          language,
          "При осадках понадобится дополнительная защита от дождя.",
          "Rain protection will be needed with this outfit.",
        ),
      );
    }
  }

  const accessoryCount = chosen.filter((item) => item.category === "accessory").length;
  if (accessoryCount > 1) score -= Math.min(6, (accessoryCount - 1) * 3);
  if (isCalmProfile(input) && active.length > 1) score -= 5;
  const dislikedItems = chosen.filter((item) => item.feedbackScore <= -4).length;
  if (dislikedItems) score -= Math.min(8, dislikedItems * 3);

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    warnings: warnings.slice(0, 8),
    activeAccentCount: active.length,
    patternedItemCount: patterned.length,
  };
}

export function applyCompositionQuality(
  outfits: OutfitSuggestion[],
  input: GenerateOutfitsInput,
  language: "ru" | "en" = "ru",
): OutfitSuggestion[] {
  return outfits.map((outfit) => {
    const quality = compositionQualityForOutfit(outfit, input.availableItems, input, language);
    const blendedScore = Math.round(outfit.score * 0.65 + quality.score * 0.35);
    return {
      ...outfit,
      score: blendedScore,
      warnings: [...new Set([...outfit.warnings, ...quality.warnings])].slice(0, 8),
    };
  });
}
