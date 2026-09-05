import { asJsonObject, stringList } from "../serializers.ts";
import type { ApplicationServices } from "../services.ts";
import type {
  LearnedPreference,
  StyleProfileContext,
  StyleProfileLearningChanges,
  StylistLLM,
} from "./types.ts";
import { STYLE_PROFILE_LEARNER_PROMPT_VERSION } from "./prompts/index.ts";

export interface StyleProfileLearnerResult {
  changed: boolean;
  source: "ai" | "deterministic" | "none";
  provider?: string;
  promptVersion: string;
  changes: StyleProfileLearningChanges;
  learnedPreferences: LearnedPreference[];
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 240) : "";
}

function key(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().trim();
}

function confidence(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0;
}

function changeList(value: unknown): LearnedPreference[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === "string") {
      const preference = text(entry);
      return preference ? [{ preference, confidence: 0.6 }] : [];
    }
    const item = object(entry);
    const preference = text(item.preference ?? item.rule);
    return preference
      ? [{ preference, confidence: confidence(item.confidence) }]
      : [];
  }).slice(0, 30);
}

function styleProfileFrom(
  profile: Awaited<ReturnType<ApplicationServices["profile"]["get"]>>,
  row: Awaited<ReturnType<ApplicationServices["profile"]["getRow"]>>,
): StyleProfileContext {
  const raw = asJsonObject(row?.style_profile);
  const learned = Array.isArray(raw.learned_preferences)
    ? raw.learned_preferences
    : raw.learnedPreferences;
  return {
    preferredStyles: stringList(profile.styleTags),
    dislikedStyles: stringList(raw.disliked_styles ?? raw.dislikedStyles),
    favoriteColors: stringList(profile.preferredColors),
    dislikedColors: stringList(profile.avoidedColors),
    preferredFits: stringList(profile.preferredFits),
    dislikedFits: stringList(raw.disliked_fits ?? raw.dislikedFits),
    preferredFormality: stringList(raw.preferred_formality ?? raw.preferredFormality),
    favoriteItems: stringList(raw.favorite_items ?? raw.favoriteItems, 50),
    avoidRules: stringList(raw.avoid_rules ?? raw.avoidRules, 30),
    learnedPreferences: Array.isArray(learned)
      ? learned.flatMap((entry) => {
        const item = object(entry);
        const value = text(item.preference ?? item.rule);
        return value ? [value] : typeof entry === "string" ? [entry] : [];
      }).slice(0, 30)
      : [],
    confidence: confidence(raw.confidence) || null,
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

function repeatedFeedbackChanges(
  feedback: Awaited<ReturnType<ApplicationServices["feedback"]["list"]>>,
  language: "ru" | "en",
): LearnedPreference[] {
  const counts = new Map<string, number>();
  feedback.forEach((entry) => {
    if (!entry.reason) return;
    counts.set(entry.reason, (counts.get(entry.reason) ?? 0) + 1);
  });
  const labels: Record<string, [string, string]> = {
    too_formal: ["предпочитает менее формальные образы", "prefers less formal outfits"],
    too_casual: ["предпочитает более собранные образы", "prefers more polished outfits"],
    too_boring: ["предпочитает более интересные акценты", "prefers more interesting accents"],
    too_bright: ["предпочитает более спокойную палитру", "prefers a calmer palette"],
    too_dark: ["предпочитает не слишком тёмную палитру", "prefers a less dark palette"],
    not_my_style: ["избегает неподходящих стилевых сочетаний", "avoids style combinations that do not feel personal"],
    bad_proportions: ["предпочитает более сбалансированные пропорции", "prefers more balanced proportions"],
    wrong_shoes: ["требует более уместного выбора обуви", "needs more occasion-appropriate footwear"],
    too_many_layers: ["предпочитает меньше слоёв", "prefers fewer layers"],
    other: ["нуждается в повторной проверке образов по комментарию", "needs outfit decisions checked against repeated comments"],
  };
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .flatMap(([reason, count]) => {
      const label = labels[reason];
      if (!label) return [];
      return [{
        preference: label[language === "en" ? 1 : 0],
        confidence: Math.min(0.95, 0.62 + (count - 2) * 0.08),
      }];
    });
}

function stableSignal(
  feedbackCount: number,
  savedOutfitCount: number,
  wearCount: number,
): boolean {
  return feedbackCount >= 2 || savedOutfitCount >= 3 || wearCount >= 3;
}

function normalizeChanges(
  value: unknown,
  explicit: Set<string>,
  allowImplicit: boolean,
): StyleProfileLearningChanges {
  const root = object(value);
  const normalize = (list: LearnedPreference[], minimum = 0.6) =>
    allowImplicit
      ? list.filter((item) => item.confidence >= minimum && !explicit.has(key(item.preference)))
      : [];
  return {
    add: normalize(changeList(root.add)),
    remove: normalize(changeList(root.remove), 0.65),
    update: normalize(changeList(root.update), 0.55),
  };
}

function mergeChanges(
  first: StyleProfileLearningChanges,
  second: StyleProfileLearningChanges,
): StyleProfileLearningChanges {
  const merge = (left: LearnedPreference[], right: LearnedPreference[]) => {
    const values = new Map<string, LearnedPreference>();
    [...left, ...right].forEach((item) => {
      const itemKey = key(item.preference);
      const previous = values.get(itemKey);
      values.set(itemKey, previous && previous.confidence >= item.confidence ? previous : item);
    });
    return [...values.values()].slice(0, 30);
  };
  return {
    add: merge(first.add, second.add),
    remove: merge(first.remove, second.remove),
    update: merge(first.update, second.update),
  };
}

export class StyleProfileLearnerService {
  constructor(
    private readonly services: ApplicationServices,
    private readonly llm: StylistLLM | null = null,
  ) {}

  async learn(language: "ru" | "en" = "ru"): Promise<StyleProfileLearnerResult> {
    const [profile, row, feedback, savedOutfits, wearHistory] = await Promise.all([
      this.services.profile.get(),
      this.services.profile.getRow(),
      this.services.feedback.list(100).catch(() => []),
      this.services.outfits.list({ page: 1, limit: 100, status: "all" }),
      this.services.outfits.getWearHistory({ page: 1, limit: 100 }),
    ]);
    const styleProfile = styleProfileFrom(profile, row);
    styleProfile.favoriteItems = [...new Set([
      ...styleProfile.favoriteItems,
      ...savedOutfits.items
        .filter((outfit) => outfit.favorite)
        .flatMap((outfit) => outfit.itemIds)
        .map(String),
    ])].slice(0, 50);
    const explicit = new Set([
      ...styleProfile.preferredStyles,
      ...styleProfile.dislikedStyles,
      ...styleProfile.favoriteColors,
      ...styleProfile.dislikedColors,
      ...styleProfile.preferredFits,
      ...styleProfile.dislikedFits,
      ...styleProfile.preferredFormality,
      ...styleProfile.favoriteItems,
      ...styleProfile.avoidRules,
    ].map(key));
    const repeated = repeatedFeedbackChanges(feedback, language);
    const allowImplicit = stableSignal(
      feedback.length,
      savedOutfits.items.length,
      wearHistory.entries.length,
    );
    let changes = normalizeChanges(
      { add: repeated, remove: [], update: [] },
      explicit,
      allowImplicit,
    );
    let source: StyleProfileLearnerResult["source"] = changes.add.length ? "deterministic" : "none";
    let provider: string | undefined;
    if (allowImplicit && this.llm?.updateStyleProfile) {
      try {
        const generated = await this.llm.updateStyleProfile({
          styleProfile,
          feedback,
          savedOutfits: savedOutfits.items,
          wearHistory: wearHistory.entries,
        });
        changes = mergeChanges(changes, normalizeChanges(generated, explicit, true));
        source = "ai";
        provider = this.llm.provider;
      } catch (_) {
        // Deterministic repeated-signal changes remain safe and useful.
      }
    }
    const changed = changes.add.length > 0 || changes.remove.length > 0 || changes.update.length > 0;
    if (changed) {
      await this.services.profile.updateLearnedPreferences(changes);
    }
    const latest = await this.services.profile.getRow();
    const rawLearned = asJsonObject(latest?.style_profile).learned_preferences;
    const learnedPreferences = Array.isArray(rawLearned)
      ? rawLearned.flatMap((entry) => {
        const item = object(entry);
        const preference = text(item.preference ?? item.rule);
        return preference ? [{ preference, confidence: confidence(item.confidence) }] : [];
      }).slice(0, 30)
      : [];
    return {
      changed,
      source,
      ...(provider ? { provider } : {}),
      promptVersion: STYLE_PROFILE_LEARNER_PROMPT_VERSION,
      changes,
      learnedPreferences,
    };
  }
}
