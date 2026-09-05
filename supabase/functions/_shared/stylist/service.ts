import { AppError } from "../errors.ts";
import { asJsonObject, stringList } from "../serializers.ts";
import type { ApplicationServices } from "../services.ts";
import type { WardrobeItemDto } from "../types.ts";
import { filterWardrobe, toStylistItem } from "./filters.ts";
import {
  METTI_STYLIST_PROMPT_VERSION,
} from "./prompts/index.ts";
import {
  fallbackOutfitSuggestions,
  rankOutfits,
} from "./ranking.ts";
import { WardrobeAuditService } from "./wardrobe-auditor.ts";
import type {
  CriticResult,
  GenerateOutfitsInput,
  MissingPiece,
  OutfitCreativity,
  OutfitSuggestion,
  StyleProfileContext,
  StylistContext,
  StylistGenerationResult,
  StylistItem,
  StylistLLM,
  StylistMode,
} from "./types.ts";
import { validateOutfitResult } from "./validator.ts";

const MAX_WARDROBE_PAGES = 10;
const MAX_FILTERED_ITEMS = 80;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function number(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function boundedCount(value: unknown): number {
  const result = Number(value);
  return Number.isInteger(result) ? Math.max(1, Math.min(5, result)) : 3;
}

function preferenceTextList(value: unknown, max = 30): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((entry) => {
    if (typeof entry === "string") return entry.trim() ? [entry.trim()] : [];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const preference = (entry as Record<string, unknown>).preference ??
      (entry as Record<string, unknown>).rule;
    return typeof preference === "string" && preference.trim()
      ? [preference.trim()]
      : [];
  }))].slice(0, max);
}

function creativityForIndex(
  index: number,
  preferred?: OutfitCreativity,
): OutfitCreativity {
  if (preferred) return preferred;
  return index % 3 === 0 ? "safe" : index % 3 === 1 ? "balanced" : "bold";
}

function applyCreativityMix(
  outfits: OutfitSuggestion[],
  requestedCount: number,
  preferred?: OutfitCreativity,
): OutfitSuggestion[] {
  return outfits.map((outfit, index) => ({
    ...outfit,
    creativity: requestedCount >= 3 && !preferred && index < 3
      ? creativityForIndex(index)
      : outfit.creativity ?? creativityForIndex(index, preferred),
  }));
}

function unionIds(...lists: string[][]): string[] {
  return [...new Set(lists.flat())];
}

function auditGapsToMissingPieces(
  gaps: Awaited<ReturnType<WardrobeAuditService["analyze"]>>["gaps"],
): MissingPiece[] {
  return gaps.map((gap) => ({
    category: gap.category,
    preferredColors: [],
    priority: gap.priority,
    reason: gap.reason,
  }));
}

function styleProfileFrom(
  profile: Awaited<ReturnType<ApplicationServices["profile"]["get"]>>,
  row: Awaited<ReturnType<ApplicationServices["profile"]["getRow"]>>,
): StyleProfileContext {
  const rawStyleProfile = asJsonObject(row?.style_profile);
  const learnedPreferences = preferenceTextList(
    rawStyleProfile.learned_preferences ?? rawStyleProfile.learnedPreferences,
    30,
  );
  const favoriteItems = stringList(
    rawStyleProfile.favorite_items ?? rawStyleProfile.favoriteItems,
    50,
  );
  return {
    preferredStyles: stringList(profile.styleTags),
    dislikedStyles: stringList(rawStyleProfile.disliked_styles ?? rawStyleProfile.dislikedStyles),
    favoriteColors: stringList(profile.preferredColors),
    dislikedColors: stringList(profile.avoidedColors),
    preferredFits: stringList(profile.preferredFits),
    dislikedFits: stringList(rawStyleProfile.disliked_fits ?? rawStyleProfile.dislikedFits),
    preferredFormality: stringList(rawStyleProfile.preferred_formality ?? rawStyleProfile.preferredFormality),
    favoriteItems,
    avoidRules: stringList(rawStyleProfile.avoid_rules ?? rawStyleProfile.avoidRules, 30),
    learnedPreferences,
    confidence: number(rawStyleProfile.confidence),
    explicit: {
      styleTags: profile.styleTags,
      preferredColors: profile.preferredColors,
      avoidedColors: profile.avoidedColors,
      preferredBrands: profile.preferredBrands,
      dislikedBrands: profile.dislikedBrands,
      preferredFits: profile.preferredFits,
      clothingSizes: profile.clothingSizes,
      shoeSize: profile.shoeSize,
      height: profile.height,
      gender: profile.gender,
      styleNotes: profile.styleNotes,
    },
  };
}

function historyByItem(
  entries: Awaited<ReturnType<ApplicationServices["outfits"]["getWearHistory"]>>["entries"],
): { counts: Map<string, number>; lastWorn: Map<string, string> } {
  const counts = new Map<string, number>();
  const lastWorn = new Map<string, string>();
  entries.forEach((entry) => {
    entry.itemIds.forEach((itemId) => {
      counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
      if (entry.wornAt && !lastWorn.has(itemId)) lastWorn.set(itemId, entry.wornAt);
    });
  });
  return { counts, lastWorn };
}

function feedbackByItem(
  feedback: Awaited<ReturnType<ApplicationServices["feedback"]["list"]>>,
  outfits: Awaited<ReturnType<ApplicationServices["outfits"]["list"]>>["items"],
): Map<string, number> {
  const outfitById = new Map(outfits.map((outfit) => [outfit.id, outfit]));
  const scores = new Map<string, number>();
  feedback.forEach((entry) => {
    const outfit = outfitById.get(entry.outfitId);
    if (!outfit) return;
    // Keep this deliberately small: one click is a weak signal, not a new
    // explicit preference. Repeated reactions accumulate across outfits.
    const delta = entry.reaction === "like" ? 1 : -2;
    outfit.itemIds.forEach((itemId) => {
      scores.set(itemId, (scores.get(itemId) ?? 0) + delta);
    });
  });
  return scores;
}

function normalizeContext(
  context: StylistContext | undefined,
  city: string,
  language: "ru" | "en",
): StylistContext {
  return {
    ...(context ?? {}),
    location: context?.location ?? city,
    language,
  };
}

function normalizeCriticResults(value: unknown): CriticResult[] {
  const root = object(value);
  const values = Array.isArray(root.results) ? root.results : [];
  return values.flatMap((value) => {
    const item = object(value);
    const outfitIndex = Number(item.outfitIndex ?? item.outfit_index);
    const criticScore = Number(item.criticScore ?? item.critic_score);
    if (!Number.isInteger(outfitIndex) || !Number.isFinite(criticScore)) return [];
    const issues = Array.isArray(item.issues)
      ? item.issues.filter((issue): issue is string => typeof issue === "string").slice(0, 8)
      : [];
    return [{ outfitIndex, criticScore, issues }];
  });
}

function fallbackCandidates(
  input: GenerateOutfitsInput,
  items: StylistItem[],
  language: "ru" | "en",
  count: number,
  variantOffset: number,
): OutfitSuggestion[] {
  return fallbackOutfitSuggestions(items, {
    mode: input.mode,
    prompt: input.prompt,
    selectedItemId: input.selectedItemId,
    currentItemIds: input.currentItemIds,
    lockedItemIds: input.lockedItemIds,
    preferredCreativity: input.preferredCreativity,
    variantOffset,
  }, language, count);
}

export class StylistService {
  constructor(
    private readonly services: ApplicationServices,
    private readonly llm: StylistLLM | null,
    private readonly env: { get(name: string): string | undefined } = Deno.env,
  ) {}

  private async listAllWardrobe(): Promise<WardrobeItemDto[]> {
    const result: WardrobeItemDto[] = [];
    for (let page = 1; page <= MAX_WARDROBE_PAGES; page += 1) {
      const current = await this.services.wardrobe.list({
        status: "active",
        page,
        limit: 100,
      });
      result.push(...current.items);
      if (!current.pagination.hasMore || !current.items.length) break;
    }
    return result;
  }

  async generate(input: {
    mode?: StylistMode;
    prompt?: string;
    count?: number;
    selectedItemId?: string;
    currentItemIds?: string[];
    lockedItemIds?: string[];
    instruction?: string;
    preferredCreativity?: OutfitCreativity;
    context?: StylistContext;
    language?: "ru" | "en";
  }): Promise<StylistGenerationResult> {
    const mode = input.mode ?? "today";
    const language = input.language === "en" ? "en" : "ru";
    const prompt = String(input.prompt ?? "").trim().slice(0, 1000);
    const count = boundedCount(input.count);
    const currentItemIds = [...new Set((input.currentItemIds ?? []).map(String).filter(Boolean))].slice(0, 20);
    const lockedItemIds = [...new Set((input.lockedItemIds ?? []).map(String).filter(Boolean))].slice(0, 20);
    const allWardrobe = await this.listAllWardrobe();
    const availableIds = new Set(allWardrobe.map((item) => String(item.id)));
    const referencedIds = [...currentItemIds, ...lockedItemIds, ...(input.selectedItemId ? [input.selectedItemId] : [])];
    if (referencedIds.some((id) => !availableIds.has(id))) {
      throw new AppError("not_found", "One or more wardrobe items were not found.", 404);
    }
    if (mode === "restyle" && !currentItemIds.length) {
      throw new AppError("invalid_input", "currentItemIds is required for restyle.");
    }
    if (lockedItemIds.some((id) => !currentItemIds.includes(id))) {
      throw new AppError("invalid_input", "lockedItemIds must belong to currentItemIds.");
    }

    const [profile, profileRow, wearHistory, feedback, savedOutfits] = await Promise.all([
      this.services.profile.get(),
      this.services.profile.getRow(),
      this.services.outfits.getWearHistory({ page: 1, limit: 100 }),
      // Feedback is an enhancement signal. A rollout where the migration has
      // not landed yet must not take down the core wardrobe recommendation.
      this.services.feedback.list(100).catch(() => []),
      this.services.outfits.list({ page: 1, limit: 100, status: "all" }),
    ]);
    const history = historyByItem(wearHistory.entries);
    const feedbackScores = feedbackByItem(feedback, savedOutfits.items);
    const context = normalizeContext(input.context, profile.city, language);
    const styleProfile = styleProfileFrom(profile, profileRow);
    const favoriteOutfitItemIds = savedOutfits.items
      .filter((outfit) => outfit.favorite)
      .flatMap((outfit) => outfit.itemIds)
      .map(String);
    styleProfile.favoriteItems = [...new Set([
      ...styleProfile.favoriteItems,
      ...favoriteOutfitItemIds,
    ])].slice(0, 50);
    const rawItems = allWardrobe.map((item) =>
      toStylistItem(
        item,
        Math.max(item.wearCount ?? 0, history.counts.get(item.id) ?? 0),
        item.lastWornAt ?? history.lastWorn.get(item.id) ?? null,
        feedbackScores.get(item.id) ?? 0,
      )
    );
    const generationInput: GenerateOutfitsInput = {
      mode,
      prompt,
      count,
      ...(input.selectedItemId ? { selectedItemId: input.selectedItemId } : {}),
      currentItemIds,
      lockedItemIds,
      ...(input.instruction ? { instruction: input.instruction.slice(0, 1000) } : {}),
      ...(input.preferredCreativity ? { preferredCreativity: input.preferredCreativity } : {}),
      context,
      styleProfile,
      availableItems: [],
    };
    const filtered = filterWardrobe(rawItems, generationInput, MAX_FILTERED_ITEMS);
    generationInput.availableItems = filtered.items;
    const startedAt = Date.now();
    const fallbackVariantOffset = startedAt;
    const debug = this.env.get("STYLIST_DEBUG") === "true";
    const shoppingAudit = mode === "shopping_recommendation"
      ? await new WardrobeAuditService(this.services).analyze(language)
      : null;
    const baseLog = {
      mode,
      availableItems: rawItems.length,
      filteredItems: filtered.items.length,
      selectedItem: input.selectedItemId ?? null,
      promptVersion: METTI_STYLIST_PROMPT_VERSION,
    };
    if (debug) console.info("stylist request", baseLog);

    if (!this.llm) {
      const fallback = validateOutfitResult(
        {
          outfits: mode === "shopping_recommendation" ? [] : fallbackCandidates(
            generationInput,
            filtered.items,
            language,
            count,
            fallbackVariantOffset,
          ),
          reason: "",
        },
        {
          availableItems: filtered.items,
          mode,
          selectedItemId: input.selectedItemId,
          lockedItemIds,
          preferredCreativity: input.preferredCreativity,
          count,
        },
      );
      return {
        outfits: rankOutfits(
          applyCreativityMix(fallback.outfits, count, input.preferredCreativity),
          [],
          count,
        ).map(({ stylistScore: _stylist, criticScore: _critic, finalScore: _final, ...outfit }) => outfit),
        capsuleItemIds: fallback.capsuleItemIds,
        missingPieces: shoppingAudit
          ? auditGapsToMissingPieces(shoppingAudit.gaps)
          : fallback.missingPieces,
        reason: mode === "shopping_recommendation" || fallback.outfits.length
          ? undefined
          : "no_suitable_combination",
        source: "local-fallback",
        promptVersion: METTI_STYLIST_PROMPT_VERSION,
        availableCount: rawItems.length,
        filteredCount: filtered.items.length,
        validationErrors: fallback.errors,
        latencyMs: Date.now() - startedAt,
      };
    }

    let generated: unknown;
    try {
      generated = await this.llm.generateOutfits(generationInput);
    } catch (error) {
      if (debug) console.warn("stylist provider unavailable", { ...baseLog, error: error instanceof Error ? error.message : String(error) });
      const fallback = validateOutfitResult(
        {
          outfits: mode === "shopping_recommendation" ? [] : fallbackCandidates(
            generationInput,
            filtered.items,
            language,
            count,
            fallbackVariantOffset,
          ),
          reason: "",
        },
        {
          availableItems: filtered.items,
          mode,
          selectedItemId: input.selectedItemId,
          lockedItemIds,
          preferredCreativity: input.preferredCreativity,
          count,
        },
      );
      return {
        outfits: rankOutfits(
          applyCreativityMix(fallback.outfits, count, input.preferredCreativity),
          [],
          count,
        ).map(({ stylistScore: _stylist, criticScore: _critic, finalScore: _final, ...outfit }) => outfit),
        capsuleItemIds: fallback.capsuleItemIds,
        missingPieces: shoppingAudit
          ? auditGapsToMissingPieces(shoppingAudit.gaps)
          : fallback.missingPieces,
        reason: mode === "shopping_recommendation" || fallback.outfits.length
          ? undefined
          : "no_suitable_combination",
        source: "local-fallback",
        provider: this.llm.provider,
        promptVersion: METTI_STYLIST_PROMPT_VERSION,
        availableCount: rawItems.length,
        filteredCount: filtered.items.length,
        validationErrors: fallback.errors,
        latencyMs: Date.now() - startedAt,
      };
    }

    const validated = validateOutfitResult(generated, {
      availableItems: filtered.items,
      mode,
      selectedItemId: input.selectedItemId,
      lockedItemIds,
      preferredCreativity: input.preferredCreativity,
      count,
    });
    if (debug) console.info("stylist raw result", { ...baseLog, result: generated });
    if (debug) console.info("stylist validation", { ...baseLog, errors: validated.errors, candidates: validated.outfits.length });
    let candidateOutfits = validated.outfits;
    let validationErrors = [...validated.errors];
    let capsuleItemIds = validated.capsuleItemIds;
    let missingPieces: MissingPiece[] = validated.missingPieces;
    if (shoppingAudit && !missingPieces.length) {
      missingPieces = auditGapsToMissingPieces(shoppingAudit.gaps);
    }
    if (mode === "shopping_recommendation") {
      // Shopping recommendations are not wardrobe outfits. Keep the response
      // in the dedicated missingPieces channel even if a provider returns an
      // accidental outfit candidate.
      candidateOutfits = [];
      capsuleItemIds = [];
    }

    // Give the provider exactly one chance to repair invalid IDs or structure.
    // Valid candidates are retained; a failed repair can never make the
    // original safe result disappear.
    if (validated.errors.length && this.llm.repairOutfits) {
      if (debug) console.info("stylist corrective retry", {
        ...baseLog,
        errors: validated.errors,
      });
      try {
        const repaired = await this.llm.repairOutfits({
          generation: generationInput,
          validationErrors: validated.errors,
          previousResponse: generated,
        });
        const repairedValidation = validateOutfitResult(repaired, {
          availableItems: filtered.items,
          mode,
          selectedItemId: input.selectedItemId,
          lockedItemIds,
          preferredCreativity: input.preferredCreativity,
          count,
        });
        candidateOutfits = [...candidateOutfits, ...repairedValidation.outfits];
        capsuleItemIds = unionIds(capsuleItemIds, repairedValidation.capsuleItemIds);
        missingPieces = [...missingPieces, ...repairedValidation.missingPieces].slice(0, 8);
        validationErrors = [...new Set([
          ...validationErrors,
          "corrective_retry_attempted",
          ...repairedValidation.errors,
        ])].slice(0, 30);
        if (debug) console.info("stylist corrective retry result", {
          ...baseLog,
          errors: repairedValidation.errors,
          candidates: repairedValidation.outfits.length,
        });
      } catch (error) {
        validationErrors = [...new Set([
          ...validationErrors,
          "corrective_retry_failed",
        ])].slice(0, 30);
        if (debug) console.warn("stylist corrective retry failed", {
          ...baseLog,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const requestedVariants = Math.max(1, Math.min(count, 5));
    const diverseProviderCandidates = rankOutfits(
      candidateOutfits,
      [],
      requestedVariants,
    );
    if (diverseProviderCandidates.length < requestedVariants) {
      const supplemental = validateOutfitResult(
        {
          outfits: fallbackCandidates(
            generationInput,
            filtered.items,
            language,
            Math.min(5, requestedVariants + 2),
            fallbackVariantOffset,
          ),
          reason: "",
        },
        {
          availableItems: filtered.items,
          mode,
          selectedItemId: input.selectedItemId,
          lockedItemIds,
          preferredCreativity: input.preferredCreativity,
          count: Math.min(5, requestedVariants + 2),
        },
      );
      candidateOutfits = [
        ...candidateOutfits,
        ...supplemental.outfits,
      ].slice(0, 10);
      validationErrors = [...new Set([
        ...validationErrors,
        ...supplemental.errors,
      ])].slice(0, 30);
      capsuleItemIds = unionIds(capsuleItemIds, supplemental.capsuleItemIds);
      missingPieces = [...missingPieces, ...supplemental.missingPieces].slice(0, 8);
    }
    candidateOutfits = applyCreativityMix(
      candidateOutfits,
      requestedVariants,
      input.preferredCreativity,
    );
    if (mode === "packing" && !capsuleItemIds.length) {
      capsuleItemIds = unionIds(...candidateOutfits.map((outfit) => outfit.itemIds));
    }
    let critics: CriticResult[] = [];
    const criticEnabled = this.env.get("STYLIST_CRITIC_ENABLED") !== "false";
    if (criticEnabled && candidateOutfits.length > 1) {
      try {
        critics = normalizeCriticResults(await this.llm.critiqueOutfits({
          context,
          styleProfile,
          outfits: candidateOutfits,
          availableItems: filtered.items,
        }));
      } catch (error) {
        if (debug) console.warn("stylist critic unavailable", error instanceof Error ? error.message : error);
      }
    }
    const ranked = rankOutfits(candidateOutfits, critics, count);
    const result: StylistGenerationResult = {
      outfits: ranked.map(({ stylistScore: _stylist, criticScore: _critic, finalScore: _final, ...outfit }) => outfit),
      capsuleItemIds,
      missingPieces,
      reason: mode === "shopping_recommendation" || ranked.length
        ? undefined
        : "no_suitable_combination",
      source: "ai",
      provider: this.llm.provider,
      promptVersion: METTI_STYLIST_PROMPT_VERSION,
      availableCount: rawItems.length,
      filteredCount: filtered.items.length,
      validationErrors,
      latencyMs: Date.now() - startedAt,
    };
    if (debug) console.info("stylist result", {
      ...baseLog,
      candidates: result.outfits.length,
      outfits: result.outfits.map((outfit) => ({ name: outfit.name, itemIds: outfit.itemIds })),
      latencyMs: result.latencyMs,
    });
    return result;
  }
}
