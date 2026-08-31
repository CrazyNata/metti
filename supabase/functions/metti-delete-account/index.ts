type SupabaseConfig = { url: string; publishableKey: string };
type AuthUser = { id: string };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
});

const appError = (message: string, status = 500) => Object.assign(new Error(message), { status });

const getConfig = (): SupabaseConfig => {
  const url = String(Deno.env.get('SUPABASE_URL') ?? '').trim().replace(/\/$/, '');
  const publishableKey = String(Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? '').trim();
  if (!url || !publishableKey) throw appError('Supabase environment is not configured.', 500);
  return { url, publishableKey };
};

const getAuthenticatedUser = async (req: Request, config: SupabaseConfig): Promise<AuthUser> => {
  const authorization = req.headers.get('authorization') ?? '';
  if (!/^Bearer\s+\S+\s*$/i.test(authorization)) throw appError('Authentication is required.', 401);
  const response = await fetch(`${config.url}/auth/v1/user`, { headers: { apikey: config.publishableKey, authorization, accept: 'application/json' } });
  if (!response.ok) throw appError('Invalid session.', 401);
  const body = await response.json().catch(() => ({}));
  if (!body?.id || typeof body.id !== 'string') throw appError('Invalid session.', 401);
  return { id: body.id };
};

const adminRequest = (config: SupabaseConfig, serviceKey: string, path: string, options: RequestInit = {}) => {
  const headers = new Headers(options.headers);
  headers.set('apikey', serviceKey);
  headers.set('authorization', `Bearer ${serviceKey}`);
  headers.set('accept', 'application/json');
  if (options.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return fetch(`${config.url}${path}`, { ...options, headers });
};

const serverError = async (response: Response, fallback: string) => {
  const payload = await response.json().catch(() => null);
  const detail = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? String((payload as Record<string, unknown>).message ?? (payload as Record<string, unknown>).error_description ?? '')
    : '';
  return appError(detail || fallback, 502);
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const config = getConfig();
    const user = await getAuthenticatedUser(req, config);
    const serviceKey = String(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY') ?? '').trim();
    if (!serviceKey) throw appError('Удаление аккаунта ещё не настроено на сервере.', 503);

    // Storage objects must be removed before auth.users because Supabase refuses
    // to delete an auth user that still owns files.
    const listResponse = await adminRequest(config, serviceKey, '/storage/v1/object/list/wardrobe', {
      method: 'POST',
      body: JSON.stringify({ prefix: `${user.id}/`, limit: 1000, offset: 0, sortBy: { column: 'name', order: 'asc' } })
    });
    if (!listResponse.ok) throw await serverError(listResponse, 'Не удалось подготовить файлы к удалению.');
    const listed = await listResponse.json().catch(() => []);
    const paths = Array.isArray(listed)
      ? listed.map((item) => typeof item?.name === 'string' && item.name ? (item.name.startsWith(`${user.id}/`) ? item.name : `${user.id}/${item.name}`) : '').filter(Boolean)
      : [];
    if (paths.length) {
      const removeResponse = await adminRequest(config, serviceKey, '/storage/v1/object/remove/wardrobe', {
        method: 'POST',
        body: JSON.stringify({ prefixes: paths })
      });
      if (!removeResponse.ok) throw await serverError(removeResponse, 'Не удалось удалить фотографии гардероба.');
    }

    const deleteResponse = await adminRequest(config, serviceKey, `/auth/v1/admin/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' });
    if (!deleteResponse.ok) throw await serverError(deleteResponse, 'Не удалось удалить аккаунт.');
    return json({ ok: true });
  } catch (error) {
    console.error('metti-delete-account error', error);
    const status = Number((error as { status?: number })?.status) || 500;
    const message = error instanceof Error ? error.message : 'Не удалось удалить аккаунт.';
    return json({ error: message }, status);
  }
});
