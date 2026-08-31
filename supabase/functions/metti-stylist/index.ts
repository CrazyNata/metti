const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
});

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY') ?? (() => {
  try { return JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}').default ?? ''; } catch (_) { return ''; }
})();

const authHeaders = (authorization: string) => ({
  apikey: supabaseKey,
  authorization,
  'Content-Type': 'application/json'
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const authorization = req.headers.get('authorization') ?? '';
  if (!authorization.toLowerCase().startsWith('bearer ')) return json({ error: 'Authentication required' }, 401);
  if (!supabaseUrl || !supabaseKey) return json({ error: 'Supabase environment is not configured' }, 500);

  try {
    const body = await req.json().catch(() => ({}));
    const prompt = String(body?.prompt ?? '').trim().slice(0, 1000);
    if (!prompt) return json({ error: 'Prompt is required' }, 400);

    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: authHeaders(authorization) });
    if (!userResponse.ok) return json({ error: 'Invalid session' }, 401);
    const user = await userResponse.json();
    const userId = String(user?.id ?? '');
    if (!userId) return json({ error: 'Invalid session' }, 401);

    const query = encodeURIComponent('id,name,category,color,size,season,brand,notes');
    const wardrobeResponse = await fetch(`${supabaseUrl}/rest/v1/wardrobe_items?select=${query}&user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc`, { headers: authHeaders(authorization) });
    if (!wardrobeResponse.ok) return json({ error: 'Could not load wardrobe' }, 502);
    const wardrobe = await wardrobeResponse.json();

    const profileResponse = await fetch(`${supabaseUrl}/rest/v1/profiles?select=display_name,city,preferences,style_tags,style_profile&id=eq.${encodeURIComponent(userId)}&limit=1`, { headers: authHeaders(authorization) });
    const profileRows = profileResponse.ok ? await profileResponse.json() : [];
    const profile = profileRows?.[0] ?? { display_name: user?.user_metadata?.full_name ?? '', city: 'Prague', preferences: {}, style_tags: [], style_profile: {} };
    const weather = body?.weather && typeof body.weather === 'object' ? body.weather : { city: profile.city ?? 'Prague', temperature_c: 18, weather_code: 3 };

    const geminiKey = Deno.env.get('GEMINI_API_KEY');
    const openAiKey = Deno.env.get('OPENAI_API_KEY');
    if (!geminiKey && !openAiKey) return json({ error: 'AI provider is not configured yet' }, 503);
    const instructions = [
      'Ты — персональный AI-стилист приложения metti.',
      'Подбирай образ только из переданных вещей пользователя. Не придумывай вещи и не добавляй предметы, которых нет в списке.',
      'Учитывай запрос, погоду, город и предпочтения профиля. Ответ возвращай строго в JSON без markdown.',
      'Формат: {"title": string, "note": string, "message": string, "item_ids": string[]}. item_ids должен содержать от 1 до 6 id из гардероба.'
    ].join('\n');
    const context = JSON.stringify({ prompt, weather, profile, wardrobe });
    let provider = 'openai';
    let aiResponse: Response;
    if (geminiKey) {
      provider = 'gemini';
      const model = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash-lite';
      aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': geminiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: instructions }] },
          contents: [{ role: 'user', parts: [{ text: context }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 500 }
        })
      });
    } else {
      const model = Deno.env.get('OPENAI_MODEL') || 'gpt-4.1-mini';
      aiResponse = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openAiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, instructions, input: context, temperature: 0.7, max_output_tokens: 500 })
      });
    }
    const aiPayload = await aiResponse.json().catch(() => ({}));
    if (!aiResponse.ok) {
      console.error(`${provider} request failed`, aiResponse.status, aiPayload?.error?.message || aiPayload?.error?.status || 'unknown error');
      return json({ error: 'AI provider request failed' }, 502);
    }
    const parsed = cleanJson(provider === 'gemini' ? geminiOutputText(aiPayload) : outputText(aiPayload)) ?? {};
    const validIds = new Set((wardrobe ?? []).map((item: any) => String(item.id)));
    const itemIds = Array.isArray(parsed.item_ids) ? parsed.item_ids.map((id: unknown) => String(id)).filter((id: string) => validIds.has(id)).slice(0, 6) : [];
    const fallbackIds = (wardrobe ?? []).slice(0, 4).map((item: any) => String(item.id));
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
    return json({ error: 'Stylist request failed' }, 500);
  }
});
