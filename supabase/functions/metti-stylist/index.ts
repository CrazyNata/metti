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

const fallbackItemIds = (items: any[]) => {
  const categories = ['outer', 'top', 'bottom', 'shoes', 'accessory'];
  const preferred = categories.map((category) => items.find((item) => item?.category === category));
  return [...new Set([...preferred, ...items]
    .map((item) => String(item?.id ?? ''))
    .filter(Boolean))].slice(0, 4);
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

    const wardrobePage = await services.wardrobe.list({ status: 'active', limit: 100 });
    const wardrobe = wardrobePage.items;
    const profile = await services.profile.get();
    const weather = body?.weather && typeof body.weather === 'object' ? body.weather : { city: profile.city ?? 'Prague', temperature_c: 18, weather_code: 3 };
    const fallbackIds = fallbackItemIds(wardrobe ?? []);
    const localFallback = () => json({
      title: prompt || 'Образ на сегодня',
      note: fallbackIds.length
        ? 'Внешний AI временно недоступен, поэтому я собрала базовый вариант из вашего гардероба.'
        : 'Добавьте несколько вещей в гардероб, чтобы я могла собрать образ.',
      message: fallbackIds.length
        ? 'Я собрала базовый образ из вещей вашего гардероба. Попробуйте ещё раз позже для более точной AI-рекомендации.'
        : 'Добавьте вещи в гардероб — и я соберу для вас образ.',
      item_ids: fallbackIds,
      temperature_c: Number.isFinite(Number(weather.temperature_c)) ? Number(weather.temperature_c) : null,
      weather_code: Number.isFinite(Number(weather.weather_code)) ? Number(weather.weather_code) : null,
      source: 'local-fallback'
    });

    const geminiKey = Deno.env.get('GEMINI_API_KEY');
    const openAiKey = Deno.env.get('OPENAI_API_KEY');
    if (!geminiKey && !openAiKey) return localFallback();
    const instructions = [
      'Ты — персональный AI-стилист приложения metti.',
      'Подбирай образ только из переданных вещей пользователя. Не придумывай вещи и не добавляй предметы, которых нет в списке.',
      'Учитывай запрос, погоду, город и предпочтения профиля. Ответ возвращай строго в JSON без markdown.',
      'Формат: {"title": string, "note": string, "message": string, "item_ids": string[]}. item_ids должен содержать от 1 до 6 id из гардероба.'
    ].join('\n');
    const context = JSON.stringify({ prompt, weather, profile, wardrobe });
    const requestGemini = () => {
      const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.5-flash-lite';
      return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': geminiKey as string, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: instructions }] },
          contents: [{ role: 'user', parts: [{ text: context }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 500 }
        })
      });
    };
    const requestOpenAi = () => {
      if (!openAiKey) throw new Error('OPENAI_API_KEY is not configured');
      const model = Deno.env.get('OPENAI_MODEL') || 'gpt-4.1-mini';
      return fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openAiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, instructions, input: context, temperature: 0.7, max_output_tokens: 500 })
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
      title: String(parsed.title || 'Образ на сегодня').slice(0, 120),
      note: String(parsed.note || 'Собрала этот образ с учётом погоды и вашего гардероба.').slice(0, 500),
      message: String(parsed.message || 'Готово — образ собран из вещей вашего гардероба.').slice(0, 500),
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
