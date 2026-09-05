import type { ApplicationServices } from "../services.ts";
import type { WardrobeItemDto } from "../types.ts";
import { daysSince, listAllActiveWardrobe } from "./wardrobe-analysis.ts";

export interface WardrobeDuplicateGroup {
  itemIds: string[];
  category: string;
  reason: string;
}

export interface WardrobeGap {
  category: string;
  priority: number;
  reason: string;
}

export interface WardrobeAuditResult {
  strengths: string[];
  duplicates: WardrobeDuplicateGroup[];
  underusedItemIds: string[];
  gaps: WardrobeGap[];
  recommendations: string[];
  itemCount: number;
}

function normalized(value: unknown): string {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase().trim();
}

function itemSignature(item: WardrobeItemDto): string | null {
  const subcategory = normalized(item.subcategory);
  const color = normalized(item.colors[0] ?? item.color);
  if (!subcategory && !color) return null;
  return [item.category, subcategory, color, normalized(item.material)].join("|");
}

function categoryLabel(category: string, language: "ru" | "en"): string {
  if (language === "en") {
    return {
      outer: "outerwear",
      top: "tops",
      bottom: "bottoms",
      shoes: "shoes",
      accessory: "accessories",
    }[category] ?? category;
  }
  return {
    outer: "верхняя одежда",
    top: "верхи",
    bottom: "низы",
    shoes: "обувь",
    accessory: "аксессуары",
  }[category] ?? category;
}

export class WardrobeAuditService {
  constructor(private readonly services: ApplicationServices) {}

  async analyze(language: "ru" | "en" = "ru"): Promise<WardrobeAuditResult> {
    const items = await listAllActiveWardrobe(this.services.wardrobe);
    const byCategory = new Map<string, WardrobeItemDto[]>();
    items.forEach((item) => {
      const list = byCategory.get(item.category) ?? [];
      list.push(item);
      byCategory.set(item.category, list);
    });

    const strengths: string[] = [];
    const duplicates: WardrobeDuplicateGroup[] = [];
    const underusedItemIds = items
      .filter((item) => {
        const days = daysSince(item.lastWornAt);
        return (item.wearCount ?? 0) === 0 || (days !== null && days >= 90);
      })
      .map((item) => item.id)
      .slice(0, 40);
    const gaps: WardrobeGap[] = [];
    const recommendations: string[] = [];

    if (byCategory.has("top") && byCategory.has("bottom") && byCategory.has("shoes")) {
      strengths.push(language === "en"
        ? "The wardrobe has the basic structure for complete everyday outfits."
        : "В гардеробе есть база для полноценных повседневных образов.");
    }
    for (const category of ["top", "bottom", "shoes", "outer", "accessory"]) {
      const count = byCategory.get(category)?.length ?? 0;
      if (count >= 4) {
        strengths.push(language === "en"
          ? `${categoryLabel(category, language)} give you useful choice.`
          : `Категория «${categoryLabel(category, language)}» даёт хороший выбор.`);
      }
      if (!count && ["top", "bottom", "shoes"].includes(category)) {
        const priority = category === "shoes" ? 92 : 86;
        gaps.push({
          category,
          priority,
          reason: language === "en"
            ? `There are no active ${categoryLabel(category, language)} for a complete base.`
            : `Не хватает категории «${categoryLabel(category, language)}» для полной базы.`,
        });
      }
    }
    if (!byCategory.has("outer")) {
      gaps.push({
        category: "outer",
        priority: 56,
        reason: language === "en"
          ? "An outer layer would expand seasonal combinations."
          : "Дополнительный слой расширит сезонные сочетания.",
      });
    }

    const groups = new Map<string, WardrobeItemDto[]>();
    items.forEach((item) => {
      const signature = itemSignature(item);
      if (!signature) return;
      const group = groups.get(signature) ?? [];
      group.push(item);
      groups.set(signature, group);
    });
    groups.forEach((group) => {
      if (group.length < 2) return;
      duplicates.push({
        itemIds: group.map((item) => item.id),
        category: group[0].category,
        reason: language === "en"
          ? "Similar category, subtype and color; compare before buying another one."
          : "Похожие категория, подкатегория и цвет; перед покупкой стоит сравнить их.",
      });
    });

    if (underusedItemIds.length) {
      recommendations.push(language === "en"
        ? "Try the underused items in a safe combination before buying more basics."
        : "Сначала попробуйте собрать безопасные образы с недоиспользованными вещами, прежде чем покупать новую базу.");
    }
    if (duplicates.length) {
      recommendations.push(language === "en"
        ? "Avoid duplicate purchases unless the new item adds a different silhouette or occasion."
        : "Избегайте повторных покупок, если новая вещь не добавляет другой силуэт или сценарий.");
    }
    gaps.slice(0, 3).forEach((gap) => {
      recommendations.push(language === "en"
        ? `Consider a versatile ${categoryLabel(gap.category, language)} to expand combinations.`
        : `Рассмотрите универсальную категорию «${categoryLabel(gap.category, language)}», чтобы расширить число сочетаний.`);
    });

    return {
      strengths: strengths.slice(0, 8),
      duplicates: duplicates.slice(0, 12),
      underusedItemIds,
      gaps: gaps.sort((left, right) => right.priority - left.priority).slice(0, 8),
      recommendations: [...new Set(recommendations)].slice(0, 8),
      itemCount: items.length,
    };
  }
}
