(() => {
  const config = window.METTI_SUPABASE_CONFIG;
  if (!config?.url || !config?.publishableKey) return;

  const sessionKey = 'metti.supabase.session';
  const rememberKey = 'metti.supabase.remember';
  const pkceKey = 'metti.supabase.pkce.verifier';
  const storagePath = (name) => `/${String(name).split('/').map(encodeURIComponent).join('/')}`;
  const readStored = (storage, key = sessionKey) => {
    try {
      const value = storage?.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch (_) {
      return null;
    }
  };
  const readSession = () => readStored(window.localStorage) || readStored(window.sessionStorage);
  const rememberSession = () => {
    try {
      const value = window.localStorage?.getItem(rememberKey);
      if (value !== null) return value === '1';
    } catch (_) { /* private preview */ }
    return true;
  };
  const writeSession = (session, remember = true) => {
    try { window.localStorage?.removeItem(sessionKey); } catch (_) { /* private preview */ }
    try { window.sessionStorage?.removeItem(sessionKey); } catch (_) { /* private preview */ }
    try { window.localStorage?.removeItem(rememberKey); } catch (_) { /* private preview */ }
    if (!session) return;
    const normalized = { ...session };
    if (!normalized.expires_at && normalized.expires_in) normalized.expires_at = Math.floor(Date.now() / 1000) + Number(normalized.expires_in);
    try {
      const storage = remember ? window.localStorage : window.sessionStorage;
      storage?.setItem(sessionKey, JSON.stringify(normalized));
      window.localStorage?.setItem(rememberKey, remember ? '1' : '0');
    } catch (_) {
      // A private/file-based preview may not expose storage.
    }
  };
  const clearSession = () => writeSession(null);

  const clearPkceVerifier = () => {
    try { window.localStorage?.removeItem(pkceKey); } catch (_) { /* private preview */ }
    try { window.sessionStorage?.removeItem(pkceKey); } catch (_) { /* private preview */ }
  };
  const writePkceVerifier = (verifier) => {
    const value = JSON.stringify({ verifier, created_at: Date.now() });
    try { window.sessionStorage?.setItem(pkceKey, value); } catch (_) { /* private preview */ }
    try { window.localStorage?.setItem(pkceKey, value); } catch (_) { /* private preview */ }
  };
  const readPkceVerifier = () => {
    let raw = null;
    try { raw = window.sessionStorage?.getItem(pkceKey) || null; } catch (_) { /* private preview */ }
    if (!raw) {
      try { raw = window.localStorage?.getItem(pkceKey) || null; } catch (_) { /* private preview */ }
    }
    if (!raw) return '';
    try {
      const parsed = JSON.parse(raw);
      if (!parsed?.verifier || Date.now() - Number(parsed.created_at || 0) > 10 * 60 * 1000) {
        clearPkceVerifier();
        return '';
      }
      return String(parsed.verifier);
    } catch (_) {
      clearPkceVerifier();
      return '';
    }
  };
  const base64Url = (bytes) => {
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  };
  const createPkcePair = async () => {
    if (!window.crypto?.getRandomValues || !window.crypto?.subtle || !window.TextEncoder) return null;
    const random = new Uint8Array(32);
    window.crypto.getRandomValues(random);
    const verifier = base64Url(random);
    const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return { verifier, challenge: base64Url(new Uint8Array(digest)) };
  };

  const parseBody = async (response) => {
    if (response.status === 204) return null;
    const text = await response.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch (_) { return text; }
  };
  const makeHeaders = (headers = {}, session = readSession()) => {
    const result = new Headers(headers);
    result.set('apikey', config.publishableKey);
    if (session?.access_token) result.set('authorization', `Bearer ${session.access_token}`);
    return result;
  };
  const rawRequest = async (path, options = {}) => {
    const requestSession = Object.prototype.hasOwnProperty.call(options, 'session') ? options.session : readSession();
    const headers = makeHeaders(options.headers, requestSession);
    if (options.body !== undefined && !(options.body instanceof Blob) && !headers.has('content-type')) headers.set('content-type', 'application/json');
    const response = await fetch(`${config.url}${path}`, { ...options, headers });
    const body = await parseBody(response);
    if (!response.ok) {
      const message = body?.msg || body?.message || body?.error_description || body?.error || (typeof body === 'string' ? body : '') || `Supabase request failed (${response.status})`;
      const error = new Error(message);
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  };

  let refreshPromise = null;
  const refreshSession = async () => {
    const current = readSession();
    if (!current?.refresh_token) return null;
    if (refreshPromise) return refreshPromise;
    refreshPromise = rawRequest('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: current.refresh_token }),
      session: null
    }).then((next) => {
      if (next?.access_token) writeSession(next, rememberSession());
      return next;
    }).catch((error) => {
      clearSession();
      throw error;
    }).finally(() => { refreshPromise = null; });
    return refreshPromise;
  };
  const request = async (path, options = {}, canRefresh = true) => {
    try {
      return await rawRequest(path, options);
    } catch (error) {
      if (canRefresh && error.status === 401 && readSession()?.refresh_token && !path.startsWith('/auth/v1/token')) {
        await refreshSession();
        return request(path, options, false);
      }
      throw error;
    }
  };
  const currentUser = () => readSession()?.user || null;

  const oauth = {
    getAuthorizationDetails: async (authorizationId) => {
      const id = String(authorizationId || '').trim();
      if (!id) return { data: null, error: new Error('Не найден authorization_id.') };
      try {
        const data = await request(`/auth/v1/oauth/authorizations/${encodeURIComponent(id)}`);
        return { data, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
    approveAuthorization: async (authorizationId, options = {}) => {
      const id = String(authorizationId || '').trim();
      if (!id) return { data: null, error: new Error('Не найден authorization_id.') };
      try {
        const data = await request(`/auth/v1/oauth/authorizations/${encodeURIComponent(id)}/consent`, {
          method: 'POST',
          body: JSON.stringify({ action: 'approve' })
        });
        if (data?.redirect_url && !options.skipBrowserRedirect) window.location.assign(data.redirect_url);
        return { data, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
    denyAuthorization: async (authorizationId, options = {}) => {
      const id = String(authorizationId || '').trim();
      if (!id) return { data: null, error: new Error('Не найден authorization_id.') };
      try {
        const data = await request(`/auth/v1/oauth/authorizations/${encodeURIComponent(id)}/consent`, {
          method: 'POST',
          body: JSON.stringify({ action: 'deny' })
        });
        if (data?.redirect_url && !options.skipBrowserRedirect) window.location.assign(data.redirect_url);
        return { data, error: null };
      } catch (error) {
        return { data: null, error };
      }
    }
  };

  const auth = {
    oauth: Object.freeze(oauth),
    getSession: readSession,
    getUser: async () => {
      const user = await request('/auth/v1/user');
      const session = readSession();
      if (session && user?.id) writeSession({ ...session, user }, rememberSession());
      return user;
    },
    restoreSession: async () => {
      const session = readSession();
      if (!session) return null;
      const expiresAt = Number(session.expires_at || 0);
      if (expiresAt && expiresAt > Math.floor(Date.now() / 1000) + 60) return session;
      try { return await refreshSession(); } catch (_) { return null; }
    },
    signUp: async (email, password, profile = {}, remember = true) => {
      const result = await request('/auth/v1/signup', { method: 'POST', body: JSON.stringify({ email, password, data: profile }), session: null });
      if (result?.access_token) writeSession(result, remember);
      return result;
    },
    signIn: async (email, password, remember = true) => {
      const result = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }), session: null });
      if (result?.access_token) writeSession(result, remember);
      return result;
    },
    refreshSession,
    setSession: (session, remember = true) => { writeSession(session, remember); return readSession(); },
    getSettings: () => request('/auth/v1/settings', { session: null }),
    exchangeCodeForSession: async (code, remember = true) => {
      const verifier = readPkceVerifier();
      if (!code || !verifier) throw new Error('Не удалось завершить вход Google. Нажмите кнопку ещё раз.');
      try {
        const result = await rawRequest('/auth/v1/token?grant_type=pkce', {
          method: 'POST',
          body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
          session: null
        });
        if (!result?.access_token) throw new Error('Google не вернул сессию. Нажмите кнопку ещё раз.');
        writeSession(result, remember);
        return result;
      } finally {
        clearPkceVerifier();
      }
    },
    signInWithGoogle: async (redirectTo = window.location.href) => {
      const target = new URL(`${config.url}/auth/v1/authorize`);
      target.searchParams.set('provider', 'google');
      target.searchParams.set('redirect_to', redirectTo);
      target.searchParams.set('apikey', config.publishableKey);
      clearPkceVerifier();
      try {
        const pkce = await createPkcePair();
        if (pkce) {
          writePkceVerifier(pkce.verifier);
          target.searchParams.set('code_challenge', pkce.challenge);
          target.searchParams.set('code_challenge_method', 's256');
        }
      } catch (_) {
        // If Web Crypto is unavailable, Supabase falls back to implicit flow.
      }
      window.location.assign(target.href);
    },
    resetPassword: (email, redirectTo = window.location.href) => request('/auth/v1/recover', { method: 'POST', body: JSON.stringify({ email, redirect_to: redirectTo }), session: null }),
    updatePassword: (password) => request('/auth/v1/user', { method: 'PUT', body: JSON.stringify({ password }) }),
    signOut: async () => {
      try { if (readSession()?.access_token) await request('/auth/v1/logout', { method: 'POST' }, false); } finally { clearSession(); }
    }
  };

  const data = {
    listWardrobe: () => request('/rest/v1/wardrobe_items?select=*&archived_at=is.null&order=created_at.desc'),
    saveWardrobeItem: async (item) => {
      const payload = { ...item };
      delete payload.id;
      delete payload.created_at;
      delete payload.updated_at;
      const result = await request('/rest/v1/wardrobe_items', { method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify(payload) });
      return Array.isArray(result) ? result[0] : result;
    },
    updateWardrobeItem: async (id, changes) => {
      const result = await request(`/rest/v1/wardrobe_items?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify(changes) });
      return Array.isArray(result) ? result[0] : result;
    },
    deleteWardrobeItem: (id) => request(`/rest/v1/wardrobe_items?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }),
    uploadWardrobeImage: async (file, userId, itemId = crypto.randomUUID()) => {
      if (!file || !userId) throw new Error('Для загрузки нужна фотография и авторизация.');
      const rawType = String(file.type || 'image/jpeg').toLowerCase();
      const extension = rawType.includes('png') ? 'png' : rawType.includes('webp') ? 'webp' : rawType.includes('heic') ? 'heic' : 'jpg';
      const path = `${userId}/${itemId}-${Date.now()}.${extension}`;
      await request(`/storage/v1/object/wardrobe${storagePath(path)}`, { method: 'POST', headers: { 'content-type': rawType, 'cache-control': '3600', 'x-upsert': 'false' }, body: file });
      return path;
    },
    removeWardrobeImage: (path) => path ? request('/storage/v1/object/remove/wardrobe', { method: 'POST', body: JSON.stringify({ prefixes: [path] }) }) : null,
    listWardrobeImageVersions: async (userId, itemId) => {
      if (!userId || !itemId) return [];
      const result = await request('/storage/v1/object/list/wardrobe', {
        method: 'POST',
        body: JSON.stringify({ prefix: `${userId}/${itemId}`, limit: 100, offset: 0, sortBy: { column: 'created_at', order: 'asc' } })
      });
      return Array.isArray(result) ? result : [];
    },
    createWardrobeImageUrl: async (path, expiresIn = 3600) => {
      if (!path) return '';
      const result = await request(`/storage/v1/object/sign/wardrobe${storagePath(path)}`, { method: 'POST', body: JSON.stringify({ expiresIn }) });
      const signed = result?.signedURL || result?.signedUrl || '';
      if (!signed) return '';
      if (signed.startsWith('http')) return signed;
      const relative = signed.startsWith('/storage/v1/') ? signed : `/storage/v1${signed.startsWith('/') ? signed : `/${signed}`}`;
      return `${config.url}${relative}`;
    },
    createWardrobeImageUrls: async (paths, expiresIn = 3600) => {
      const uniquePaths = [...new Set((Array.isArray(paths) ? paths : []).map((path) => String(path || '').trim()).filter(Boolean))];
      const result = {};
      if (!uniquePaths.length) return result;
      try {
        const rows = await request('/storage/v1/object/sign/wardrobe', { method: 'POST', body: JSON.stringify({ expiresIn, paths: uniquePaths }) });
        (Array.isArray(rows) ? rows : []).forEach((row, index) => {
          const signed = row?.signedURL || row?.signedUrl || '';
          if (!signed) return;
          const path = row?.path || uniquePaths[index];
          if (signed.startsWith('http')) result[path] = signed;
          else {
            const relative = signed.startsWith('/storage/v1/') ? signed : `/storage/v1${signed.startsWith('/') ? signed : `/${signed}`}`;
            result[path] = `${config.url}${relative}`;
          }
        });
      } catch (_) {
        // The individual endpoint below is the compatibility fallback for old Storage deployments.
      }
      if (Object.keys(result).length === uniquePaths.length) return result;
      await Promise.all(uniquePaths.filter((path) => !result[path]).map(async (path) => {
        try { result[path] = await data.createWardrobeImageUrl(path, expiresIn); } catch (_) { /* keep this image unavailable */ }
      }));
      return result;
    },
    listSavedOutfits: () => request('/rest/v1/saved_outfits?select=*&archived_at=is.null&order=created_at.desc'),
    saveOutfit: async (outfit) => {
      const result = await request('/rest/v1/saved_outfits', { method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify(outfit) });
      return Array.isArray(result) ? result[0] : result;
    },
    updateOutfit: async (id, changes) => {
      const result = await request(`/rest/v1/saved_outfits?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify(changes) });
      return Array.isArray(result) ? result[0] : result;
    },
    deleteOutfit: (id) => request(`/rest/v1/saved_outfits?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }),
    deleteAccount: () => request('/functions/v1/metti-delete-account', { method: 'POST', headers: { 'x-client-info': 'metti-web' }, body: JSON.stringify({}) }),
    getProfile: async () => {
      const result = await request('/rest/v1/profiles?select=*&limit=1');
      return Array.isArray(result) ? result[0] || null : result;
    },
    saveProfile: async (profile) => {
      const result = await request('/rest/v1/profiles?on_conflict=id', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(profile) });
      return Array.isArray(result) ? result[0] : result;
    },
    invokeStylist: (payload) => request('/functions/v1/metti-stylist', { method: 'POST', headers: { 'x-client-info': 'metti-web' }, body: JSON.stringify(payload) })
  };

  window.MettiSupabase = Object.freeze({ config, request, auth: Object.freeze(auth), data: Object.freeze(data), currentUser });
})();
