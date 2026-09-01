import { AppError } from '../_shared/errors.ts';
import { authenticateRequest, getSupabaseConfig } from '../_shared/auth.ts';
import { createApplicationServices } from '../_shared/services.ts';
import { SupabaseRestClient } from '../_shared/supabase-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
});

const cleanJson = (value: string) => {
  const cleaned = value.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(cleaned); } catch (_) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(cleaned.slice(start, end + 1)); } catch (_) { /* fall through */ }
    }
    return null;
  }
};

const outputText = (payload: any) => {
  if (typeof payload?.output_text === 'string') return payload.output_text;
  return (payload?.output ?? [])
    .flatMap((item: any) => item?.content ?? [])
    .map((part: any) => part?.text ?? '')
    .filter(Boolean)
    .join('\n');
};

const geminiOutputText = (payload: any) => (payload?.candidates ?? [])
  .flatMap((candidate: any) => candidate?.content?.parts ?? [])
  .map((part: any) => part?.text ?? '')
  .filter(Boolean)
  .join('\n');

const MAX_VISION_ITEMS = 24;
const MAX_GEMINI_IMAGE_BYTES = 900_000;
const MAX_GEMINI_TOTAL_BYTES = 10_000_000;
const VISION_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
};

const fetchWithTimeout = async (url: string, timeoutMs = 4000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const fetchGeminiImage = async (url: unknown) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null;
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) return null;
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > MAX_GEMINI_IMAGE_BYTES) return null;
    const mimeType = String(response.headers.get('content-type') || 'image/jpeg').split(';')[0].trim().toLowerCase();
    if (!VISION_MIME_TYPES.has(mimeType)) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.byteLength > MAX_GEMINI_IMAGE_BYTES) return null;
    return { mimeType, data: bytesToBase64(bytes), byteLength: bytes.byteLength };
  } catch (_) {
    return null;
  }
};

const fallbackItemIds = (items: any[]) => {
  const available = Array.isArray(items) ? items.filter((item) => item?.id) : [];
  const selected: any[] = [];
  const used = new Set<string>();
  const subcategory = (item: any) => String(item?.subcategory || item?.metadata?.subcategory || '').toLowerCase();
  const take = (predicate: (item: any) => boolean) => {
    const item = available.find((value) => !used.has(String(value.id)) && predicate(value));
    if (!item) return;
    used.add(String(item.id)); selected.push(item);
  };
  const hero = available.find((item) => ['outerwear', 'blazer'].includes(subcategory(item)) || item.category === 'outer')
    || available.find((item) => item.category === 'top' && subcategory(item) === 'dress')
    || available.find((item) => item.category === 'top');
  if (hero) {
    used.add(String(hero.id)); selected.push(hero);
    if (subcategory(hero) !== 'dress') take((item) => item.category === 'top' && !['outerwear', 'blazer', 'dress'].includes(subcategory(item)));
  }
  take((item) => item.category === 'bottom');
  take((item) => item.category === 'shoes');
  take((item) => item.category === 'accessory' && subcategory(item) === 'bag');
  take((item) => item.category === 'accessory');
  available.forEach((item) => {
    if (selected.length >= 6 || used.has(String(item.id))) return;
    used.add(String(item.id)); selected.push(item);
  });
  return selected.slice(0, 6).map((item) => String(item.id));
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const authorization = req.headers.get('authorization') ?? '';
  if (!authorization.toLowerCase().startsWith('bearer ')) return json({ error: 'Authentication required' }, 401);

  try {
    const supabaseConfig = getSupabaseConfig();
    const auth = await authenticateRequest(req, supabaseConfig);
    const services = createApplicationServices(new SupabaseRestClient(supabaseConfig, auth.accessToken), auth.user);
    const body = await req.json().catch(() => ({}));
    const prompt = String(body?.prompt ?? '').trim().slice(0, 1000);
    if (!prompt) return json({ error: 'Prompt is required' }, 400);
    const language = body?.language === 'en' ? 'en' : 'ru';
    const isEnglish = language === 'en';

    const wardrobePage = await services.wardrobe.list({ status: 'active', limit: 100 });
    const wardrobe = wardrobePage.items;
    const profile = await services.profile.get();
    const weather = body?.weather && typeof body.weather === 'object' ? body.weather : { city: profile.city ?? 'Prague', temperature_c: 18, weather_code: 3 };
    const fallbackIds = fallbackItemIds(wardrobe ?? []);
    const localFallback = () => json({
      title: prompt || (isEnglish ? "Today's look" : 'Образ на сегодня'),
      note: fallbackIds.length
        ? (isEnglish ? 'The external AI is temporarily unavailable, so I put together a basic look from your wardrobe.' : 'Внешний AI временно недоступен, поэтому я собрала базовый вариант из вашего гардероба.')
        : (isEnglish ? 'Add a few items to your wardrobe so I can put together a look.' : 'Добавьте несколько вещей в гардероб, чтобы я могла собрать образ.'),
      message: fallbackIds.length
        ? (isEnglish ? 'I put together a basic look from your wardrobe. Try again later for a more precise AI recommendation.' : 'Я собрала базовый образ из вещей вашего гардероба. Попробуйте ещё раз позже для более точной AI-рекомендации.')
        : (isEnglish ? 'Add items to your wardrobe and I will put together a look for you.' : 'Добавьте вещи в гардероб — и я соберу для вас образ.'),
      item_ids: fallbackIds,
      temperature_c: Number.isFinite(Number(weather.temperature_c)) ? Number(weather.temperature_c) : null,
      weather_code: Number.isFinite(Number(weather.weather_code)) ? Number(weather.weather_code) : null,
      source: 'local-fallback'
    });

    const geminiKey = Deno.env.get('GEMINI_API_KEY');
    const openAiKey = Deno.env.get('OPENAI_API_KEY');
    if (!geminiKey && !openAiKey) return localFallback();
    const visionItems = (wardrobe ?? [])
      .filter((item: any) => typeof item?.imageUrl === 'string' && /^https?:\/\//i.test(item.imageUrl))
      .slice(0, MAX_VISION_ITEMS);
    const wardrobeContext = (wardrobe ?? []).map((item: any) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      subcategory: item.subcategory,
      colors: item.colors,
      color: item.color,
      size: item.size,
      season: item.season,
      brand: item.brand,
      notes: item.notes,
      image_available: Boolean(item.imageUrl)
    }));
    const instructions = [
      isEnglish ? 'You are the personal AI stylist for the metti app.' : 'Ты — персональный AI-стилист приложения metti.',
      isEnglish ? 'Build a look only from the user’s provided items. Do not invent items or add anything that is not in the list.' : 'Подбирай образ только из переданных вещей пользователя. Не придумывай вещи и не добавляй предметы, которых нет в списке.',
      isEnglish ? 'Inspect the wardrobe photos when they are provided. Each photo is immediately preceded by its exact wardrobe item id; use the photo to verify the garment type, color, pattern, and compatibility. Metadata remains the source of truth for the item id and category.' : 'Изучай фотографии вещей, если они переданы. Перед каждой фотографией указан точный id вещи; используй фото, чтобы проверить тип, цвет, принт и сочетаемость. Метаданные остаются источником истины для id и категории.',
      isEnglish ? 'Consider the request, weather, city, and profile preferences. Return the response strictly as JSON without markdown. Write all user-facing text in English.' : 'Учитывай запрос, погоду, город и предпочтения профиля. Ответ возвращай строго в JSON без markdown. Все пользовательские тексты пиши на русском языке.',
      isEnglish ? 'Format: {"title": string, "note": string, "message": string, "item_ids": string[]}. item_ids must contain 1 to 6 wardrobe item ids.' : 'Формат: {"title": string, "note": string, "message": string, "item_ids": string[]}. item_ids должен содержать от 1 до 6 id из гардероба.'
    ].join('\n');
    const context = JSON.stringify({ prompt, language, weather, profile, wardrobe: wardrobeContext, visual_items: visionItems.map((item: any) => ({ id: item.id, name: item.name })) });
    const buildGeminiImageParts = async () => {
      const parts: any[] = [];
      let totalBytes = 0;
      for (const item of visionItems) {
        if (totalBytes >= MAX_GEMINI_TOTAL_BYTES) break;
        const image = await fetchGeminiImage(item.imageUrl);
        if (!image || totalBytes + image.byteLength > MAX_GEMINI_TOTAL_BYTES) continue;
        totalBytes += image.byteLength;
        parts.push(
          { text: `WARDROBE PHOTO ${item.id}: the next image is the actual photo of "${item.name}". Use this exact id when selecting it.` },
          { inlineData: { mimeType: image.mimeType, data: image.data } },
        );
      }
      return parts;
    };
    const requestGemini = async () => {
      const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.5-flash-lite';
      return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': geminiKey as string, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: instructions }] },
          contents: [{ role: 'user', parts: [{ text: context }, ...(await buildGeminiImageParts())] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 500 }
        })
      });
    };
    const requestOpenAi = () => {
      if (!openAiKey) throw new Error('OPENAI_API_KEY is not configured');
      const model = Deno.env.get('OPENAI_MODEL') || 'gpt-4.1-mini';
      const content = [
        { type: 'input_text', text: context },
        ...visionItems.flatMap((item: any) => [
          { type: 'input_text', text: `WARDROBE PHOTO ${item.id}: the next image is the actual photo of "${item.name}". Use this exact id when selecting it.` },
          { type: 'input_image', image_url: item.imageUrl, detail: 'auto' }
        ])
      ];
      return fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openAiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, instructions, input: [{ role: 'user', content }], temperature: 0.7, max_output_tokens: 500 })
      });
    };
    const requestOpenAiSafely = async () => {
      try {
        return await requestOpenAi();
      } catch (error) {
        console.error('openai request errored', error instanceof Error ? error.message : error);
        return null;
      }
    };

    let provider = 'openai';
    let aiResponse: Response;
    if (geminiKey) {
      provider = 'gemini';
      try {
        aiResponse = await requestGemini();
      } catch (error) {
        if (!openAiKey) throw error;
        console.warn('gemini request errored; falling back to openai', error instanceof Error ? error.message : error);
        provider = 'openai';
        const openAiResponse = await requestOpenAiSafely();
        if (!openAiResponse) return localFallback();
        aiResponse = openAiResponse;
      }
      if (!aiResponse.ok && openAiKey) {
        const geminiPayload = await aiResponse.clone().json().catch(() => ({}));
        console.warn(
          'gemini request failed; falling back to openai',
          aiResponse.status,
          geminiPayload?.error?.message || geminiPayload?.error?.status || 'unknown error'
        );
        provider = 'openai';
        const openAiResponse = await requestOpenAiSafely();
        if (!openAiResponse) return localFallback();
        aiResponse = openAiResponse;
      }
    } else {
      const openAiResponse = await requestOpenAiSafely();
      if (!openAiResponse) return localFallback();
      aiResponse = openAiResponse;
    }
    const aiPayload = await aiResponse.json().catch(() => ({}));
    if (!aiResponse.ok) {
      console.error(`${provider} request failed`, aiResponse.status, aiPayload?.error?.message || aiPayload?.error?.status || 'unknown error');
      if ([402, 429, 500, 502, 503, 529].includes(aiResponse.status)) return localFallback();
      return json({ error: 'AI provider request failed' }, 502);
    }
    const parsed = cleanJson(provider === 'gemini' ? geminiOutputText(aiPayload) : outputText(aiPayload)) ?? {};
    const validIds = new Set((wardrobe ?? []).map((item: any) => String(item.id)));
    const itemIds = Array.isArray(parsed.item_ids) ? parsed.item_ids.map((id: unknown) => String(id)).filter((id: string) => validIds.has(id)).slice(0, 6) : [];
    return json({
      title: String(parsed.title || (isEnglish ? "Today's look" : 'Образ на сегодня')).slice(0, 120),
      note: String(parsed.note || (isEnglish ? 'I put together this look with the weather and your wardrobe in mind.' : 'Собрала этот образ с учётом погоды и вашего гардероба.')).slice(0, 500),
      message: String(parsed.message || (isEnglish ? 'Done — the look is built from your wardrobe.' : 'Готово — образ собран из вещей вашего гардероба.')).slice(0, 500),
      item_ids: itemIds.length ? itemIds : fallbackIds,
      temperature_c: Number.isFinite(Number(weather.temperature_c)) ? Number(weather.temperature_c) : null,
      weather_code: Number.isFinite(Number(weather.weather_code)) ? Number(weather.weather_code) : null
    });
  } catch (error) {
    console.error('metti-stylist error', error);
    if (error instanceof AppError) return json({ error: error.message }, error.status);
    return json({ error: 'Stylist request failed' }, 500);
  }
});
