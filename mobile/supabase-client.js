(() => {
  const config = window.METTI_SUPABASE_CONFIG;
  if (!config?.url || !config?.publishableKey) return;

  const sessionKey = 'metti.supabase.session';
  const readStored = (storage) => {
    try {
      const value = storage?.getItem(sessionKey);
      return value ? JSON.parse(value) : null;
    } catch (_) {
      return null;
    }
  };
  const readSession = () => readStored(window.localStorage) || readStored(window.sessionStorage);
  const writeSession = (session, remember = true) => {
    try { window.localStorage.removeItem(sessionKey); } catch (_) { /* private preview */ }
    try { window.sessionStorage.removeItem(sessionKey); } catch (_) { /* private preview */ }
    if (!session) return;
    try {
      const storage = remember ? window.localStorage : window.sessionStorage;
      storage.setItem(sessionKey, JSON.stringify(session));
    } catch (_) {
      // A private/file-based preview may not expose storage.
    }
  };
  const request = async (path, options = {}) => {
    const session = readSession();
    const headers = new Headers(options.headers || {});
    headers.set('apikey', config.publishableKey);
    if (options.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    if (session?.access_token) headers.set('authorization', `Bearer ${session.access_token}`);
    const response = await fetch(`${config.url}${path}`, { ...options, headers });
    const body = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.msg || body?.message || body?.error_description || `Supabase request failed (${response.status})`);
    return body;
  };

  const auth = {
    getSession: readSession,
    signUp: async (email, password, profile = {}, remember = true) => {
      const result = await request('/auth/v1/signup', { method: 'POST', body: JSON.stringify({ email, password, data: profile }) });
      if (result?.access_token) writeSession(result, remember);
      return result;
    },
    signIn: async (email, password, remember = true) => {
      const result = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) });
      if (result?.access_token) writeSession(result, remember);
      return result;
    },
    setSession: (session, remember = true) => writeSession(session, remember),
    getSettings: () => request('/auth/v1/settings'),
    signInWithGoogle: (redirectTo = window.location.href) => {
      const target = new URL(`${config.url}/auth/v1/authorize`);
      target.searchParams.set('provider', 'google');
      target.searchParams.set('redirect_to', redirectTo);
      target.searchParams.set('apikey', config.publishableKey);
      window.location.assign(target.href);
    },
    resetPassword: (email, redirectTo = window.location.href) => request('/auth/v1/recover', { method: 'POST', body: JSON.stringify({ email, redirect_to: redirectTo }) }),
    signOut: async () => {
      try { await request('/auth/v1/logout', { method: 'POST' }); } finally { writeSession(null); }
    }
  };

  const data = {
    listWardrobe: () => request('/rest/v1/wardrobe_items?select=*&order=created_at.desc'),
    saveWardrobeItem: (item) => request('/rest/v1/wardrobe_items', { method: 'POST', body: JSON.stringify(item) }),
    listSavedOutfits: () => request('/rest/v1/saved_outfits?select=*&order=created_at.desc'),
    saveOutfit: (outfit) => request('/rest/v1/saved_outfits', { method: 'POST', body: JSON.stringify(outfit) }),
    getProfile: () => request('/rest/v1/profiles?select=*&limit=1'),
    saveProfile: (profile) => request('/rest/v1/profiles', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(profile) })
  };

  window.MettiSupabase = Object.freeze({ config, request, auth, data });
})();
