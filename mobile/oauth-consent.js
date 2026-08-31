(() => {
  const supabase = window.MettiSupabase;
  const states = [...document.querySelectorAll("[data-state]")];
  const authorizationId =
    new URLSearchParams(window.location.search).get("authorization_id")
      ?.trim() || "";
  const loginForm = document.querySelector("#oauth-login-form");
  const loginStatus = document.querySelector("#login-status");
  const decisionStatus = document.querySelector("#decision-status");
  const setState = (name) =>
    states.forEach((node) => {
      node.hidden = node.dataset.state !== name;
    });
  const setStatus = (node, message = "", type = "") => {
    if (!node) return;
    node.textContent = message;
    node.dataset.type = type;
  };
  const friendlyError = (error) => {
    const message = String(error?.message || error || "");
    if (/oauth|authorization|not found|disabled|404/i.test(message)) {
      return "OAuth-подключение ещё не включено или запрос уже истёк. Проверьте настройки Supabase OAuth Server и начните подключение снова.";
    }
    if (/invalid login credentials/i.test(message)) {
      return "Проверьте email и пароль.";
    }
    if (/email not confirmed/i.test(message)) {
      return "Сначала подтвердите email в письме от Supabase.";
    }
    return message || "Не удалось выполнить действие. Попробуйте ещё раз.";
  };
  const showError = (message) => {
    document.querySelector("#error-message").textContent = message;
    setState("error");
  };
  const setButtonLoading = (button, loading, label) => {
    if (!button) return;
    if (loading) {
      button.dataset.label = button.textContent;
      button.textContent = label;
      button.disabled = true;
    } else {
      button.textContent = button.dataset.label || button.textContent;
      button.disabled = false;
    }
  };
  const scopeLabel = (scope) => ({
    openid: "Идентификация пользователя (OpenID)",
    email: "Email пользователя",
    profile: "Базовые данные профиля",
    phone: "Номер телефона",
  }[scope] || scope);
  const renderDetails = (details) => {
    if (details?.redirect_url) {
      window.location.assign(details.redirect_url);
      return false;
    }
    if (!details?.authorization_id || !details.client) {
      throw new Error("OAuth вернул неполные данные запроса.");
    }
    const clientName = String(details.client.name || "Неизвестное приложение");
    document.querySelector("#client-title").textContent =
      `${clientName} хочет подключиться`;
    document.querySelector("#client-description").textContent = String(
      details.client.description ||
        "Это приложение запрашивает доступ к данным вашего аккаунта Metti через MCP.",
    );
    document.querySelector("#client-name").textContent = clientName;
    document.querySelector("#redirect-uri").textContent = String(
      details.redirect_uri || "Не указан",
    );
    const scopes = String(details.scope || "").split(/\s+/).map((scope) =>
      scope.trim()
    ).filter(Boolean);
    const scopeList = document.querySelector("#scope-list");
    scopeList.replaceChildren(
      ...(scopes.length ? scopes : ["metti"]).map((scope) => {
        const item = document.createElement("li");
        item.textContent = scopeLabel(scope);
        return item;
      }),
    );
    setState("consent");
    return true;
  };
  const loadDetails = async () => {
    if (!authorizationId) {
      throw new Error("В URL отсутствует authorization_id.");
    }
    if (!supabase?.auth?.oauth?.getAuthorizationDetails) {
      throw new Error("OAuth-клиент Metti не подключён.");
    }
    const session = await supabase.auth.restoreSession?.();
    if (!session?.access_token) {
      setState("login");
      return;
    }
    try {
      await supabase.auth.getUser();
    } catch (_) {
      setState("login");
      return;
    }
    const result = await supabase.auth.oauth.getAuthorizationDetails(
      authorizationId,
    );
    if (result.error) throw result.error;
    renderDetails(result.data);
  };
  const handleLogin = async (event) => {
    event.preventDefault();
    const email = loginForm.elements.email.value.trim();
    const password = loginForm.elements.password.value;
    if (!email || !password) {
      setStatus(loginStatus, "Введите email и пароль.", "error");
      return;
    }
    const button = loginForm.querySelector('button[type="submit"]');
    setButtonLoading(button, true, "Вхожу…");
    setStatus(loginStatus, "");
    try {
      await supabase.auth.signIn(email, password, true);
      await loadDetails();
    } catch (error) {
      setStatus(loginStatus, friendlyError(error), "error");
    } finally {
      setButtonLoading(button, false);
    }
  };
  const handleDecision = async (decision) => {
    const button = document.querySelector(`[data-decision="${decision}"]`);
    setButtonLoading(
      button,
      true,
      decision === "approve" ? "Разрешаю…" : "Отклоняю…",
    );
    setStatus(decisionStatus, "");
    try {
      const method = decision === "approve"
        ? supabase.auth.oauth.approveAuthorization
        : supabase.auth.oauth.denyAuthorization;
      const result = await method(authorizationId, {
        skipBrowserRedirect: true,
      });
      if (result.error) throw result.error;
      if (!result.data?.redirect_url) {
        throw new Error("Supabase не вернул адрес возврата.");
      }
      window.location.assign(result.data.redirect_url);
    } catch (error) {
      setStatus(decisionStatus, friendlyError(error), "error");
      setButtonLoading(button, false);
    }
  };

  loginForm?.addEventListener("submit", handleLogin);
  document.addEventListener("click", (event) => {
    const decision = event.target.closest("[data-decision]")?.dataset.decision;
    if (decision) handleDecision(decision);
    if (event.target.closest('[data-action="open-app"]')) {
      window.open("./index.html", "_blank", "noopener");
      setStatus(
        loginStatus,
        "Войдите в новой вкладке, затем вернитесь сюда и обновите страницу.",
      );
    }
  });

  if (!supabase?.config?.url || !supabase?.config?.publishableKey) {
    showError("Supabase не настроен в клиенте Metti.");
  } else loadDetails().catch((error) => showError(friendlyError(error)));
})();
