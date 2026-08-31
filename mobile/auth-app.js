(() => {
  const gate = document.querySelector('#auth-gate');
  const supabase = window.MettiSupabase;
  if (!gate) return;

  const views = [...gate.querySelectorAll('[data-auth-view]')];
  const forms = { login: gate.querySelector('#login-form'), register: gate.querySelector('#register-form'), reset: gate.querySelector('#reset-form') };
  let mode = 'login';
  let oauthPending = false;
  const translate = (value) => window.MettiI18n?.t?.(value) ?? value;

  const statusNode = (view = mode) => gate.querySelector(`#${view}-status`);
  const setStatus = (message = '', type = '') => {
    const node = statusNode();
    if (!node) return;
    node.textContent = translate(message);
    node.className = `auth-status${type ? ` ${type}` : ''}`;
  };
  const friendlyError = (error) => {
    const message = String(error?.message || error || '');
    if (/invalid login credentials/i.test(message)) return 'Проверьте email и пароль.';
    if (/already registered|user already exists/i.test(message)) return 'Этот email уже зарегистрирован. Войдите.';
    if (/password should be at least/i.test(message)) return 'Пароль должен содержать минимум 8 символов.';
    if (/access_denied|cancelled|canceled|отмен/i.test(message)) return 'Вход в Google отменён.';
    if (/bad_code_verifier|code verifier|auth code|invalid flow state|no valid flow state|google не вернул сессию/i.test(message)) return 'Не удалось завершить вход Google. Нажмите кнопку ещё раз.';
    if (/redirect.*(not|invalid|allow)|not.*allow.*redirect/i.test(message)) return 'Адрес возврата не разрешён в настройках Supabase.';
    if (/email/i.test(message) && /invalid/i.test(message)) return 'Введите корректный email.';
    return message || 'Не удалось выполнить действие. Попробуйте ещё раз.';
  };
  const setMode = (nextMode) => {
    mode = ['login', 'register', 'reset'].includes(nextMode) ? nextMode : 'login';
    views.forEach((view) => { view.hidden = view.dataset.authView !== mode; });
    setStatus('');
    const firstInput = forms[mode]?.querySelector('input');
    if (gate.classList.contains('is-open')) firstInput?.focus({ preventScroll: true });
  };
  const show = (nextMode = 'login') => {
    setMode(nextMode);
    gate.hidden = false;
    gate.classList.add('is-open');
    gate.setAttribute('aria-hidden', 'false');
    gate.scrollTop = 0;
    document.querySelector('.app-scroll')?.setAttribute('aria-hidden', 'true');
    document.querySelector('.bottom-nav')?.setAttribute('aria-hidden', 'true');
  };
  const hide = () => {
    gate.classList.remove('is-open');
    gate.hidden = true;
    gate.setAttribute('aria-hidden', 'true');
    document.querySelector('.app-scroll')?.removeAttribute('aria-hidden');
    document.querySelector('.bottom-nav')?.removeAttribute('aria-hidden');
  };
  const setLoading = (form, loading) => {
    const button = form?.querySelector('.auth-submit');
    if (!button) return;
    if (loading) {
      button.dataset.label = button.innerHTML;
      button.innerHTML = translate('Секунду…');
      button.disabled = true;
    } else {
      button.innerHTML = button.dataset.label || button.innerHTML;
      button.disabled = false;
    }
  };
  const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  const submitLogin = async (form) => {
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;
    const remember = form.elements.remember.checked;
    if (!validEmail(email)) return setStatus('Введите корректный email.', 'error');
    if (!password) return setStatus('Введите пароль.', 'error');
    if (!supabase?.auth) return setStatus('Supabase пока не подключён.', 'error');
    setLoading(form, true); setStatus('Выполняю вход…');
    try {
      const result = await supabase.auth.signIn(email, password, remember);
      if (!result?.access_token) throw new Error('Сессия не создана. Попробуйте ещё раз.');
      setStatus('Готово.', 'success');
      hide();
      window.dispatchEvent(new CustomEvent('metti:authenticated', { detail: result }));
    } catch (error) {
      setStatus(friendlyError(error), 'error');
    } finally { setLoading(form, false); }
  };
  const submitRegister = async (form) => {
    const name = form.elements.name.value.trim();
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;
    if (!name) return setStatus('Напишите, как к вам обращаться.', 'error');
    if (!validEmail(email)) return setStatus('Введите корректный email.', 'error');
    if (password.length < 8) return setStatus('Пароль должен содержать минимум 8 символов.', 'error');
    if (!supabase?.auth) return setStatus('Supabase пока не подключён.', 'error');
    setLoading(form, true); setStatus('Создаю аккаунт…');
    try {
      const result = await supabase.auth.signUp(email, password, { full_name: name });
      if (result?.access_token) {
        setStatus('Готово.', 'success');
        hide();
        window.dispatchEvent(new CustomEvent('metti:authenticated', { detail: result }));
      } else {
        // Hosted Supabase projects may still require email confirmation. Try
        // signing in immediately so the normal no-confirmation configuration
        // opens the app without ever showing an email step.
        try {
          const signedIn = await supabase.auth.signIn(email, password, true);
          if (signedIn?.access_token) {
            setStatus('Готово.', 'success');
            hide();
            window.dispatchEvent(new CustomEvent('metti:authenticated', { detail: signedIn }));
            return;
          }
        } catch (signInError) {
          if (/email not confirmed|email_not_confirmed/i.test(String(signInError?.message || ''))) {
            throw new Error('Аккаунт создан, но в Supabase включено подтверждение email. Отключите «Confirm email», чтобы вход был сразу.');
          }
          throw signInError;
        }
        setStatus('Аккаунт создан. Теперь можно войти.', 'success');
      }
    } catch (error) {
      setStatus(friendlyError(error), 'error');
    } finally { setLoading(form, false); }
  };
  const submitReset = async (form) => {
    const password = form.elements.password.value;
    if (password.length < 8) return setStatus('Пароль должен содержать минимум 8 символов.', 'error');
    if (!supabase?.auth?.updatePassword) return setStatus('Обновление пароля пока недоступно.', 'error');
    setLoading(form, true); setStatus('Сохраняю новый пароль…');
    try {
      await supabase.auth.updatePassword(password);
      setStatus('Пароль обновлён. Теперь можно войти снова.', 'success');
      setTimeout(() => { supabase.auth.signOut().catch(() => {}); setMode('login'); }, 700);
    } catch (error) { setStatus(friendlyError(error), 'error'); }
    finally { setLoading(form, false); }
  };
  const handleGoogle = async () => {
    if (!supabase?.auth?.signInWithGoogle) return setStatus('Google-вход пока недоступен.', 'error');
    setStatus('Проверяю Google-вход…');
    try {
      const settings = await supabase.auth.getSettings?.();
      if (settings?.external?.google !== true) {
        throw new Error('Google-вход ещё не включён в Supabase.');
      }
      const redirectTo = window.METTI_SUPABASE_CONFIG?.oauthRedirectTo || (window.location.protocol === 'file:' ? 'metti://auth-callback' : `${window.location.origin}${window.location.pathname}`);
      await supabase.auth.signInWithGoogle(redirectTo);
    } catch (error) {
      setStatus(String(error?.message || '').includes('Google-вход ещё') ? error.message : friendlyError(error), 'error');
    }
  };
  const handleForgot = async () => {
    const email = forms.login?.elements.email.value.trim();
    if (!validEmail(email)) return setStatus('Сначала введите email.', 'error');
    if (!supabase?.auth?.resetPassword) return setStatus('Восстановление пока недоступно.', 'error');
    setStatus('Отправляю ссылку…');
    try {
      const redirectTo = window.METTI_SUPABASE_CONFIG?.oauthRedirectTo || (window.location.protocol === 'file:' ? 'metti://auth-callback' : `${window.location.origin}${window.location.pathname}`);
      await supabase.auth.resetPassword(email, redirectTo);
      setStatus('Ссылка для восстановления отправлена.', 'success');
    } catch (error) { setStatus(friendlyError(error), 'error'); }
  };
  const getOAuthCallback = () => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const query = new URLSearchParams(window.location.search);
    const get = (name) => hash.get(name) || query.get(name) || '';
    return {
      accessToken: get('access_token'),
      refreshToken: get('refresh_token'),
      tokenType: get('token_type') || 'bearer',
      expiresIn: Number(get('expires_in') || 3600),
      expiresAt: Number(get('expires_at') || 0),
      providerToken: get('provider_token'),
      providerRefreshToken: get('provider_refresh_token'),
      type: get('type'),
      code: query.get('code') || '',
      error: get('error'),
      errorDescription: get('error_description') || get('error')
    };
  };
  const hasOAuthCallback = (callback) => Boolean(callback.accessToken || callback.code || callback.error || callback.errorDescription);
  const clearOAuthUrl = () => {
    try {
      const clean = new URL(window.location.href);
      ['code', 'error', 'error_code', 'error_description', 'state'].forEach((key) => clean.searchParams.delete(key));
      clean.hash = '';
      window.history.replaceState({}, document.title, `${clean.pathname}${clean.search}`);
    } catch (_) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  };
  const announceAuthenticated = async (session) => {
    let user = null;
    try { user = await supabase?.auth?.getUser?.(); } catch (_) { /* session still contains the user */ }
    const detail = { ...session, ...(user ? { user } : {}) };
    hide();
    window.dispatchEvent(new CustomEvent('metti:authenticated', { detail }));
  };
  const parseOAuthCallback = async (callback) => {
    if (!hasOAuthCallback(callback)) return false;
    oauthPending = true;
    try {
      if (callback.error && !callback.accessToken && !callback.code) {
        clearOAuthUrl();
        show('login');
        setStatus(friendlyError(callback.errorDescription), 'error');
        return true;
      }
      let session;
      if (callback.code) {
        if (!supabase?.auth?.exchangeCodeForSession) throw new Error('Обмен кода Google пока недоступен.');
        session = await supabase.auth.exchangeCodeForSession(callback.code, true);
      } else if (callback.accessToken) {
        session = supabase?.auth?.setSession({
          access_token: callback.accessToken,
          refresh_token: callback.refreshToken,
          token_type: callback.tokenType,
          expires_in: callback.expiresIn,
          ...(callback.expiresAt ? { expires_at: callback.expiresAt } : {}),
          ...(callback.providerToken ? { provider_token: callback.providerToken } : {}),
          ...(callback.providerRefreshToken ? { provider_refresh_token: callback.providerRefreshToken } : {})
        }, true);
      } else {
        throw new Error(callback.errorDescription || 'Google не вернул данные для входа.');
      }
      clearOAuthUrl();
      if (callback.type === 'recovery') show('reset');
      else await announceAuthenticated(session);
    } catch (error) {
      clearOAuthUrl();
      show('login');
      setStatus(friendlyError(error), 'error');
    } finally {
      oauthPending = false;
    }
    return true;
  };

  gate.addEventListener('click', (event) => {
    const modeButton = event.target.closest('[data-auth-mode]');
    if (modeButton) setMode(modeButton.dataset.authMode);
    const passwordButton = event.target.closest('[data-auth-password]');
    if (passwordButton) {
      const input = document.getElementById(passwordButton.dataset.authPassword);
      if (!input) return;
      const visible = input.type === 'password';
      input.type = visible ? 'text' : 'password';
      passwordButton.classList.toggle('visible', visible);
      passwordButton.setAttribute('aria-label', translate(visible ? 'Скрыть пароль' : 'Показать пароль'));
    }
    const action = event.target.closest('[data-auth-action]')?.dataset.authAction;
    if (action === 'google') handleGoogle();
    if (action === 'forgot') handleForgot();
  });
  forms.login?.addEventListener('submit', (event) => { event.preventDefault(); submitLogin(forms.login); });
  forms.register?.addEventListener('submit', (event) => { event.preventDefault(); submitRegister(forms.register); });
  forms.reset?.addEventListener('submit', (event) => { event.preventDefault(); submitReset(forms.reset); });

  window.MettiAuth = Object.freeze({ show, hide, isOAuthPending: () => oauthPending, signOut: async () => { try { await supabase?.auth?.signOut(); } finally { window.dispatchEvent(new CustomEvent('metti:signed-out')); show('login'); } } });
  const oauthCallback = getOAuthCallback();
  const oauthHandled = hasOAuthCallback(oauthCallback);
  const demoMode = new URLSearchParams(window.location.search).get('demo') === '1';
  if (oauthHandled) parseOAuthCallback(oauthCallback);
  else if (!demoMode && !supabase?.auth?.getSession()) show('login');
})();
