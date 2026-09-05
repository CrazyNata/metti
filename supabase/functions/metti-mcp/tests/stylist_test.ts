import { createApplicationServices } from "../../_shared/services.ts";
import { filterWardrobe, scoreStylistItem } from "../../_shared/stylist/filters.ts";
import { PurchaseAdvisorService } from "../../_shared/stylist/purchase-advisor.ts";
import { StyleProfileLearnerService } from "../../_shared/stylist/profile-learner.ts";
import { buildStylistUserPrompt } from "../../_shared/stylist/prompts/modes.ts";
import {
  buildRoleSkillPrompt,
  buildStylistSkillPrompt,
} from "../../_shared/stylist/prompts/skills.ts";
import {
  fallbackOutfitSuggestions,
  rankOutfits,
} from "../../_shared/stylist/ranking.ts";
import { StylistService } from "../../_shared/stylist/service.ts";
import { WardrobeAuditService } from "../../_shared/stylist/wardrobe-auditor.ts";
import { canonicalVocabularyValue } from "../../_shared/stylist/vocabulary.ts";
import type {
  GenerateOutfitsInput,
  OutfitSuggestion,
  StylistItem,
  StylistLLM,
} from "../../_shared/stylist/types.ts";
import { validateOutfitResult } from "../../_shared/stylist/validator.ts";
import type { AuthenticatedUser } from "../../_shared/types.ts";
import { assert, assertEquals } from "./assert.ts";
import { MemoryDataClient, outfitRow } from "./fake-client.ts";

const userA: AuthenticatedUser = { id: "user-a", email: "a@example.com" };

function item(
  itemId: string,
  category: string,
  overrides: Partial<StylistItem> = {},
): StylistItem {
  return {
    itemId,
    category,
    subcategory: null,
    colors: [],
    secondaryColors: [],
    material: null,
    pattern: null,
    season: [],
    styles: [],
    occasions: [],
    formality: null,
    fit: null,
    silhouette: null,
    length: null,
    warmth: null,
    waterproof: null,
    statementLevel: null,
    imageUrl: null,
    brand: null,
    notes: null,
    wearCount: 0,
    lastWornAt: null,
    feedbackScore: 0,
    userFavorite: false,
    ...overrides,
  };
}

function input(
  availableItems: StylistItem[],
  overrides: Partial<GenerateOutfitsInput> = {},
): GenerateOutfitsInput {
  return {
    mode: "today",
    prompt: "casual city outfit",
    count: 3,
    currentItemIds: [],
    lockedItemIds: [],
    context: {
      location: "Prague",
      temperature: 18,
      feelsLike: 17,
      weather: "clear",
      precipitation: 0,
      wind: 8,
      occasion: "everyday",
    },
    styleProfile: {
      preferredStyles: ["minimal"],
      dislikedStyles: [],
      favoriteColors: [],
      dislikedColors: [],
      preferredFits: [],
      dislikedFits: [],
      preferredFormality: [],
      favoriteItems: [],
      avoidRules: [],
      learnedPreferences: [],
      confidence: null,
      explicit: {},
    },
    availableItems,
    ...overrides,
  };
}

function outfit(itemIds: string[], score = 80): OutfitSuggestion {
  return {
    name: "Test outfit",
    itemIds,
    creativity: "balanced",
    style: ["minimal"],
    occasion: ["everyday"],
    score,
    explanation: "Балансирует объёмы и подходит для города.",
    warnings: [],
  };
}

Deno.test("stylist prompt keeps the selected item and real wardrobe contract", () => {
  const prompt = buildStylistUserPrompt(input([
    item("top-1", "top", { colors: ["white"] }),
    item("bag-1", "accessory", { subcategory: "bag", statementLevel: 4 }),
  ], { mode: "selected_item", selectedItemId: "bag-1" }));
  assert(prompt.includes("selectedItemId: bag-1"));
  assert(prompt.includes("availableItems"));
  assert(prompt.includes("itemId"));
});

Deno.test("shared stylist skills enforce complete anchored outfits and diversity", () => {
  const prompt = buildStylistSkillPrompt("selected_item");
  assert(prompt.includes("selected_anchor"));
  assert(prompt.includes("полный образ"));
  assert(prompt.includes("itemId"));
  assert(prompt.includes("дубликаты"));
});

Deno.test("specialized roles keep critic and learner responsibilities separate", () => {
  const critic = buildRoleSkillPrompt("critic");
  const learner = buildRoleSkillPrompt("learner");
  assert(critic.includes("не исправляй образ самостоятельно"));
  assert(learner.includes("явные настройки пользователя"));
  assert(critic !== learner);
});

Deno.test("validator drops hallucinated ids and structurally invalid outfits", () => {
  const available = [
    item("top-1", "top"),
    item("bottom-1", "bottom"),
    item("shoes-1", "shoes"),
  ];
  const result = validateOutfitResult({
    outfits: [
      outfit(["top-1", "bottom-1", "shoes-1"]),
      outfit(["top-1", "bottom-1", "black_boots_123"]),
      outfit(["top-1", "bottom-1"]),
    ],
  }, input(available));
  assertEquals(result.outfits.length, 1);
  assertEquals(result.outfits[0].itemIds, ["top-1", "bottom-1", "shoes-1"]);
  assert(result.errors.includes("1:unknown_item_id"));
  assert(result.errors.includes("2:missing_shoes"));
});

Deno.test("validator rejects outerwear and shoes without base layers", () => {
  const available = [
    item("jacket-1", "outer", { subcategory: "jacket" }),
    item("top-1", "top", { subcategory: "shirt" }),
    item("bottom-1", "bottom"),
    item("shoes-1", "shoes", { subcategory: "sneakers" }),
  ];
  const result = validateOutfitResult({
    outfits: [
      outfit(["jacket-1", "shoes-1"]),
      outfit(["jacket-1", "top-1", "bottom-1", "shoes-1"]),
    ],
  }, input(available, { prompt: "куртка и кроссовки" }));
  assertEquals(result.outfits.length, 1);
  assertEquals(result.outfits[0].itemIds, ["jacket-1", "top-1", "bottom-1", "shoes-1"]);
  assert(result.errors.includes("0:missing_base_layers"));
});

Deno.test("fallback keeps anchors and rotates complete wardrobe variants", () => {
  const available = [
    item("jacket-1", "outer", { subcategory: "jacket" }),
    item("top-1", "top", { subcategory: "shirt" }),
    item("top-2", "top", { subcategory: "shirt" }),
    item("top-3", "top", { subcategory: "shirt" }),
    item("bottom-1", "bottom"),
    item("bottom-2", "bottom"),
    item("bottom-3", "bottom"),
    item("shoes-1", "shoes", { subcategory: "sneakers" }),
    item("shoes-2", "shoes", { subcategory: "sneakers" }),
    item("shoes-3", "shoes", { subcategory: "sneakers" }),
  ];
  const suggestions = fallbackOutfitSuggestions(
    available,
    {
      mode: "selected_item",
      selectedItemId: "jacket-1",
      prompt: "куртка и кроссовки",
    },
    "ru",
    3,
  );
  assertEquals(suggestions.length, 3);
  assertEquals(new Set(suggestions.map((value) => value.itemIds.join("|"))).size, 3);
  suggestions.forEach((suggestion) => {
    assert(suggestion.itemIds.includes("jacket-1"));
    assert(suggestion.itemIds.some((id) => id.startsWith("top-")));
    assert(suggestion.itemIds.some((id) => id.startsWith("bottom-")));
    assert(suggestion.itemIds.some((id) => id.startsWith("shoes-")));
  });
});

Deno.test("selected item is mandatory in every validated candidate", () => {
  const available = [
    item("top-1", "top"),
    item("bottom-1", "bottom"),
    item("shoes-1", "shoes"),
    item("bag-1", "accessory", { subcategory: "bag" }),
  ];
  const result = validateOutfitResult({
    outfits: [
      outfit(["top-1", "bottom-1", "shoes-1"]),
      outfit(["top-1", "bottom-1", "shoes-1", "bag-1"]),
    ],
  }, input(available, { mode: "selected_item", selectedItemId: "bag-1" }));
  assertEquals(result.outfits.length, 1);
  assertEquals(result.outfits[0].itemIds.includes("bag-1"), true);
  assert(result.errors.includes("0:selected_item_missing"));
});

Deno.test("soft filtering favors weather-appropriate items without deleting the wardrobe", () => {
  const cold = input([
    item("tee", "top", { subcategory: "tshirt", warmth: 1 }),
    item("shorts", "bottom", { subcategory: "shorts", warmth: 1 }),
    item("coat", "outer", { warmth: 5 }),
    item("boots", "shoes", { warmth: 5 }),
  ], { context: { temperature: 2, feelsLike: 0, precipitation: 3, occasion: "everyday" } });
  assert(scoreStylistItem(cold.availableItems[2], cold) > scoreStylistItem(cold.availableItems[0], cold));
  const filtered = filterWardrobe(cold.availableItems, cold, 4);
  assertEquals(filtered.items.length, 4);
  assert(filtered.items.some((value) => value.itemId === "coat"));
  assert(filtered.items.some((value) => value.itemId === "boots"));
});

Deno.test("formal context penalizes obvious gym pieces when better pieces exist", () => {
  const available = [
    item("blazer", "top", { subcategory: "blazer", formality: 4, styles: ["smart casual"] }),
    item("hoodie", "top", { subcategory: "hoodie", formality: 1, styles: ["sport"] }),
  ];
  const formal = input(available, { prompt: "formal dinner", context: { occasion: "formal dinner", temperature: 18 } });
  assert(scoreStylistItem(available[0], formal) > scoreStylistItem(available[1], formal));
});

Deno.test("ranking removes near-duplicate outfits and prefers the critic score", () => {
  const outfits = [
    outfit(["top-1", "bottom-1", "shoes-1"], 88),
    outfit(["top-1", "bottom-1", "shoes-1", "bag-1"], 95),
    outfit(["top-2", "bottom-2", "shoes-2"], 70),
  ];
  const ranked = rankOutfits(outfits, [
    { outfitIndex: 0, criticScore: 60, issues: ["Слишком формально"] },
    { outfitIndex: 1, criticScore: 98, issues: [] },
    { outfitIndex: 2, criticScore: 80, issues: [] },
  ], 5);
  assertEquals(ranked.length, 2);
  assertEquals(ranked[0].itemIds, ["top-1", "bottom-1", "shoes-1", "bag-1"]);
  assert(ranked[0].warnings.includes("Слишком формально") === false);
});

Deno.test("shared StylistService validates provider output before ranking it", async () => {
  const db = new MemoryDataClient(userA.id);
  db.seedProfile({
    id: userA.id,
    display_name: "Anna",
    city: "Prague",
    preferences: {},
    style_tags: ["minimal"],
    style_profile: {},
  });
  db.seedWardrobe(
    { ...wardrobeFixture("top-1", "top"), metadata: { subcategory: "shirt" } },
    { ...wardrobeFixture("top-2", "top"), metadata: { subcategory: "blazer" } },
    wardrobeFixture("bottom-1", "bottom"),
    wardrobeFixture("bottom-2", "bottom"),
    wardrobeFixture("shoes-1", "shoes"),
  );
  const services = createApplicationServices(db, userA);
  const llm: StylistLLM = {
    provider: "test",
    generateOutfits: async () => ({
      outfits: [
        outfit(["top-1", "bottom-1", "shoes-1"], 80),
        outfit(["top-2", "bottom-2", "shoes-1"], 90),
        outfit(["top-1", "bottom-1", "missing-item"], 100),
      ],
      reason: "",
    }),
    critiqueOutfits: async () => ({
      results: [
        { outfitIndex: 0, criticScore: 98, issues: [] },
        { outfitIndex: 1, criticScore: 20, issues: ["Слишком формально"] },
      ],
    }),
  };
  const service = new StylistService(services, llm, { get: () => undefined });
  const result = await service.generate({ mode: "today", count: 2, prompt: "city" });
  assertEquals(result.source, "ai");
  assertEquals(result.outfits[0].itemIds, ["top-1", "bottom-1", "shoes-1"]);
  assert(result.validationErrors?.includes("2:unknown_item_id"));
  assertEquals(result.outfits.length, 2);
});

Deno.test("one corrective retry repairs invalid provider output and never loops", async () => {
  const db = new MemoryDataClient(userA.id);
  db.seedProfile({
    id: userA.id,
    display_name: "Anna",
    city: "Prague",
    preferences: {},
    style_tags: ["minimal"],
    style_profile: {},
  });
  db.seedWardrobe(
    wardrobeFixture("top-1", "top"),
    wardrobeFixture("bottom-1", "bottom"),
    wardrobeFixture("shoes-1", "shoes"),
  );
  let repairCalls = 0;
  const services = createApplicationServices(db, userA);
  const llm: StylistLLM = {
    provider: "test",
    generateOutfits: async () => ({
      outfits: [outfit(["top-1", "bottom-1", "missing-item"], 90)],
      reason: "",
    }),
    repairOutfits: async () => {
      repairCalls += 1;
      return {
        outfits: [outfit(["top-1", "bottom-1", "shoes-1"], 82)],
        reason: "",
      };
    },
    critiqueOutfits: async () => ({ results: [] }),
  };
  const result = await new StylistService(services, llm, { get: () => undefined })
    .generate({ mode: "today", count: 1, prompt: "city" });
  assertEquals(repairCalls, 1);
  assertEquals(result.outfits[0].itemIds, ["top-1", "bottom-1", "shoes-1"]);
  assert(result.validationErrors?.includes("corrective_retry_attempted"));
});

Deno.test("a second invalid repair is discarded without a second retry", async () => {
  const db = new MemoryDataClient(userA.id);
  db.seedProfile({
    id: userA.id,
    display_name: "Anna",
    city: "Prague",
    preferences: {},
    style_tags: [],
    style_profile: {},
  });
  db.seedWardrobe(
    wardrobeFixture("top-1", "top"),
    wardrobeFixture("bottom-1", "bottom"),
    wardrobeFixture("shoes-1", "shoes"),
  );
  let repairCalls = 0;
  const services = createApplicationServices(db, userA);
  const llm: StylistLLM = {
    provider: "test",
    generateOutfits: async () => ({ outfits: [outfit(["missing-item"], 100)], reason: "" }),
    repairOutfits: async () => {
      repairCalls += 1;
      return { outfits: [outfit(["still-missing"], 100)], reason: "" };
    },
    critiqueOutfits: async () => ({ results: [] }),
  };
  const result = await new StylistService(services, llm, { get: () => undefined })
    .generate({ mode: "today", count: 1, prompt: "city" });
  assertEquals(repairCalls, 1);
  assertEquals(result.outfits.length, 1);
  assert(result.outfits[0].itemIds.every((id) => ["top-1", "bottom-1", "shoes-1"].includes(id)));
  assert(result.validationErrors?.includes("1:unknown_item_id") || result.validationErrors?.includes("0:unknown_item_id"));
});

Deno.test("controlled vocabulary canonicalizes stylist labels and rejects inventions", () => {
  assertEquals(canonicalVocabularyValue("minimalist", "style"), "minimal");
  assertEquals(canonicalVocabularyValue("smart casual", "style"), "smart_casual");
  assertEquals(canonicalVocabularyValue("made_up_style", "style"), null);
});

Deno.test("wardrobe audit and purchase advisor use real wardrobe ids", async () => {
  const db = new MemoryDataClient(userA.id);
  db.seedWardrobe(
    { ...wardrobeFixture("top-1", "top"), metadata: { subcategory: "shirt", colors: ["white"] } },
    { ...wardrobeFixture("bottom-1", "bottom"), metadata: { subcategory: "jeans", colors: ["blue"] } },
    { ...wardrobeFixture("shoes-1", "shoes"), metadata: { subcategory: "sneakers", colors: ["white"] } },
  );
  const services = createApplicationServices(db, userA);
  const audit = await new WardrobeAuditService(services).analyze();
  assertEquals(audit.itemCount, 3);
  assert(audit.strengths.some((value) => value.includes("база")));
  const purchase = await new PurchaseAdvisorService(services).analyze({
    candidate: { category: "top", subcategory: "shirt", colors: ["white"] },
  });
  assert(purchase.matchingItemIds.every((id) => ["top-1", "bottom-1", "shoes-1"].includes(id)));
  assertEquals(purchase.duplicateRisk, true);
});

Deno.test("feedback is owned, upserted and available to the shared application services", async () => {
  const db = new MemoryDataClient(userA.id);
  db.seedOutfits(outfitRow("outfit-1", userA.id, { item_ids: ["top-1", "shoes-1"] }));
  const services = createApplicationServices(db, userA);
  const first = await services.feedback.save({ outfitId: "outfit-1", reaction: "dislike", reason: "wrong_shoes" });
  assertEquals(first.reaction, "dislike");
  assertEquals(db.feedback("outfit-1")?.reason, "wrong_shoes");
  const second = await services.feedback.save({ outfitId: "outfit-1", reaction: "like" });
  assertEquals(second.reaction, "like");
  assertEquals(db.feedback("outfit-1")?.reason, null);
});

Deno.test("profile learner applies repeated dislikes but preserves explicit settings", async () => {
  const db = new MemoryDataClient(userA.id);
  db.seedProfile({
    id: userA.id,
    display_name: "Anna",
    city: "Prague",
    preferences: { preferred_fits: ["relaxed"] },
    style_tags: ["minimal"],
    style_profile: {},
  });
  db.seedOutfits(
    outfitRow("outfit-1", userA.id, { item_ids: ["top-1"] }),
    outfitRow("outfit-2", userA.id, { item_ids: ["top-2"] }),
  );
  const services = createApplicationServices(db, userA);
  await services.feedback.save({ outfitId: "outfit-1", reaction: "dislike", reason: "too_formal" });
  await services.feedback.save({ outfitId: "outfit-2", reaction: "dislike", reason: "too_formal" });
  const learned = await new StyleProfileLearnerService(services).learn();
  assertEquals(learned.changed, true);
  assert(learned.learnedPreferences.some((entry) => entry.preference.includes("менее формальные")));
  assertEquals(db.profile()?.style_tags, ["minimal"]);
  assertEquals(db.profile()?.preferences?.preferred_fits, ["relaxed"]);
});

Deno.test("one isolated dislike does not create a learned global rule", async () => {
  const db = new MemoryDataClient(userA.id);
  db.seedProfile({
    id: userA.id,
    display_name: "Anna",
    city: "Prague",
    preferences: {},
    style_tags: [],
    style_profile: {},
  });
  db.seedOutfits(outfitRow("outfit-1", userA.id, { item_ids: ["top-1"] }));
  const services = createApplicationServices(db, userA);
  await services.feedback.save({ outfitId: "outfit-1", reaction: "dislike", reason: "too_formal" });
  const learned = await new StyleProfileLearnerService(services).learn();
  assertEquals(learned.changed, false);
  assertEquals(db.profile()?.style_profile, {});
});

function wardrobeFixture(id: string, category: "top" | "bottom" | "shoes") {
  return {
    id,
    user_id: userA.id,
    name: id,
    description: null,
    category,
    color: null,
    size: null,
    season: null,
    brand: null,
    notes: null,
    image_path: null,
    original_image_path: null,
    processed_image_path: null,
    image_status: "none" as const,
    image_error: null,
    metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    archived_at: null,
  };
}
