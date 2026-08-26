(() => {
  const gate = document.querySelector('#auth-gate');
  const supabase = window.MettiSupabase;
  if (!gate) return;

  const views = [...gate.querySelectorAll('[data-auth-view]')];
  const forms = { login: gate.querySelector('#login-form'), register: gate.querySelector('#register-form') };
  let mode = 'login';

  const statusNode = (view = mode) => gate.querySelector(`#${view}-status`);
  const setStatus = (message = '', type = '') => {
    const node = statusNode();
    if (!node) return;
    node.textContent = message;
    node.className = `auth-status${type ? ` ${type}` : ''}`;
  };
  const friendlyError = (error) => {
    const message = String(error?.message || error || '');
    if (/invalid login credentials/i.test(message)) return 'Проверьте email и пароль.';
    if (/already registered|user already exists/i.test(message)) return 'Этот email уже зарегистрирован. Войдите.';
    if (/password should be at least/i.test(message)) return 'Пароль должен содержать минимум 8 символов.';
    if (/email/i.test(message) && /invalid/i.test(message)) return 'Введите корректный email.';
    return message || 'Не удалось выполнить действие. Попробуйте ещё раз.';
  };
  const setMode = (nextMode) => {
    mode = nextMode === 'register' ? 'register' : 'login';
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
      button.innerHTML = 'Секунду…';
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
        setStatus('Аккаунт создан. Проверьте почту для подтверждения.', 'success');
      }
    } catch (error) {
      setStatus(friendlyError(error), 'error');
    } finally { setLoading(form, false); }
  };
  const handleGoogle = async () => {
    if (!supabase?.auth?.signInWithGoogle) return setStatus('Google-вход пока недоступен.', 'error');
    setStatus('Проверяю Google-вход…');
    try {
      const settings = await supabase.auth.getSettings?.();
      if (settings?.external?.google !== true) {
        throw new Error('Google-вход ещё не включён в Supabase.');
      }
      const redirectTo = `${window.location.origin}${window.location.pathname}`;
      supabase.auth.signInWithGoogle(redirectTo);
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
      await supabase.auth.resetPassword(email, `${window.location.origin}${window.location.pathname}`);
      setStatus('Ссылка для восстановления отправлена.', 'success');
    } catch (error) { setStatus(friendlyError(error), 'error'); }
  };
  const parseOAuthCallback = () => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const accessToken = params.get('access_token');
    if (!accessToken) return false;
    supabase?.auth?.setSession({ access_token: accessToken, refresh_token: params.get('refresh_token') || '', token_type: params.get('token_type') || 'bearer', expires_in: Number(params.get('expires_in') || 3600) });
    window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
    hide();
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
      passwordButton.setAttribute('aria-label', visible ? 'Скрыть пароль' : 'Показать пароль');
    }
    const action = event.target.closest('[data-auth-action]')?.dataset.authAction;
    if (action === 'google') handleGoogle();
    if (action === 'forgot') handleForgot();
  });
  forms.login?.addEventListener('submit', (event) => { event.preventDefault(); submitLogin(forms.login); });
  forms.register?.addEventListener('submit', (event) => { event.preventDefault(); submitRegister(forms.register); });

  window.MettiAuth = Object.freeze({ show, hide, signOut: async () => { try { await supabase?.auth?.signOut(); } finally { show('login'); } } });
  const oauthHandled = parseOAuthCallback();
  const demoMode = new URLSearchParams(window.location.search).get('demo') === '1';
  if (!oauthHandled && !demoMode && !supabase?.auth?.getSession()) show('login');
})();
