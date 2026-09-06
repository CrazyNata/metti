import type {
  GenerateOutfitsInput,
  OutfitSuggestion,
  StylistItem,
} from "./types.ts";
import { colorHarmonyForOutfit, colorHarmonyLabel } from "./color-harmony.ts";

function lower(value: unknown): string {
  return String(value ?? "").toLocaleLowerCase();
}

function itemDetails(item: StylistItem): string {
  const details = [
    item.pattern,
    item.silhouette,
    item.fit,
    item.length,
    item.material,
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .slice(0, 2);
  const colors = item.colors.filter(Boolean).slice(0, 2);
  if (colors.length) details.unshift(colors.join(" и "));
  return [...new Set(details)].join(", ");
}

function isDress(item: StylistItem | undefined): boolean {
  return item?.category === "dress" || lower(item?.subcategory) === "dress";
}

function isBaseTop(item: StylistItem | undefined): boolean {
  return item?.category === "top" && !isDress(item);
}

function isOuter(item: StylistItem | undefined): boolean {
  return item?.category === "outer" || [
    "outerwear",
    "blazer",
    "jacket",
    "coat",
    "trench",
    "parka",
    "bomber",
    "cardigan",
  ].includes(lower(item?.subcategory));
}

function stylePhrase(values: string[], language: "ru" | "en"): string {
  const text = lower(values.join(" "));
  if (language === "en") {
    if (/(minimal|calm|quiet|classic)/i.test(text)) return "a clean, restrained elegance";
    if (/(elegant|smart[ _-]?casual|business|evening)/i.test(text)) return "polished elegance";
    if (/(romantic|soft)/i.test(text)) return "soft romantic ease";
    if (/(sport|street|edgy)/i.test(text)) return "relaxed street energy";
    return "a considered everyday look";
  }
  if (/(спокой|минимал|лаконич|базов|classic|классичес)/iu.test(text)) {
    return "сдержанная чистая элегантность";
  }
  if (/(элегант|smart[ _-]?casual|business|вечер)/iu.test(text)) {
    return "собранная элегантность";
  }
  if (/(романтич|soft|мягк)/iu.test(text)) return "мягкое романтичное настроение";
  if (/(sport|спортив|street|уличн|edgy)/iu.test(text)) return "расслабленная городская энергия";
  return "обдуманный повседневный образ";
}

function occasionPhrase(input: GenerateOutfitsInput, language: "ru" | "en"): string {
  const text = lower([
    input.prompt,
    input.instruction,
    input.context.occasion,
  ].filter(Boolean).join(" "));
  if (language === "en") {
    if (/(office|business|work)/i.test(text)) return "for work";
    if (/(dinner|date|evening)/i.test(text)) return "for an evening out";
    if (/(wedding|ceremony)/i.test(text)) return "for the ceremony";
    if (/(walk|city|everyday|casual)/i.test(text)) return "for the city";
    return "";
  }
  if (/(офис|делов|работ)/iu.test(text)) return "для офиса";
  if (/(ужин|свидан|вечер)/iu.test(text)) return "для вечера";
  if (/(свад|церемон)/iu.test(text)) return "для церемонии";
  if (/(прогул|город|повсед|кэжуал)/iu.test(text)) return "для города";
  return "";
}

function temperaturePhrase(input: GenerateOutfitsInput, language: "ru" | "en"): string {
  const value = Number(input.context.temperature ?? input.context.feelsLike);
  if (!Number.isFinite(value)) return "";
  return language === "en" ? ` for ${Math.round(value)}°C` : ` при ${Math.round(value)}°C`;
}

function pickFocal(
  outfit: OutfitSuggestion,
  items: StylistItem[],
  input: GenerateOutfitsInput,
): StylistItem | undefined {
  const byId = new Map(items.map((item) => [item.itemId, item]));
  const selected = [input.selectedItemId, ...input.lockedItemIds]
    .filter(Boolean)
    .map((id) => byId.get(id as string))
    .find((item) => item && item.category !== "shoes");
  if (selected) return selected;
  const chosen = outfit.itemIds.map((id) => byId.get(id)).filter(
    (item): item is StylistItem => Boolean(item),
  );
  return [...chosen]
    .filter((item) => !isOuter(item) || item.statementLevel !== null)
    .sort((left, right) => {
      const leftScore = (left.statementLevel ?? 0) * 10 +
        (left.pattern ? 3 : 0) + (isBaseTop(left) || isDress(left) ? 2 : 0);
      const rightScore = (right.statementLevel ?? 0) * 10 +
        (right.pattern ? 3 : 0) + (isBaseTop(right) || isDress(right) ? 2 : 0);
      return rightScore - leftScore;
    })[0] ?? chosen[0];
}

function pickSupport(
  outfit: OutfitSuggestion,
  items: StylistItem[],
  focal: StylistItem | undefined,
): StylistItem | undefined {
  if (!focal) return undefined;
  const byId = new Map(items.map((item) => [item.itemId, item]));
  const chosen = outfit.itemIds.map((id) => byId.get(id)).filter(
    (item): item is StylistItem => item !== undefined && item.itemId !== focal.itemId,
  );
  const preferred = focal.category === "top" || isDress(focal)
    ? chosen.find((item) => item.category === "bottom")
    : chosen.find((item) => isBaseTop(item) || isDress(item));
  return preferred ?? chosen.find((item) => item.category !== "shoes" && !isOuter(item));
}

/**
 * Add a concrete stylist point of view to the model's explanation. Provider
 * prose can be technically valid yet still sound like a catalogue caption;
 * this sentence makes the focal item, support and context explicit using only
 * verified wardrobe data.
 */
export function withStylistVoice(
  outfit: OutfitSuggestion,
  items: StylistItem[],
  input: GenerateOutfitsInput,
  language: "ru" | "en",
): OutfitSuggestion {
  const byId = new Map(items.map((item) => [item.itemId, item]));
  const focal = pickFocal(outfit, items, input);
  const support = pickSupport(outfit, items, focal);
  const shoes = outfit.itemIds
    .map((id) => byId.get(id))
    .find((item) => item?.category === "shoes");
  if (!focal) return outfit;

  const details = itemDetails(focal);
  const style = stylePhrase(input.styleProfile.preferredStyles, language);
  const harmony = colorHarmonyForOutfit(outfit, items);
  const palette = colorHarmonyLabel(harmony, language);
  const occasion = occasionPhrase(input, language);
  const temperature = temperaturePhrase(input, language);
  let thesis: string;
  if (language === "en") {
    thesis = `My pick is ${focal.name} as the focal point${details ? ` (${details})` : ""}.`;
    if (support) thesis += ` ${support.name} supports the line`;
    if (shoes) thesis += `${support ? "," : ""} while ${shoes.name} grounds the look`;
    thesis += ".";
    thesis += ` The overall direction is ${style}${occasion ? ` ${occasion}` : ""}${temperature}. Palette: ${palette}.`;
  } else {
    thesis = `Мой выбор — ${focal.name} как главный акцент${details ? ` (${details})` : ""}.`;
    if (support) thesis += ` ${support.name} поддерживает линию`;
    if (shoes) thesis += `${support ? ", а" : " А"} ${shoes.name} заземляет комплект`;
    thesis += ".";
    thesis += ` Общее направление — ${style}${occasion ? ` ${occasion}` : ""}${temperature}. Палитра — ${palette}.`;
  }

  const raw = String(outfit.explanation ?? "").trim();
  const generic = !raw || /^(полный образ|собрала (этот )?образ|готово|complete combination|a complete combination|done)/iu.test(raw);
  const explanation = raw && !generic && !/^(мой выбор|my pick)/iu.test(raw)
    ? `${thesis} ${raw}`
    : thesis;
  return { ...outfit, explanation: explanation.slice(0, 1000) };
}
