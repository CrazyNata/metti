import { AppError } from "../_shared/errors.ts";
import { authenticateRequest, getSupabaseConfig } from "../_shared/auth.ts";
import { createApplicationServices } from "../_shared/services.ts";
import { SupabaseRestClient } from "../_shared/supabase-client.ts";
import { createStylistLLM } from "../_shared/stylist/llm.ts";
import { PurchaseAdvisorService } from "../_shared/stylist/purchase-advisor.ts";
import { StyleProfileLearnerService } from "../_shared/stylist/profile-learner.ts";
import { StylistService } from "../_shared/stylist/service.ts";
import { WardrobeAuditService } from "../_shared/stylist/wardrobe-auditor.ts";
import type { OutfitFeedbackReason } from "../_shared/types.ts";
import type {
  OutfitCreativity,
  StylistContext,
  StylistMode,
} from "../_shared/stylist/types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const MODES = new Set<StylistMode>([
  "today",
  "selected_item",
  "restyle",
  "packing",
  "shopping_recommendation",
]);

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringList(value: unknown, max = 20): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max))];
}

function modeValue(value: unknown): StylistMode {
  const mode = typeof value === "string" ? value : "today";
  if (MODES.has(mode as StylistMode)) return mode as StylistMode;
  throw new AppError("invalid_input", "mode is invalid.");
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function textValue(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function scalarValue(...values: unknown[]): number | string | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function creativityValue(value: unknown): OutfitCreativity | undefined {
  return value === "safe" || value === "balanced" || value === "bold"
    ? value
    : undefined;
}

function requestContext(body: Record<string, unknown>): StylistContext {
  const context = object(body.context);
  const weather = object(body.weather);
  return {
    ...context,
    location: textValue(context.location, weather.location, weather.city),
    temperature: numberValue(context.temperature ?? weather.temperature ?? weather.temperature_c),
    feelsLike: numberValue(context.feelsLike ?? weather.feelsLike ?? weather.feels_like),
    weather: textValue(context.weather, weather.weather, weather.description),
    weatherCode: numberValue(context.weatherCode ?? weather.weatherCode ?? weather.weather_code),
    precipitation: scalarValue(context.precipitation, weather.precipitation, weather.precipitation_mm),
    wind: scalarValue(context.wind, weather.wind, weather.wind_kph),
    occasion: textValue(context.occasion, body.occasion),
  };
}

function legacyResponse(
  result: Awaited<ReturnType<StylistService["generate"]>>,
  language: "ru" | "en",
  context: StylistContext,
  prompt: string,
): Record<string, unknown> {
  const first = result.outfits[0];
  const noResult = language === "en"
    ? "I couldn't find a strong combination for these conditions in your wardrobe."
    : "В этих условиях не получилось собрать хороший вариант из вашего гардероба.";
  return {
    ...result,
    title: first?.name ?? (language === "en" ? "No suitable outfit" : "Подходящий образ не найден"),
    note: first?.explanation ?? noResult,
    message: first
      ? (language === "en" ? "Done — the outfit uses only your wardrobe items." : "Готово — образ собран только из вещей вашего гардероба.")
      : noResult,
    item_ids: first?.itemIds ?? [],
    prompt,
    temperature_c: numberValue(context.temperature),
    weather_code: numberValue(context.weatherCode),
    outfits: result.outfits.map((outfit) => ({
      ...outfit,
      item_ids: outfit.itemIds,
    })),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return json({ error: "Authentication required" }, 401);
  }

  try {
    const supabaseConfig = getSupabaseConfig();
    const auth = await authenticateRequest(req, supabaseConfig);
    const services = createApplicationServices(
      new SupabaseRestClient(supabaseConfig, auth.accessToken),
      auth.user,
    );
    const body = object(await req.json().catch(() => ({})));
    const action = typeof body.action === "string" ? body.action : "generate";
    const language = body.language === "en" ? "en" : "ru";

    if (action === "feedback") {
      const feedback = await services.feedback.save({
        outfitId: String(body.outfitId ?? ""),
        reaction: body.reaction as "like" | "dislike",
        reason: body.reason as OutfitFeedbackReason | null | undefined,
        comment: typeof body.comment === "string" ? body.comment.trim().slice(0, 1000) : null,
      });
      return json({ feedback });
    }
    if (action === "analyze_wardrobe") {
      return json(await new WardrobeAuditService(services).analyze(language));
    }
    if (action === "analyze_purchase") {
      const candidate = object(body.candidate);
      const analysis = await new PurchaseAdvisorService(
        services,
        createStylistLLM(),
      ).analyze({
        candidate: candidate as Parameters<PurchaseAdvisorService["analyze"]>[0]["candidate"],
        context: requestContext(body),
        language,
      });
      return json(analysis);
    }
    if (action === "learn_profile" || action === "learn_style_profile") {
      return json(await new StyleProfileLearnerService(
        services,
        createStylistLLM(),
      ).learn(language));
    }
    if (action !== "generate") {
      return json({ error: "action is invalid" }, 400);
    }

    const mode = modeValue(body.mode);
    const prompt = String(body.prompt ?? "").trim().slice(0, 1000);
    const context = requestContext(body);
    const service = new StylistService(services, createStylistLLM());
    const result = await service.generate({
      mode,
      prompt,
      count: body.count as number | undefined,
      selectedItemId: typeof body.selectedItemId === "string" ? body.selectedItemId.trim() : undefined,
      currentItemIds: stringList(body.currentItemIds),
      lockedItemIds: stringList(body.lockedItemIds),
      instruction: typeof body.instruction === "string" ? body.instruction.trim().slice(0, 1000) : undefined,
      preferredCreativity: creativityValue(body.preferredCreativity),
      context,
      language,
    });
    return json(legacyResponse(result, language, context, prompt));
  } catch (error) {
    console.error("metti-stylist error", error instanceof Error ? error.message : error);
    if (error instanceof AppError) return json({ error: error.message, code: error.code }, error.status);
    return json({ error: "Stylist request failed" }, 500);
  }
});
