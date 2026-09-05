import type { WardrobeItemDto } from "../types.ts";
import {
  buildStylistUserPrompt,
  CRITIC_OUTPUT_SCHEMA,
  GEMINI_CRITIC_OUTPUT_SCHEMA,
  GEMINI_ITEM_ENRICHMENT_SCHEMA,
  GEMINI_LEARNER_OUTPUT_SCHEMA,
  GEMINI_PURCHASE_ADVICE_SCHEMA,
  GEMINI_STYLIST_OUTPUT_SCHEMA,
  ITEM_ENRICHMENT_PROMPT_VERSION,
  ITEM_ENRICHMENT_SCHEMA,
  ITEM_ENRICHMENT_SYSTEM_PROMPT,
  buildRoleSkillPrompt,
  buildStylistRepairPrompt,
  buildStylistSkillPrompt,
  LEARNER_OUTPUT_SCHEMA,
  METTI_STYLIST_PROMPT_VERSION,
  METTI_STYLIST_SYSTEM_PROMPT,
  OUTFIT_CRITIC_PROMPT_VERSION,
  OUTFIT_CRITIC_SYSTEM_PROMPT,
  PURCHASE_ADVISOR_PROMPT_VERSION,
  PURCHASE_ADVISOR_SYSTEM_PROMPT,
  PURCHASE_ADVICE_SCHEMA,
  STYLE_PROFILE_LEARNER_PROMPT_VERSION,
  STYLE_PROFILE_LEARNER_SYSTEM_PROMPT,
  STYLIST_OUTPUT_SCHEMA,
} from "./prompts/index.ts";
import type { PromptSchema } from "./prompts/schemas.ts";
import type { PurchaseAnalysisInput } from "./purchase-advisor.ts";
import type {
  CritiqueInput,
  GenerateOutfitsInput,
  StyleProfileLearningInput,
  StylistRepairInput,
  StylistLLM,
} from "./types.ts";

const MAX_VISION_ITEMS = 24;
const MAX_GEMINI_IMAGE_BYTES = 900_000;
const MAX_GEMINI_TOTAL_BYTES = 10_000_000;
const VISION_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type EnvReader = { get(name: string): string | undefined };

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)),
    );
  }
  return btoa(binary);
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = 25_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function imageAsInlineData(url: string): Promise<{
  mimeType: string;
  data: string;
  byteLength: number;
} | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const response = await fetchWithTimeout(url, {}, 4_000);
    if (!response.ok) return null;
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_GEMINI_IMAGE_BYTES) return null;
    const mimeType = String(
      response.headers.get("content-type") || "image/jpeg",
    ).split(";")[0].trim().toLowerCase();
    if (!VISION_MIME_TYPES.has(mimeType)) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.byteLength > MAX_GEMINI_IMAGE_BYTES) return null;
    return { mimeType, data: bytesToBase64(bytes), byteLength: bytes.byteLength };
  } catch (_) {
    return null;
  }
}

function outputText(payload: unknown): string {
  const value = payload as Record<string, unknown>;
  if (typeof value.output_text === "string") return value.output_text;
  const output = Array.isArray(value.output) ? value.output : [];
  return output
    .flatMap((item) => {
      const content = item && typeof item === "object" && !Array.isArray(item)
        ? (item as Record<string, unknown>).content
        : [];
      return Array.isArray(content) ? content : [];
    })
    .map((part) => part && typeof part === "object" && !Array.isArray(part)
      ? (part as Record<string, unknown>).text
      : "")
    .filter((text): text is string => typeof text === "string" && Boolean(text))
    .join("\n");
}

function geminiOutputText(payload: unknown): string {
  const value = payload as Record<string, unknown>;
  const candidates = Array.isArray(value.candidates) ? value.candidates : [];
  return candidates
    .flatMap((candidate) => {
      const content = candidate && typeof candidate === "object" && !Array.isArray(candidate)
        ? (candidate as Record<string, unknown>).content
        : null;
      const parts = content && typeof content === "object" && !Array.isArray(content)
        ? (content as Record<string, unknown>).parts
        : [];
      return Array.isArray(parts) ? parts : [];
    })
    .map((part) => part && typeof part === "object" && !Array.isArray(part)
      ? (part as Record<string, unknown>).text
      : "")
    .filter((text): text is string => typeof text === "string" && Boolean(text))
    .join("\n");
}

function parseJson(value: string): unknown {
  const cleaned = value.trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch (_) {
        // The caller receives a provider error and can use another provider.
      }
    }
  }
  throw new Error("AI returned invalid structured output");
}

function responseError(response: Response, payload: unknown): Error {
  const value = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  const error = value.error && typeof value.error === "object" && !Array.isArray(value.error)
    ? value.error as Record<string, unknown>
    : {};
  return new Error(
    `${response.status}: ${String(error.message ?? error.status ?? "provider request failed")}`,
  );
}

function promptItems(items: GenerateOutfitsInput["availableItems"]): GenerateOutfitsInput["availableItems"] {
  return items.map((item) => ({ ...item, imageUrl: item.imageUrl ? item.imageUrl : null }));
}

function openAiInputText(input: GenerateOutfitsInput): string {
  return JSON.stringify({
    mode: input.mode,
    prompt: input.prompt,
    count: input.count,
    selectedItemId: input.selectedItemId ?? null,
    currentItemIds: input.currentItemIds,
    lockedItemIds: input.lockedItemIds,
    instruction: input.instruction ?? null,
    context: input.context,
    styleProfile: input.styleProfile,
    availableItems: promptItems(input.availableItems),
  });
}

function openAiCriticInput(input: CritiqueInput): string {
  return JSON.stringify({
    context: input.context,
    styleProfile: input.styleProfile,
    outfits: input.outfits,
    availableItems: promptItems(input.availableItems),
  });
}

export class RemoteStylistLLM implements StylistLLM {
  private activeProvider: string;

  constructor(
    private readonly geminiKey: string | null,
    private readonly openAiKey: string | null,
    private readonly geminiModel: string,
    private readonly openAiModel: string,
  ) {
    this.activeProvider = geminiKey ? "gemini" : "openai";
  }

  get provider(): string {
    return this.activeProvider;
  }

  private async requestOpenAi(
    instructions: string,
    input: Array<Record<string, unknown>>,
    schemaName: string,
    schema: PromptSchema,
    maxOutputTokens: number,
  ): Promise<unknown> {
    if (!this.openAiKey) throw new Error("OPENAI_API_KEY is not configured");
    const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.openAiModel,
        instructions,
        input: [{ role: "user", content: input }],
        max_output_tokens: maxOutputTokens,
        store: false,
        prompt_cache_key: `metti-stylist-${METTI_STYLIST_PROMPT_VERSION}`,
        text: {
          format: {
            type: "json_schema",
            name: schemaName,
            strict: true,
            schema,
          },
        },
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw responseError(response, payload);
    const text = outputText(payload);
    if (!text) throw new Error("AI returned an empty response");
    return parseJson(text);
  }

  private async requestGemini(
    instructions: string,
    parts: Array<Record<string, unknown>>,
    schema: PromptSchema,
    maxOutputTokens: number,
  ): Promise<unknown> {
    if (!this.geminiKey) throw new Error("GEMINI_API_KEY is not configured");
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.geminiModel)}:generateContent`;
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "x-goog-api-key": this.geminiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: instructions }] },
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: schema,
          maxOutputTokens,
          temperature: 0.6,
        },
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw responseError(response, payload);
    const text = geminiOutputText(payload);
    if (!text) throw new Error("AI returned an empty response");
    return parseJson(text);
  }

  private async withProviderFallback(
    openAi: () => Promise<unknown>,
    gemini: () => Promise<unknown>,
  ): Promise<unknown> {
    const attempts: Array<[string, () => Promise<unknown>]> = [];
    if (this.geminiKey) attempts.push(["gemini", gemini]);
    if (this.openAiKey) attempts.push(["openai", openAi]);
    let lastError: unknown = new Error("No AI provider configured");
    for (const [name, call] of attempts) {
      try {
        const result = await call();
        this.activeProvider = name;
        return result;
      } catch (error) {
        lastError = error;
        console.warn(`stylist ${name} request failed`, error instanceof Error ? error.message : error);
      }
    }
    throw lastError;
  }

  private async visionParts(
    items: GenerateOutfitsInput["availableItems"],
  ): Promise<Array<Record<string, unknown>>> {
    const parts: Array<Record<string, unknown>> = [];
    let totalBytes = 0;
    for (const item of items.slice(0, MAX_VISION_ITEMS)) {
      if (!item.imageUrl || totalBytes >= MAX_GEMINI_TOTAL_BYTES) continue;
      const image = await imageAsInlineData(item.imageUrl);
      if (!image || totalBytes + image.byteLength > MAX_GEMINI_TOTAL_BYTES) continue;
      totalBytes += image.byteLength;
      parts.push({
        text: `WARDROBE PHOTO ${item.itemId}: the next image is the actual photo of this wardrobe item. Use this exact itemId when selecting it.`,
      });
      parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
    }
    return parts;
  }

  async generateOutfits(input: GenerateOutfitsInput): Promise<unknown> {
    const instructions = `${METTI_STYLIST_SYSTEM_PROMPT}\n\n${buildStylistSkillPrompt(input.mode)}\n\nlanguage: ${input.context.language ?? "ru"}`;
    const userPrompt = buildStylistUserPrompt(input);
    const openAiContent: Array<Record<string, unknown>> = [
      { type: "input_text", text: userPrompt },
      ...input.availableItems.slice(0, MAX_VISION_ITEMS).flatMap((item) =>
        item.imageUrl
          ? [
            { type: "input_text", text: `WARDROBE PHOTO ${item.itemId}: the next image is the actual photo of this wardrobe item. Use this exact itemId when selecting it.` },
            { type: "input_image", image_url: item.imageUrl, detail: "auto" },
          ]
          : []
      ),
    ];
    const geminiContent = [
      { text: userPrompt },
      ...(await this.visionParts(input.availableItems)),
    ];
    return this.withProviderFallback(
      () => this.requestOpenAi(
        instructions,
        openAiContent,
        "metti_outfit_suggestions",
        STYLIST_OUTPUT_SCHEMA,
        2400,
      ),
      () => this.requestGemini(
        instructions,
        geminiContent,
        GEMINI_STYLIST_OUTPUT_SCHEMA,
        2400,
      ),
    );
  }

  async repairOutfits(input: StylistRepairInput): Promise<unknown> {
    const instructions = `${METTI_STYLIST_SYSTEM_PROMPT}\n\n${buildStylistSkillPrompt(input.generation.mode)}\n\n# Corrective validation pass\nИсправь предыдущий ответ ровно за одну попытку.\n\npromptVersion: ${METTI_STYLIST_PROMPT_VERSION}`;
    const userPrompt = buildStylistRepairPrompt(input);
    const openAiContent: Array<Record<string, unknown>> = [
      { type: "input_text", text: userPrompt },
      ...input.generation.availableItems.slice(0, MAX_VISION_ITEMS).flatMap((item) =>
        item.imageUrl
          ? [
            { type: "input_text", text: `WARDROBE PHOTO ${item.itemId}: the next image is the actual photo of this wardrobe item. Use this exact itemId when selecting it.` },
            { type: "input_image", image_url: item.imageUrl, detail: "auto" },
          ]
          : []
      ),
    ];
    const geminiContent = [
      { text: userPrompt },
      ...(await this.visionParts(input.generation.availableItems)),
    ];
    return this.withProviderFallback(
      () => this.requestOpenAi(
        instructions,
        openAiContent,
        "metti_outfit_suggestions_repair",
        STYLIST_OUTPUT_SCHEMA,
        2400,
      ),
      () => this.requestGemini(
        instructions,
        geminiContent,
        GEMINI_STYLIST_OUTPUT_SCHEMA,
        2400,
      ),
    );
  }

  async critiqueOutfits(input: CritiqueInput): Promise<unknown> {
    const instructions = `${OUTFIT_CRITIC_SYSTEM_PROMPT}\n\n${buildRoleSkillPrompt("critic")}\n\npromptVersion: ${OUTFIT_CRITIC_PROMPT_VERSION}`;
    const userPrompt = openAiCriticInput(input);
    const openAiContent: Array<Record<string, unknown>> = [
      { type: "input_text", text: userPrompt },
      ...input.availableItems.slice(0, MAX_VISION_ITEMS).flatMap((item) =>
        item.imageUrl
          ? [
            { type: "input_text", text: `WARDROBE PHOTO ${item.itemId}: the next image is the actual photo of this wardrobe item.` },
            { type: "input_image", image_url: item.imageUrl, detail: "auto" },
          ]
          : []
      ),
    ];
    const geminiContent = [
      { text: userPrompt },
      ...(await this.visionParts(input.availableItems)),
    ];
    return this.withProviderFallback(
      () => this.requestOpenAi(
        instructions,
        openAiContent,
        "metti_outfit_critic",
        CRITIC_OUTPUT_SCHEMA,
        1400,
      ),
      () => this.requestGemini(
        instructions,
        geminiContent,
        GEMINI_CRITIC_OUTPUT_SCHEMA,
        1400,
      ),
    );
  }

  async analyzePurchase(input: PurchaseAnalysisInput): Promise<unknown> {
    const imageDataUrl = input.candidate.imageDataUrl ?? null;
    const { imageDataUrl: _image, ...candidate } = input.candidate;
    const inputText = JSON.stringify({
      promptVersion: PURCHASE_ADVISOR_PROMPT_VERSION,
      candidate,
      compatibility: input.compatibility,
      context: input.context ?? {},
      availableItems: promptItems(input.availableItems),
    });
    const openAiContent: Array<Record<string, unknown>> = [
      { type: "input_text", text: inputText },
    ];
    if (imageDataUrl) {
      openAiContent.push({
        type: "input_text",
        text: "PURCHASE PHOTO: inspect this potential purchase.",
      }, {
        type: "input_image",
        image_url: imageDataUrl,
        detail: "auto",
      });
    }
    const geminiContent: Array<Record<string, unknown>> = [{ text: inputText }];
    const imageMatch = imageDataUrl?.match(/^data:([^;,]+);base64,(.+)$/s);
    if (imageMatch) {
      geminiContent.push({ text: "PURCHASE PHOTO: inspect this potential purchase." });
      geminiContent.push({
        inlineData: { mimeType: imageMatch[1], data: imageMatch[2] },
      });
    }
    const instructions = `${PURCHASE_ADVISOR_SYSTEM_PROMPT}\n\npromptVersion: ${PURCHASE_ADVISOR_PROMPT_VERSION}`;
    return this.withProviderFallback(
      () => this.requestOpenAi(
        instructions,
        openAiContent,
        "metti_purchase_advice",
        PURCHASE_ADVICE_SCHEMA,
        1200,
      ),
      () => this.requestGemini(
        instructions,
        geminiContent,
        GEMINI_PURCHASE_ADVICE_SCHEMA,
        1200,
      ),
    );
  }

  async enrichItem(item: WardrobeItemDto): Promise<unknown> {
    const inputText = JSON.stringify({
      promptVersion: ITEM_ENRICHMENT_PROMPT_VERSION,
      item: {
        id: item.id,
        name: item.name,
        description: item.description,
        category: item.category,
        color: item.color,
        season: item.season,
        brand: item.brand,
        notes: item.notes,
      },
    });
    const openAiContent: Array<Record<string, unknown>> = [{ type: "input_text", text: inputText }];
    if (item.imageUrl) {
      openAiContent.push(
        { type: "input_text", text: `WARDROBE PHOTO ${item.id}: inspect this actual item photo.` },
        { type: "input_image", image_url: item.imageUrl, detail: "auto" },
      );
    }
    const geminiContent: Array<Record<string, unknown>> = [{ text: inputText }];
    if (item.imageUrl) {
      const image = await imageAsInlineData(item.imageUrl);
      if (image) {
        geminiContent.push({ text: `WARDROBE PHOTO ${item.id}: inspect this actual item photo.` });
        geminiContent.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
      }
    }
    return this.withProviderFallback(
      () => this.requestOpenAi(
        `${ITEM_ENRICHMENT_SYSTEM_PROMPT}\n\n${buildRoleSkillPrompt("enrichment")}`,
        openAiContent,
        "metti_item_enrichment",
        ITEM_ENRICHMENT_SCHEMA,
        1000,
      ),
      () => this.requestGemini(
        `${ITEM_ENRICHMENT_SYSTEM_PROMPT}\n\n${buildRoleSkillPrompt("enrichment")}`,
        geminiContent,
        GEMINI_ITEM_ENRICHMENT_SCHEMA,
        1000,
      ),
    );
  }

  async updateStyleProfile(input: StyleProfileLearningInput): Promise<unknown> {
    const inputText = JSON.stringify({
      promptVersion: STYLE_PROFILE_LEARNER_PROMPT_VERSION,
      explicitProfile: input.styleProfile.explicit,
      styleProfile: input.styleProfile,
      feedback: input.feedback,
      savedOutfits: input.savedOutfits,
      wearHistory: input.wearHistory,
    });
    const openAiContent: Array<Record<string, unknown>> = [{ type: "input_text", text: inputText }];
    const geminiContent: Array<Record<string, unknown>> = [{ text: inputText }];
    return this.withProviderFallback(
      () => this.requestOpenAi(
        `${STYLE_PROFILE_LEARNER_SYSTEM_PROMPT}\n\n${buildRoleSkillPrompt("learner")}`,
        openAiContent,
        "metti_style_profile_learner",
        LEARNER_OUTPUT_SCHEMA,
        1000,
      ),
      () => this.requestGemini(
        `${STYLE_PROFILE_LEARNER_SYSTEM_PROMPT}\n\n${buildRoleSkillPrompt("learner")}`,
        geminiContent,
        GEMINI_LEARNER_OUTPUT_SCHEMA,
        1000,
      ),
    );
  }
}

export function createStylistLLM(
  env: EnvReader = Deno.env,
): StylistLLM | null {
  const geminiKey = String(env.get("GEMINI_API_KEY") ?? "").trim() || null;
  const openAiKey = String(env.get("OPENAI_API_KEY") ?? "").trim() || null;
  if (!geminiKey && !openAiKey) return null;
  return new RemoteStylistLLM(
    geminiKey,
    openAiKey,
    String(env.get("GEMINI_MODEL") ?? "gemini-3.5-flash-lite"),
    String(env.get("OPENAI_MODEL") ?? "gpt-4.1-mini"),
  );
}
