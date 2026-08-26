(() => {
  const phone = document.querySelector('.phone');
  const toast = document.querySelector('#toast');
  const dateNode = document.querySelector('.screen[data-screen-id="home"] .eyebrow');
  const weatherCard = document.querySelector('.screen[data-screen-id="home"] .weather-card');
  const weatherStrong = weatherCard?.querySelector('strong');
  const weatherSmall = weatherCard?.querySelector('small');
  const weatherIcon = weatherCard?.querySelector('.weather-icon');
  const weatherUrl = 'https://api.open-meteo.com/v1/forecast?latitude=50.0755&longitude=14.4375&current=temperature_2m,weather_code&daily=temperature_2m_max&forecast_days=1&timezone=Europe%2FPrague';
  let toastTimer;
  const showToast = (message) => { toast.textContent = message; toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 1800); };
  const go = (screen) => { document.querySelectorAll('.screen').forEach((item) => item.classList.toggle('active', item.dataset.screenId === screen)); document.querySelectorAll('.bottom-nav button').forEach((item) => item.classList.toggle('active', item.dataset.screen === screen)); phone.scrollTo({ top: 0, behavior: 'smooth' }); };
  const addMessage = (text, role) => { const node = document.createElement('div'); node.className = `message ${role}`; node.textContent = text; document.querySelector('#chat-log').appendChild(node); };
  const ask = (prompt) => { go('chat'); addMessage(prompt, 'user'); setTimeout(() => { addMessage('С удовольствием. Учитываю погоду и ваш гардероб — соберу спокойный, элегантный вариант.', 'assistant'); showToast('Metti собирает образ…'); }, 300); setTimeout(() => { go('result'); showToast('Образ готов'); }, 1800); };
  const updateDate = () => {
    if (!dateNode) return;
    const now = new Date();
    const options = { timeZone: 'Europe/Prague' };
    const weekday = new Intl.DateTimeFormat('ru-RU', { ...options, weekday: 'long' }).format(now).toUpperCase();
    const day = new Intl.DateTimeFormat('ru-RU', { ...options, day: 'numeric' }).format(now);
    const month = new Intl.DateTimeFormat('ru-RU', { ...options, month: 'short' }).format(now).replace(/\./g, '').toUpperCase();
    dateNode.textContent = `${weekday} · ${day} ${month}`;
  };
  const weatherLabel = (code) => {
    if (code === 0) return ['Ясно', '☀'];
    if (code === 1 || code === 2) return ['Переменная облачность', '☁'];
    if (code === 3) return ['Облачно', '☁'];
    if (code === 45 || code === 48) return ['Туман', '☁'];
    if (code >= 51 && code <= 67) return ['Дождь', '☂'];
    if (code >= 71 && code <= 77) return ['Снег', '❄'];
    if (code >= 80 && code <= 82) return ['Ливни', '☂'];
    if (code >= 95) return ['Гроза', '⚡'];
    return ['Облачно', '☁'];
  };
  const updateWeather = async () => {
    if (!weatherCard || !window.fetch) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(weatherUrl, { signal: controller.signal });
      if (!response.ok) throw new Error('weather request failed');
      const data = await response.json();
      const current = data.current || {};
      const temperature = Math.round(Number(current.temperature_2m));
      const maximum = Math.round(Number(data.daily?.temperature_2m_max?.[0]));
      const [description, icon] = weatherLabel(Number(current.weather_code));
      if (Number.isFinite(temperature) && weatherStrong) weatherStrong.textContent = `Prague · ${temperature}°C`;
      if (weatherSmall) weatherSmall.textContent = Number.isFinite(maximum) ? `${description} · до ${maximum}°C` : `${description} · сейчас`;
      if (weatherIcon) weatherIcon.textContent = icon;
    } catch (_) {
      // Keep the bundled text when the prototype is offline or the request times out.
    } finally {
      clearTimeout(timeout);
    }
  };
  updateDate();
  updateWeather();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { updateDate(); updateWeather(); } });
  document.addEventListener('click', (event) => {
    const screenButton = event.target.closest('[data-screen]');
    if (screenButton) go(screenButton.dataset.screen);
    const promptButton = event.target.closest('[data-prompt]');
    if (promptButton) ask(promptButton.dataset.prompt);
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'wear') { event.target.textContent = 'Образ надет ✓'; showToast('Образ отмечен как надетый'); }
    if (action === 'other') showToast('Подбираю другой вариант…');
    if (action === 'save') showToast('Образ сохранён');
    if (action === 'edit') document.querySelector('#edit-sheet').hidden = false;
    if (action === 'close-sheet') document.querySelector('#edit-sheet').hidden = true;
    if (action === 'apply-edit') { document.querySelector('#edit-sheet').hidden = true; showToast('Новый вариант готов'); }
    if (action === 'add-item') showToast('Вещь добавлена в гардероб');
    if (action === 'edit-item') showToast('Можно изменить детали вещи');
    if (action === 'logout') window.MettiAuth?.signOut();
    if (action === 'dismiss') event.target.closest('.hint').hidden = true;
    if (action === 'send') { const input = document.querySelector('#prompt-input'); const value = input.value.trim(); if (value) { input.value = ''; ask(value); } }
    if (action === 'send-chat') { const input = document.querySelector('#chat-input'); const value = input.value.trim(); if (value) { input.value = ''; addMessage(value, 'user'); setTimeout(() => addMessage('Поняла. Добавляю это в подборку.', 'assistant'), 250); } }
  });

  document.querySelectorAll('.wardrobe-item').forEach((item) => item.addEventListener('click', () => go('item')));
  document.querySelectorAll('[data-filter]').forEach((tab) => tab.addEventListener('click', () => {
    tab.parentElement.querySelectorAll('[data-filter]').forEach((item) => item.classList.remove('selected'));
    tab.classList.add('selected');
    const filter = tab.dataset.filter;
    document.querySelectorAll('.wardrobe-item').forEach((item) => { item.hidden = filter !== 'all' && item.dataset.category !== filter; });
  }));
  document.querySelector('.search-box input')?.addEventListener('input', (event) => {
    const query = event.target.value.trim().toLowerCase();
    document.querySelectorAll('.wardrobe-item').forEach((item) => { item.hidden = query.length > 0 && !item.textContent.toLowerCase().includes(query); });
  });
})();
