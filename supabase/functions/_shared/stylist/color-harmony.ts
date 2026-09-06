import type { OutfitSuggestion, StylistItem } from "./types.ts";

export type ColorWheelFamily =
  | "neutral"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "pink"
  | "brown";

interface ColorRule {
  family: ColorWheelFamily;
  hue: number | null;
  terms: readonly string[];
}

const COLOR_RULES: readonly ColorRule[] = [
  { family: "neutral", hue: null, terms: ["black", "черн", "white", "бел", "gray", "grey", "сер", "beige", "беж", "cream", "крем", "taupe", "тауп", "silver", "серебр"] },
  { family: "brown", hue: 30, terms: ["brown", "корич", "camel", "камел", "tan", "рыж", "cognac", "коньяк", "terracotta", "терракот"] },
  { family: "red", hue: 0, terms: ["red", "крас", "burgundy", "бордов", "wine", "винн", "crimson", "малин", "алый"] },
  { family: "orange", hue: 30, terms: ["orange", "оранж", "coral", "коралл", "rust", "ржав", "медн"] },
  { family: "yellow", hue: 60, terms: ["yellow", "желт", "mustard", "горчич", "ochre", "охр", "gold", "золот"] },
  { family: "green", hue: 120, terms: ["green", "зелен", "olive", "олив", "khaki", "хаки", "sage", "шалф", "mint", "мятн", "teal", "бирюз"] },
  { family: "blue", hue: 210, terms: ["blue", "син", "navy", "темно-син", "кобальт", "cobalt", "azure", "голуб", "teal", "бирюз"] },
  { family: "purple", hue: 270, terms: ["purple", "фиолет", "violet", "лилов", "lilac", "лаванд", "plum", "слив"] },
  { family: "pink", hue: 330, terms: ["pink", "роз", "fuchsia", "фукс", "magenta", "маджент", "rose", "пыльн"] },
] as const;

function normalized(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[‐‑–—-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function colorWheelFamily(value: unknown): ColorWheelFamily | null {
  const text = normalized(value);
  if (!text) return null;
  return COLOR_RULES.find((rule) => rule.terms.some((term) => text.includes(term)))?.family ?? null;
}

function hueFor(family: ColorWheelFamily): number | null {
  return COLOR_RULES.find((rule) => rule.family === family)?.hue ?? null;
}

function itemColorFamilies(item: StylistItem): ColorWheelFamily[] {
  const values = [
    ...item.colors,
    ...item.secondaryColors,
    // Enrichment is allowed to be incomplete. Use text only as a fallback,
    // never as a replacement for an explicitly stored color.
    ...(item.colors.length || item.secondaryColors.length
      ? []
      : [item.name, item.description, item.notes]),
  ];
  return [...new Set(values.map(colorWheelFamily).filter(
    (value): value is ColorWheelFamily => Boolean(value),
  ))];
}

function hueDistance(left: number, right: number): number {
  const distance = Math.abs(left - right) % 360;
  return Math.min(distance, 360 - distance);
}

function relationScore(left: ColorWheelFamily, right: ColorWheelFamily): number {
  if (left === "neutral" || right === "neutral") return 1;
  if (left === right) return 1;
  const leftHue = hueFor(left);
  const rightHue = hueFor(right);
  if (leftHue === null || rightHue === null) return 0.75;
  const distance = hueDistance(leftHue, rightHue);
  // Analogous, complementary and triadic relationships on the wheel.
  if (distance <= 60 || distance >= 150 || (distance >= 95 && distance <= 145)) return 0.92;
  return 0.42;
}

function accentItem(item: StylistItem): boolean {
  return (item.statementLevel ?? 0) >= 4 || Boolean(item.pattern && normalized(item.pattern) !== "solid");
}

export interface ColorHarmonyResult {
  score: number;
  families: ColorWheelFamily[];
  relation: "neutral" | "analogous" | "complementary" | "triadic" | "mixed";
}

function relationName(
  families: ColorWheelFamily[],
): ColorHarmonyResult["relation"] {
  const hues = families
    .filter((family) => family !== "neutral")
    .map(hueFor)
    .filter((hue): hue is number => hue !== null);
  if (hues.length < 2) return "neutral";
  const distances: number[] = [];
  for (let left = 0; left < hues.length; left += 1) {
    for (let right = left + 1; right < hues.length; right += 1) {
      distances.push(hueDistance(hues[left], hues[right]));
    }
  }
  if (distances.every((distance) => distance <= 60)) return "analogous";
  if (distances.some((distance) => distance >= 150)) return "complementary";
  if (distances.every((distance) => distance >= 95 && distance <= 145)) return "triadic";
  return "mixed";
}

export function colorHarmonyForOutfit(
  outfit: OutfitSuggestion,
  items: StylistItem[],
): ColorHarmonyResult {
  const byId = new Map(items.map((item) => [item.itemId, item]));
  const chosen = outfit.itemIds.map((id) => byId.get(id)).filter(
    (item): item is StylistItem => item !== undefined,
  );
  const families = [...new Set(chosen.flatMap(itemColorFamilies))];
  const coloredFamilies = families.filter((family) => family !== "neutral");
  if (families.length < 2 || coloredFamilies.length < 2) {
    return { score: 88, families, relation: "neutral" };
  }
  const relations: number[] = [];
  for (let left = 0; left < coloredFamilies.length; left += 1) {
    for (let right = left + 1; right < coloredFamilies.length; right += 1) {
      relations.push(relationScore(coloredFamilies[left], coloredFamilies[right]));
    }
  }
  const average = relations.length
    ? relations.reduce((sum, value) => sum + value, 0) / relations.length
    : 1;
  const activeAccents = chosen.filter(accentItem).length;
  let score = 54 + average * 36;
  if (coloredFamilies.length === 2 && average >= 0.9) score += 5;
  if (coloredFamilies.length >= 3) score -= 8;
  if (activeAccents > 2) score -= (activeAccents - 2) * 8;
  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    families,
    relation: relationName(families),
  };
}

export function colorHarmonyLabel(
  result: ColorHarmonyResult,
  language: "ru" | "en",
): string {
  if (language === "en") {
    return {
      neutral: "a neutral palette with one controlled accent",
      analogous: "an analogous color harmony",
      complementary: "a complementary color contrast",
      triadic: "a measured triadic palette",
      mixed: "a restrained mixed palette",
    }[result.relation];
  }
  return {
    neutral: "нейтральная палитра с одним контролируемым акцентом",
    analogous: "аналогичная палитра",
    complementary: "комплементарный цветовой контраст",
    triadic: "выверенная триадная палитра",
    mixed: "сдержанная смешанная палитра",
  }[result.relation];
}

/** Guidance embedded in the generator and critic prompts. */
export const COLOR_WHEEL_PROMPT = `Цветовой круг — обязательная проверка, а не украшение объяснения:
- Сначала определи доминирующий цвет, нейтрали и максимум один-два акцента.
- Разрешённые рабочие схемы: аналогичная (соседние оттенки), комплементарная (противоположные оттенки около 180°), триадная (три точки около 120°) и нейтральная палитра с одним акцентом.
- Нейтрали (чёрный, белый, серый, бежевый, кремовый, тауп, серебро) связывают активные цвета и не считаются отдельными акцентами.
- Не ставь рядом несколько насыщенных statement-цветов без ясной причины. Если контраст смелый, остальные вещи должны его поддерживать.
- Совпадение двух названий цветов ещё не доказывает гармонию: проверь температуру, насыщенность, визуальный вес и количество акцентов. При конфликте снизь score и назови реальный компромисс.`;

