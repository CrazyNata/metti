export type PromptSchema = Record<string, unknown>;

const outfitProperties: PromptSchema = {
  name: { type: "string" },
  itemIds: { type: "array", items: { type: "string" } },
  creativity: { type: "string", enum: ["safe", "balanced", "bold"] },
  style: { type: "array", items: { type: "string" } },
  occasion: { type: "array", items: { type: "string" } },
  score: { type: "number" },
  explanation: { type: "string" },
  warnings: { type: "array", items: { type: "string" } },
};

const outfitRequired = [
  "name",
  "itemIds",
  "creativity",
  "style",
  "occasion",
  "score",
  "explanation",
  "warnings",
];

export const STYLIST_OUTPUT_SCHEMA: PromptSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    outfits: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: outfitProperties,
        required: outfitRequired,
      },
    },
    reason: { type: "string" },
    capsuleItemIds: { type: "array", items: { type: "string" } },
    missingPieces: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          category: { type: "string" },
          preferredColors: { type: "array", items: { type: "string" } },
          priority: { type: "number" },
          reason: { type: "string" },
        },
        required: ["category", "preferredColors", "priority", "reason"],
      },
    },
  },
  required: ["outfits", "reason", "capsuleItemIds", "missingPieces"],
};

export const CRITIC_OUTPUT_SCHEMA: PromptSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          outfitIndex: { type: "integer" },
          criticScore: { type: "number" },
          issues: { type: "array", items: { type: "string" } },
        },
        required: ["outfitIndex", "criticScore", "issues"],
      },
    },
  },
  required: ["results"],
};

export const ITEM_ENRICHMENT_SCHEMA: PromptSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    category: { type: ["string", "null"] },
    subcategory: { type: ["string", "null"] },
    colors: { type: "array", items: { type: "string" } },
    pattern: { type: ["string", "null"] },
    material: { type: ["string", "null"] },
    styles: { type: "array", items: { type: "string" } },
    occasions: { type: "array", items: { type: "string" } },
    formality: { type: ["number", "null"] },
    fit: { type: ["string", "null"] },
    silhouette: { type: ["string", "null"] },
    length: { type: ["string", "null"] },
    warmth: { type: ["number", "null"] },
    statementLevel: { type: ["number", "null"] },
  },
  required: [
    "category",
    "subcategory",
    "colors",
    "pattern",
    "material",
    "styles",
    "occasions",
    "formality",
    "fit",
    "silhouette",
    "length",
    "warmth",
    "statementLevel",
  ],
};

export const GEMINI_ITEM_ENRICHMENT_SCHEMA: PromptSchema = {
  type: "OBJECT",
  properties: {
    category: { type: "STRING", nullable: true },
    subcategory: { type: "STRING", nullable: true },
    colors: { type: "ARRAY", items: { type: "STRING" } },
    pattern: { type: "STRING", nullable: true },
    material: { type: "STRING", nullable: true },
    styles: { type: "ARRAY", items: { type: "STRING" } },
    occasions: { type: "ARRAY", items: { type: "STRING" } },
    formality: { type: "NUMBER", nullable: true },
    fit: { type: "STRING", nullable: true },
    silhouette: { type: "STRING", nullable: true },
    length: { type: "STRING", nullable: true },
    warmth: { type: "NUMBER", nullable: true },
    statementLevel: { type: "NUMBER", nullable: true },
  },
  required: [
    "category",
    "subcategory",
    "colors",
    "pattern",
    "material",
    "styles",
    "occasions",
    "formality",
    "fit",
    "silhouette",
    "length",
    "warmth",
    "statementLevel",
  ],
};

const learnedPreferenceProperties: PromptSchema = {
  preference: { type: "string" },
  confidence: { type: "number" },
};

const learnedPreferenceRequired = ["preference", "confidence"];

export const LEARNER_OUTPUT_SCHEMA: PromptSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    add: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: learnedPreferenceProperties,
        required: learnedPreferenceRequired,
      },
    },
    remove: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: learnedPreferenceProperties,
        required: learnedPreferenceRequired,
      },
    },
    update: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: learnedPreferenceProperties,
        required: learnedPreferenceRequired,
      },
    },
  },
  required: ["add", "remove", "update"],
};

export const GEMINI_LEARNER_OUTPUT_SCHEMA: PromptSchema = {
  type: "OBJECT",
  properties: {
    add: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          preference: { type: "STRING" },
          confidence: { type: "NUMBER" },
        },
        required: learnedPreferenceRequired,
      },
    },
    remove: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          preference: { type: "STRING" },
          confidence: { type: "NUMBER" },
        },
        required: learnedPreferenceRequired,
      },
    },
    update: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          preference: { type: "STRING" },
          confidence: { type: "NUMBER" },
        },
        required: learnedPreferenceRequired,
      },
    },
  },
  required: ["add", "remove", "update"],
};

/** Gemini's REST schema uses upper-case type names. */
export const GEMINI_STYLIST_OUTPUT_SCHEMA: PromptSchema = {
  type: "OBJECT",
  properties: {
    outfits: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          itemIds: { type: "ARRAY", items: { type: "STRING" } },
          creativity: { type: "STRING", enum: ["safe", "balanced", "bold"] },
          style: { type: "ARRAY", items: { type: "STRING" } },
          occasion: { type: "ARRAY", items: { type: "STRING" } },
          score: { type: "NUMBER" },
          explanation: { type: "STRING" },
          warnings: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: outfitRequired,
      },
    },
    reason: { type: "STRING" },
    capsuleItemIds: { type: "ARRAY", items: { type: "STRING" } },
    missingPieces: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          category: { type: "STRING" },
          preferredColors: { type: "ARRAY", items: { type: "STRING" } },
          priority: { type: "NUMBER" },
          reason: { type: "STRING" },
        },
        required: ["category", "preferredColors", "priority", "reason"],
      },
    },
  },
  required: ["outfits", "reason", "capsuleItemIds", "missingPieces"],
};

export const GEMINI_CRITIC_OUTPUT_SCHEMA: PromptSchema = {
  type: "OBJECT",
  properties: {
    results: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          outfitIndex: { type: "INTEGER" },
          criticScore: { type: "NUMBER" },
          issues: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["outfitIndex", "criticScore", "issues"],
      },
    },
  },
  required: ["results"],
};

export const PURCHASE_ADVICE_SCHEMA: PromptSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    decision: { type: "string", enum: ["buy", "only_if", "skip"] },
    compatibilityScore: { type: "number" },
    matchingItemIds: { type: "array", items: { type: "string" } },
    estimatedOutfitPotential: { type: "number" },
    fillsWardrobeGap: { type: "boolean" },
    duplicateRisk: { type: "boolean" },
    reason: { type: "string" },
  },
  required: [
    "decision",
    "compatibilityScore",
    "matchingItemIds",
    "estimatedOutfitPotential",
    "fillsWardrobeGap",
    "duplicateRisk",
    "reason",
  ],
};

export const GEMINI_PURCHASE_ADVICE_SCHEMA: PromptSchema = {
  type: "OBJECT",
  properties: {
    decision: { type: "STRING", enum: ["buy", "only_if", "skip"] },
    compatibilityScore: { type: "NUMBER" },
    matchingItemIds: { type: "ARRAY", items: { type: "STRING" } },
    estimatedOutfitPotential: { type: "NUMBER" },
    fillsWardrobeGap: { type: "BOOLEAN" },
    duplicateRisk: { type: "BOOLEAN" },
    reason: { type: "STRING" },
  },
  required: [
    "decision",
    "compatibilityScore",
    "matchingItemIds",
    "estimatedOutfitPotential",
    "fillsWardrobeGap",
    "duplicateRisk",
    "reason",
  ],
};
