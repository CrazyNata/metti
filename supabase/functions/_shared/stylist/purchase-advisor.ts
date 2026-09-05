import type { ApplicationServices } from "../services.ts";
import type { WardrobeItemDto } from "../types.ts";
import type { StylistContext, StylistItem } from "./types.ts";
import type { StylistLLM } from "./types.ts";
import { listAllActiveWardrobe } from "./wardrobe-analysis.ts";

export type PurchaseDecision = "buy" | "only_if" | "skip";

export interface PurchaseCandidateInput {
  name?: string | null;
  category?: string | null;
  subcategory?: string | null;
  colors?: string[];
  secondaryColors?: string[];
  material?: string | null;
  pattern?: string | null;
  season?: string[];
  styles?: string[];
  occasions?: string[];
  formality?: number | null;
  fit?: string | null;
  silhouette?: string | null;
  length?: string | null;
  warmth?: number | null;
  waterproof?: boolean | null;
  statementLevel?: number | null;
  imageDataUrl?: string | null;
}

export interface PurchaseCompatibility {
  compatibleTops: number;
  compatibleBottoms: number;
  compatibleOuterwear: number;
  compatibleShoes: number;
  compatibleBags: number;
  estimatedOutfitPotential: number;
  compatibilityScore: number;
  fillsWardrobeGap: boolean;
  duplicateRisk: boolean;
  matchingItemIds: string[];
}

export interface PurchaseAdvice extends PurchaseCompatibility {
  decision: PurchaseDecision;
  reason: string;
}

export interface PurchaseAdvisorRequest {
  candidate: PurchaseCandidateInput;
  context?: StylistContext;
  language?: "ru" | "en";
}

export interface PurchaseAnalysisInput {
  candidate: PurchaseCandidateInput;
  compatibility: PurchaseCompatibility;
  availableItems: StylistItem[];
  context?: StylistContext;
}

function text(value: unknown): string {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase().trim();
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function categoryFor(candidate: PurchaseCandidateInput): string {
  const category = text(candidate.category);
  if (category) return category;
  const value = text(`${candidate.name ?? ""} ${candidate.subcategory ?? ""}`);
  if (/(shoe|sneaker|boot|кроссов|обув|ботин|сапог)/u.test(value)) return "shoes";
  if (/(coat|jacket|outer|пальто|куртк|пиджак|жакет)/u.test(value)) return "outer";
  if (/(jean|pant|skirt|short|trouser|джинс|брюк|юбк|шорт)/u.test(value)) return "bottom";
  if (/(bag|сумк)/u.test(value)) return "accessory";
  if (/(dress|плать)/u.test(value)) return "dress";
  return "unknown";
}

function candidateItem(input: PurchaseCandidateInput): StylistItem {
  return {
    itemId: "purchase-candidate",
    category: categoryFor(input),
    subcategory: input.subcategory ?? null,
    colors: list(input.colors),
    secondaryColors: list(input.secondaryColors),
    material: input.material ?? null,
    pattern: input.pattern ?? null,
    season: list(input.season),
    styles: list(input.styles),
    occasions: list(input.occasions),
    formality: numeric(input.formality),
    fit: input.fit ?? null,
    silhouette: input.silhouette ?? null,
    length: input.length ?? null,
    warmth: numeric(input.warmth),
    waterproof: typeof input.waterproof === "boolean" ? input.waterproof : null,
    statementLevel: numeric(input.statementLevel),
    imageUrl: null,
    brand: null,
    notes: input.name ?? null,
    wearCount: 0,
    lastWornAt: null,
    feedbackScore: 0,
    userFavorite: false,
  };
}

function wardrobeItem(item: WardrobeItemDto): StylistItem {
  return {
    itemId: item.id,
    category: item.category,
    subcategory: item.subcategory,
    colors: item.colors.length ? item.colors : item.color ? [item.color] : [],
    secondaryColors: item.secondaryColors,
    material: item.material,
    pattern: item.pattern,
    season: item.seasons.length ? item.seasons : item.season ? [item.season] : [],
    styles: item.styles,
    occasions: item.occasions,
    formality: item.formality,
    fit: item.fit,
    silhouette: item.silhouette,
    length: item.length,
    warmth: item.warmth,
    waterproof: item.waterproof,
    statementLevel: item.statementLevel,
    imageUrl: item.imageUrl,
    brand: item.brand,
    notes: item.notes,
    wearCount: item.wearCount ?? 0,
    lastWornAt: item.lastWornAt,
    feedbackScore: 0,
    userFavorite: item.favorite,
  };
}

function overlap(left: string[], right: string[]): number {
  if (!left.length || !right.length) return 0;
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value)).length;
}

function neutralColor(value: string): boolean {
  return ["black", "white", "gray", "beige", "cream", "brown", "navy", "taupe"].includes(value);
}

function itemCompatibility(candidate: StylistItem, item: StylistItem): number {
  let score = 42;
  const colors = overlap(candidate.colors, item.colors);
  if (colors) score += 18;
  else if (candidate.colors.some(neutralColor) || item.colors.some(neutralColor)) score += 8;
  if (overlap(candidate.styles, item.styles)) score += 14;
  if (overlap(candidate.occasions, item.occasions)) score += 10;
  if (candidate.formality !== null && item.formality !== null) {
    score += Math.max(0, 10 - Math.abs(candidate.formality - item.formality) * 4);
  }
  if (candidate.warmth !== null && item.warmth !== null) {
    score += Math.max(0, 6 - Math.abs(candidate.warmth - item.warmth) * 3);
  }
  if (candidate.silhouette && item.silhouette && candidate.silhouette === item.silhouette) score += 5;
  return Math.max(0, Math.min(100, score));
}

function duplicateSimilarity(candidate: StylistItem, item: StylistItem): number {
  if (candidate.category !== item.category) return 0;
  let score = 45;
  if (candidate.subcategory && item.subcategory && text(candidate.subcategory) === text(item.subcategory)) score += 25;
  if (overlap(candidate.colors, item.colors)) score += 15;
  if (candidate.material && item.material && text(candidate.material) === text(item.material)) score += 8;
  if (candidate.silhouette && item.silhouette && text(candidate.silhouette) === text(item.silhouette)) score += 7;
  return Math.min(100, score);
}

function countFor(items: Array<{ item: StylistItem; score: number }>, category: string): number {
  return items.filter(({ item, score }) => item.category === category && score >= 52).length;
}

function reasonFor(
  advice: PurchaseCompatibility,
  language: "ru" | "en",
): string {
  if (language === "en") {
    if (advice.duplicateRisk && !advice.fillsWardrobeGap) return "It overlaps with an existing wardrobe item and does not close a clear gap.";
    if (advice.fillsWardrobeGap && advice.estimatedOutfitPotential >= 4) return "It closes a useful wardrobe gap and can support several combinations.";
    if (advice.estimatedOutfitPotential >= 2) return "It works with some existing pieces, but the purchase is worthwhile only if you need this specific role.";
    return "The current wardrobe does not provide enough strong combinations for this purchase.";
  }
  if (advice.duplicateRisk && !advice.fillsWardrobeGap) return "Вещь дублирует уже имеющуюся и не закрывает явный пробел гардероба.";
  if (advice.fillsWardrobeGap && advice.estimatedOutfitPotential >= 4) return "Вещь закрывает полезный пробел и может поддержать несколько сочетаний.";
  if (advice.estimatedOutfitPotential >= 2) return "Она сочетается с частью гардероба, но покупка оправдана только при необходимости именно этой роли.";
  return "В текущем гардеробе недостаточно сильных сочетаний для этой покупки.";
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function textValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function scoreValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : fallback;
}

function validatedAiAdvice(
  value: unknown,
  fallback: PurchaseAdvice,
  availableIds: Set<string>,
  language: "ru" | "en",
): PurchaseAdvice {
  const root = object(value);
  const decision = root.decision === "buy" || root.decision === "only_if" || root.decision === "skip"
    ? root.decision
    : fallback.decision;
  const matchingItemIds = Array.isArray(root.matchingItemIds)
    ? [...new Set(root.matchingItemIds.map(String).filter((id) => availableIds.has(id)))].slice(0, 30)
    : fallback.matchingItemIds;
  const normalized = {
    ...fallback,
    decision,
    compatibilityScore: scoreValue(root.compatibilityScore, fallback.compatibilityScore),
    matchingItemIds,
    estimatedOutfitPotential: Math.max(0, Math.min(50, Math.round(Number(root.estimatedOutfitPotential ?? fallback.estimatedOutfitPotential) || 0))),
    fillsWardrobeGap: typeof root.fillsWardrobeGap === "boolean" ? root.fillsWardrobeGap : fallback.fillsWardrobeGap,
    duplicateRisk: typeof root.duplicateRisk === "boolean" ? root.duplicateRisk : fallback.duplicateRisk,
    reason: textValue(root.reason, fallback.reason),
  };
  // The model may improve the prose, but the final decision remains subject
  // to the same safety rule as the local compatibility calculation.
  if (normalized.duplicateRisk && !normalized.fillsWardrobeGap) {
    normalized.decision = "skip";
  }
  if (!normalized.reason) normalized.reason = reasonFor(normalized, language);
  return normalized;
}

export class PurchaseAdvisorService {
  constructor(
    private readonly services: ApplicationServices,
    private readonly llm: StylistLLM | null = null,
  ) {}

  async analyze(request: PurchaseAdvisorRequest): Promise<PurchaseAdvice> {
    const language = request.language === "en" ? "en" : "ru";
    const candidate = candidateItem(request.candidate);
    const wardrobe = (await listAllActiveWardrobe(this.services.wardrobe)).map(wardrobeItem);
    const scored = wardrobe
      .map((item) => ({ item, score: itemCompatibility(candidate, item) }))
      .sort((left, right) => right.score - left.score || left.item.itemId.localeCompare(right.item.itemId));
    const matchingItemIds = scored.filter(({ score }) => score >= 52).map(({ item }) => item.itemId).slice(0, 30);
    const duplicateRisk = wardrobe.some((item) => duplicateSimilarity(candidate, item) >= 82);
    const category = candidate.category;
    const fillsWardrobeGap = category !== "unknown" && (
      !wardrobe.some((item) => item.category === category) ||
      scored.filter(({ item, score }) => item.category !== category && score >= 65).length === 0
    );
    const compatibility = {
      compatibleTops: countFor(scored, "top"),
      compatibleBottoms: countFor(scored, "bottom"),
      compatibleOuterwear: countFor(scored, "outer"),
      compatibleShoes: countFor(scored, "shoes"),
      compatibleBags: scored.filter(({ item, score }) => item.category === "accessory" && item.subcategory === "bag" && score >= 52).length,
      estimatedOutfitPotential: 0,
      compatibilityScore: scored.length ? Math.round(scored.slice(0, 8).reduce((sum, item) => sum + item.score, 0) / Math.min(8, scored.length)) : 0,
      fillsWardrobeGap,
      duplicateRisk,
      matchingItemIds,
    } satisfies PurchaseCompatibility;
    const basePotential = category === "top"
      ? compatibility.compatibleBottoms * Math.max(1, compatibility.compatibleShoes)
      : category === "bottom"
      ? compatibility.compatibleTops * Math.max(1, compatibility.compatibleShoes)
      : category === "shoes"
      ? compatibility.compatibleTops * Math.max(1, compatibility.compatibleBottoms)
      : category === "outer"
      ? Math.max(1, compatibility.compatibleTops) * Math.max(1, compatibility.compatibleBottoms) * Math.max(1, compatibility.compatibleShoes)
      : category === "accessory"
      ? Math.max(1, compatibility.compatibleTops) * Math.max(1, compatibility.compatibleBottoms)
      : 0;
    compatibility.estimatedOutfitPotential = Math.min(50, basePotential);
    const decision: PurchaseDecision = duplicateRisk && !fillsWardrobeGap
      ? "skip"
      : compatibility.compatibilityScore >= 68 && compatibility.estimatedOutfitPotential >= 4 && fillsWardrobeGap
      ? "buy"
      : compatibility.estimatedOutfitPotential >= 2
      ? "only_if"
      : "skip";
    const fallback: PurchaseAdvice = {
      ...compatibility,
      decision,
      reason: reasonFor(compatibility, language),
    };
    if (this.llm?.analyzePurchase) {
      try {
        const generated = await this.llm.analyzePurchase({
          candidate: request.candidate,
          compatibility,
          availableItems: wardrobe,
          context: request.context,
        });
        return validatedAiAdvice(
          generated,
          fallback,
          new Set(wardrobe.map((item) => item.itemId)),
          language,
        );
      } catch (_) {
        // Compatibility analysis remains useful when the remote provider is
        // unavailable or a store photo cannot be interpreted.
      }
    }
    return fallback;
  }
}
