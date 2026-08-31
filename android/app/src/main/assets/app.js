(() => {
  const supabase = window.MettiSupabase;
  const phone = document.querySelector('.phone');
  const appScroll = document.querySelector('.app-scroll');
  const toast = document.querySelector('#toast');
  const dateNode = document.querySelector('.screen[data-screen-id="home"] .eyebrow');
  const weatherCard = document.querySelector('.screen[data-screen-id="home"] .weather-card');
  const weatherStrong = weatherCard?.querySelector('strong');
  const weatherSmall = weatherCard?.querySelector('small');
  const weatherIcon = weatherCard?.querySelector('.weather-icon');
  const weatherUrl = 'https://api.open-meteo.com/v1/forecast?latitude=50.0755&longitude=14.4375&current=temperature_2m,weather_code&daily=temperature_2m_max&forecast_days=1&timezone=Europe%2FPrague';
  const demoMode = new URLSearchParams(window.location.search).get('demo') === '1';
  const state = {
    user: null,
    profile: null,
    wardrobe: [],
    outfits: [],
    activeItem: null,
    currentOutfit: null,
    activeLooksTab: 'recommended',
    weather: { temperature_c: 18, weather_code: 3, city: 'Prague' },
    requestNumber: 0
  };
  let toastTimer;

  const demoItems = [
    { id: 'demo-jacket', name: 'Бежевый жакет оверсайз', category: 'outer', color: 'Бежевый', season: 'Осень / Весна', photoClass: 'photo-jacket' },
    { id: 'demo-shirt', name: 'Белый топ', category: 'top', color: 'Молочный', season: 'Круглый год', photoClass: 'photo-shirt' },
    { id: 'demo-jeans', name: 'Прямые джинсы', category: 'bottom', color: 'Чёрный', season: 'Круглый год', photoClass: 'photo-jeans' },
    { id: 'demo-loafers', name: 'Коричневые лоферы', category: 'shoes', color: 'Коричневый', season: 'Осень / Весна', photoClass: 'photo-loafers' },
    { id: 'demo-bag', name: 'Сумка-тоут', category: 'accessory', color: 'Тауп', season: 'Круглый год', photoClass: 'photo-bag' },
    { id: 'demo-earrings', name: 'Золотые серьги', category: 'accessory', color: 'Золотой', season: 'Круглый год', photoClass: 'photo-earrings' },
    { id: 'demo-skirt', name: 'Чёрная миди-юбка', category: 'bottom', color: 'Чёрный', season: 'Круглый год', photoClass: 'photo-skirt' },
    { id: 'demo-sneakers', name: 'Белые кеды', category: 'shoes', color: 'Белый', season: 'Весна / Лето', photoClass: 'photo-sneakers' },
    { id: 'demo-scarf', name: 'Шёлковый платок', category: 'accessory', color: 'Пыльная слива', season: 'Круглый год', photoClass: 'photo-scarf' }
  ];
  const itemClass = (item) => {
    if (item?.photoClass) return item.photoClass;
    const value = `${item.name || ''} ${item.category || ''}`.toLowerCase();
    if (value.includes('жакет') || item.category === 'outer') return 'item-jacket photo-jacket';
    if (value.includes('джин') || value.includes('брюк') || item.category === 'bottom') return 'item-jeans photo-jeans';
    if (value.includes('лофер') || item.category === 'shoes') return 'item-loafers photo-loafers';
    if (value.includes('сум') || item.category === 'accessory' && value.includes('сум')) return 'item-bag photo-bag';
    if (value.includes('серьг')) return 'photo-earrings';
    return 'item-shirt photo-shirt';
  };
  const uuid = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `item-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const byId = (id) => document.getElementById(id);
  const defaultLooksMarkup = document.querySelector('.looks-grid')?.innerHTML || '';
  const setText = (selector, value) => { const node = document.querySelector(selector); if (node) node.textContent = value ?? ''; };
  const showToast = (message, type = '') => {
    if (!toast) return;
    toast.textContent = message;
    toast.className = `toast show${type ? ` ${type}` : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.className = 'toast'; }, 2200);
  };
  const setFormStatus = (id, message = '', type = '') => {
    const node = byId(id);
    if (!node) return;
    node.textContent = message;
    node.className = `auth-status${type ? ` ${type}` : ''}`;
  };
  const setBusy = (form, busy, label = 'Сохранить') => {
    const button = form?.querySelector('button[type="submit"]');
    if (!button) return;
    if (busy) {
      button.dataset.label = button.innerHTML;
      button.innerHTML = 'Секунду…';
      button.disabled = true;
    } else {
      button.innerHTML = button.dataset.label || label;
      button.disabled = false;
    }
  };
  const go = (screen, behavior = 'smooth') => {
    const target = document.querySelector(`.screen[data-screen-id="${screen}"]`);
    if (!target) return;
    document.querySelectorAll('.screen').forEach((item) => item.classList.toggle('active', item === target));
    document.querySelectorAll('.bottom-nav button').forEach((item) => {
      const active = item.dataset.screen === screen;
      item.classList.toggle('active', active);
      if (active) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
    });
    if (appScroll) appScroll.scrollTo({ top: 0, behavior }); else phone?.scrollTo({ top: 0, behavior });
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
  const updateDate = () => {
    if (!dateNode) return;
    const now = new Date();
    const options = { timeZone: 'Europe/Prague' };
    const weekday = new Intl.DateTimeFormat('ru-RU', { ...options, weekday: 'long' }).format(now).toUpperCase();
    const day = new Intl.DateTimeFormat('ru-RU', { ...options, day: 'numeric' }).format(now);
    const month = new Intl.DateTimeFormat('ru-RU', { ...options, month: 'short' }).format(now).replace(/\./g, '').toUpperCase();
    dateNode.textContent = `${weekday} · ${day} ${month}`;
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
      const code = Number(current.weather_code);
      const [description, icon] = weatherLabel(code);
      state.weather = { temperature_c: temperature, weather_code: code, city: state.profile?.city || 'Prague' };
      if (Number.isFinite(temperature) && weatherStrong) weatherStrong.textContent = `${state.weather.city} · ${temperature}°C`;
      if (weatherSmall) weatherSmall.textContent = Number.isFinite(maximum) ? `${description} · до ${maximum}°C` : `${description} · сейчас`;
      if (weatherIcon) weatherIcon.textContent = icon;
    } catch (_) {
      // Keep the bundled text when the prototype is offline or the request times out.
    } finally { clearTimeout(timeout); }
  };

  const profileName = () => state.profile?.display_name || state.user?.user_metadata?.full_name || state.user?.email?.split('@')[0] || 'Наталия';
  const styleTags = () => Array.isArray(state.profile?.style_tags) && state.profile.style_tags.length ? state.profile.style_tags : ['Спокойный', 'Элегантный'];
  const renderProfile = () => {
    const name = profileName();
    const city = state.profile?.city || 'Prague';
    const tags = styleTags();
    const styleLabel = tags.slice(0, 2).join(' · ');
    setText('.screen[data-screen-id="profile"] .profile-heading h1', name);
    setText('.screen[data-screen-id="profile"] .profile-card-copy strong', name);
    setText('.screen[data-screen-id="profile"] .profile-card-copy small', styleLabel);
    setText('.screen[data-screen-id="profile"] .profile-style-card strong', styleLabel);
    setText('.screen[data-screen-id="profile"] .profile-style-card small', `Подходит для ${city}, работы и встреч.`);
    document.querySelectorAll('.profile-style-chips span').forEach((chip, index) => { chip.textContent = tags[index] || ''; chip.hidden = !tags[index]; });
    document.querySelectorAll('.profile-hero-avatar,.profile-button,.large-avatar').forEach((node) => { node.textContent = name.slice(0, 1).toUpperCase(); });
    const count = state.wardrobe.length;
    setText('#wardrobe-count', `${count} ${count === 1 ? 'вещь' : count >= 2 && count <= 4 ? 'вещи' : 'вещей'}`);
    document.querySelectorAll('.profile-menu-row strong').forEach((node, index) => { if (index === 0) node.textContent = String(count); if (index === 1) node.textContent = String(state.outfits.length); });
  };
  const imageUrl = async (path) => {
    if (!path || !supabase?.data?.createWardrobeImageUrl) return '';
    try { return await supabase.data.createWardrobeImageUrl(path); } catch (_) { return ''; }
  };
  const addImageBackground = async (node, path) => {
    const url = await imageUrl(path);
    if (!url || !node?.isConnected) return;
    // The editorial placeholder classes use !important background rules. Set the
    // signed private image with the same priority so uploaded photos win.
    node.style.setProperty('background-image', `url("${url.replace(/"/g, '\\"')}")`, 'important');
    node.classList.add('has-image');
  };
  const renderWardrobe = async () => {
    const grid = byId('wardrobe-grid');
    if (!grid) return;
    const items = state.wardrobe;
    const empty = byId('wardrobe-empty');
    grid.innerHTML = '';
    if (!items.length) { empty?.classList.add('show'); renderProfile(); return; }
    empty?.classList.remove('show');
    items.forEach((item) => {
      const button = document.createElement('button');
      button.className = 'wardrobe-item';
      button.type = 'button';
      button.dataset.itemId = item.id;
      button.dataset.category = item.category || 'accessory';
      const art = document.createElement('div');
      art.className = `item-art ${itemClass(item)}`;
      const label = document.createElement('span');
      label.textContent = item.name || 'Вещь';
      art.append(label); button.append(art); grid.append(button);
      if (item.image_path) addImageBackground(art, item.image_path);
    });
    renderProfile();
  };
  const renderDetail = async (item) => {
    if (!item) return;
    state.activeItem = item;
    const art = document.querySelector('.item-detail-art');
    if (art) {
      art.className = `item-detail-art placeholder ${itemClass(item)}`;
      art.innerHTML = '';
      const label = document.createElement('span'); label.textContent = item.name || 'Вещь'; art.append(label);
      if (item.image_path) addImageBackground(art, item.image_path);
    }
    setText('.screen[data-screen-id="item"] .detail-title', item.name || 'Вещь');
    const chips = document.querySelector('.detail-chips');
    if (chips) {
      chips.innerHTML = '';
      [item.category, item.color, item.size, item.season].filter(Boolean).slice(0, 4).forEach((value) => { const node = document.createElement('span'); node.textContent = value; chips.append(node); });
    }
    const addButton = document.querySelector('[data-action="add-item"]');
    if (addButton) addButton.textContent = item.id && !String(item.id).startsWith('demo-') ? 'В гардеробе ✓' : 'Добавить в гардероб';
    await imageUrl(item.image_path);
  };
  const prepareWardrobeImage = async (file) => {
    if (!file || !String(file.type || '').startsWith('image/') || /heic|heif/i.test(file.type || '')) return file;
    const objectUrl = URL.createObjectURL(file);
    let canvas;
    let output;
    try {
      const image = await new Promise((resolve, reject) => {
        const node = new Image();
        node.onload = () => resolve(node);
        node.onerror = reject;
        node.src = objectUrl;
      });
      const sourceWidth = image.naturalWidth || image.width;
      const sourceHeight = image.naturalHeight || image.height;
      if (!sourceWidth || !sourceHeight) return file;
      const scale = Math.min(1, 1400 / Math.max(sourceWidth, sourceHeight));
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) return file;
      context.drawImage(image, 0, 0, width, height);
      const imageData = context.getImageData(0, 0, width, height);
      const pixels = imageData.data;
      let hasTransparency = false;
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] < 250) { hasTransparency = true; break; }
      }
      if (!hasTransparency) {
        const samples = [];
        const step = Math.max(1, Math.floor(Math.max(width, height) / 32));
        const sample = (x, y) => {
          const index = (y * width + x) * 4;
          samples.push([pixels[index], pixels[index + 1], pixels[index + 2]]);
        };
        for (let x = 0; x < width; x += step) { sample(x, 0); sample(x, height - 1); }
        for (let y = step; y < height; y += step) { sample(0, y); sample(width - 1, y); }
        const background = samples.reduce((sum, value) => [sum[0] + value[0], sum[1] + value[1], sum[2] + value[2]], [0, 0, 0]).map((value) => value / Math.max(1, samples.length));
        const thresholdSquared = 58 * 58;
        const mask = new Uint8Array(width * height);
        const queue = new Int32Array(width * height);
        let head = 0; let tail = 0;
        const closeToBackground = (pixelIndex) => {
          const index = pixelIndex * 4;
          const red = pixels[index] - background[0];
          const green = pixels[index + 1] - background[1];
          const blue = pixels[index + 2] - background[2];
          return red * red + green * green + blue * blue <= thresholdSquared;
        };
        const mark = (pixelIndex) => {
          if (mask[pixelIndex] || !closeToBackground(pixelIndex)) return;
          mask[pixelIndex] = 1; queue[tail++] = pixelIndex;
        };
        for (let x = 0; x < width; x += 1) { mark(x); mark((height - 1) * width + x); }
        for (let y = 1; y < height - 1; y += 1) { mark(y * width); mark(y * width + width - 1); }
        while (head < tail) {
          const pixelIndex = queue[head++];
          const x = pixelIndex % width;
          if (x > 0) mark(pixelIndex - 1);
          if (x < width - 1) mark(pixelIndex + 1);
          if (pixelIndex >= width) mark(pixelIndex - width);
          if (pixelIndex < width * (height - 1)) mark(pixelIndex + width);
        }
        for (let i = 0; i < mask.length; i += 1) {
          if (mask[i]) pixels[i * 4 + 3] = 0;
        }
        context.putImageData(imageData, 0, 0);
      }
      output = document.createElement('canvas');
      output.width = width; output.height = height;
      const outputContext = output.getContext('2d');
      if (!outputContext) return file;
      outputContext.fillStyle = '#ffffff';
      outputContext.fillRect(0, 0, width, height);
      outputContext.drawImage(canvas, 0, 0);
      const blob = await new Promise((resolve) => output.toBlob(resolve, 'image/jpeg', 0.9));
      if (!blob) return file;
      return new File([blob], `${String(file.name || 'wardrobe').replace(/\.[^.]+$/, '')}-white.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
    } catch (_) {
      return file;
    } finally {
      URL.revokeObjectURL(objectUrl);
      if (canvas) { canvas.width = 0; canvas.height = 0; }
      if (output) { output.width = 0; output.height = 0; }
    }
  };
  const renderOutfitCards = (outfits) => {
    const grid = document.querySelector('.looks-grid');
    if (!grid) return;
    const artClasses = ['look-evening', 'look-office', 'look-walk', 'look-trip'];
    grid.innerHTML = '';
    outfits.forEach((outfit, index) => {
      const button = document.createElement('button');
      button.className = `look-item${index % 2 ? ' offset' : ''}`;
      button.type = 'button';
      button.dataset.screen = 'result';
      if (outfit.id) button.dataset.outfitId = outfit.id;
      const art = document.createElement('div');
      art.className = `look-art ${artClasses[index % artClasses.length]}`;
      const badge = document.createElement('span');
      badge.textContent = outfit.is_worn ? 'Надето' : 'Сохранено';
      const title = document.createElement('strong');
      title.textContent = outfit.title || 'Образ на сегодня';
      art.append(badge); button.append(art, title); grid.append(button);
    });
  };
  const renderLooks = () => {
    const note = byId('looks-data-note');
    const grid = document.querySelector('.looks-grid');
    if (!note || !grid) return;
    const tab = state.activeLooksTab || 'recommended';
    document.querySelectorAll('.look-tabs [data-look-tab]').forEach((button) => button.classList.toggle('selected', button.dataset.lookTab === tab));
    if (tab === 'recommended') {
      grid.innerHTML = defaultLooksMarkup;
      grid.hidden = false;
      if (!state.outfits.length) { note.classList.remove('show'); return; }
      const worn = state.outfits.filter((outfit) => outfit.is_worn).length;
      note.textContent = `${state.outfits.length} сохранённых образа${worn ? ` · ${worn} надето` : ''}`;
      note.classList.add('show');
      return;
    }
    const matches = tab === 'worn' ? state.outfits.filter((outfit) => outfit.is_worn) : state.outfits;
    if (!matches.length) {
      grid.innerHTML = '';
      grid.hidden = true;
      note.textContent = tab === 'worn' ? 'Надетых образов пока нет.' : 'Сохранённых образов пока нет.';
      note.classList.add('show');
      return;
    }
    renderOutfitCards(matches);
    grid.hidden = false;
    note.textContent = tab === 'worn' ? `Надетых образов: ${matches.length}` : `Сохранённых образов: ${matches.length}`;
    note.classList.add('show');
  };
  const loadData = async () => {
    if (!state.user || !supabase?.data) return;
    const [wardrobe, outfits, profile] = await Promise.allSettled([supabase.data.listWardrobe(), supabase.data.listSavedOutfits(), supabase.data.getProfile()]);
    if (wardrobe.status === 'fulfilled') state.wardrobe = wardrobe.value || [];
    else showToast('Не удалось загрузить гардероб', 'error');
    if (outfits.status === 'fulfilled') state.outfits = outfits.value || [];
    else showToast('Не удалось загрузить образы', 'error');
    if (profile.status === 'fulfilled') state.profile = profile.value;
    if (!state.profile) {
      state.profile = { id: state.user.id, display_name: state.user.user_metadata?.full_name || state.user.email?.split('@')[0] || 'Наталия', city: 'Prague', preferences: {}, style_tags: ['Спокойный', 'Элегантный'], style_profile: {} };
      supabase.data.saveProfile(state.profile).catch(() => {});
    }
    renderProfile(); await renderWardrobe(); renderLooks(); updateWeather();
  };
  const seedDemo = () => { state.wardrobe = [...demoItems]; state.profile = { display_name: 'Наталия', city: 'Prague', style_tags: ['Спокойный', 'Элегантный'] }; state.outfits = []; renderProfile(); renderWardrobe(); renderLooks(); };

  const openWardrobeSheet = (item = null) => {
    const backdrop = byId('wardrobe-sheet'); const form = byId('wardrobe-form'); if (!backdrop || !form) return;
    const persistedItem = item && !String(item.id).startsWith('demo-');
    form.dataset.itemId = persistedItem ? item.id : '';
    byId('wardrobe-form-title').textContent = persistedItem ? 'Изменить вещь' : 'Новая вещь';
    ['name','color','size','season','brand','notes'].forEach((name) => { if (form.elements[name]) form.elements[name].value = item?.[name] || ''; });
    if (form.elements.category) form.elements.category.value = item?.category || 'outer';
    if (form.elements.image) form.elements.image.value = '';
    setFormStatus('wardrobe-form-status'); backdrop.hidden = false; document.body.classList.add('modal-open');
    setTimeout(() => form.elements.name?.focus(), 0);
  };
  const closeWardrobeSheet = () => { const node = byId('wardrobe-sheet'); if (node) node.hidden = true; document.body.classList.remove('modal-open'); };
  const saveWardrobeForm = async (event) => {
    event.preventDefault(); const form = event.currentTarget;
    const name = form.elements.name.value.trim(); const category = form.elements.category.value;
    if (!name) return setFormStatus('wardrobe-form-status', 'Введите название вещи.', 'error');
    if (!state.user || !supabase?.data) return setFormStatus('wardrobe-form-status', 'Войдите, чтобы сохранять вещи.', 'error');
    // Demo cards are only templates; when opened from a demo card, create a
    // new persisted item instead of trying to update the demo id.
    const existing = state.wardrobe.find((item) => item.id === form.dataset.itemId && !String(item.id).startsWith('demo-'));
    const file = form.elements.image.files?.[0];
    if (file && file.size > 5 * 1024 * 1024) return setFormStatus('wardrobe-form-status', 'Файл должен быть меньше 5 МБ.', 'error');
    setBusy(form, true); setFormStatus('wardrobe-form-status', file ? 'Подготавливаю белый фон…' : 'Сохраняю…');
    let newPath = existing?.image_path || null;
    try {
      const processedFile = file ? await prepareWardrobeImage(file) : null;
      if (processedFile && processedFile.size > 5 * 1024 * 1024) throw new Error('После обработки файл получился больше 5 МБ. Выберите фото поменьше.');
      if (processedFile) { setFormStatus('wardrobe-form-status', 'Загружаю фотографию…'); newPath = await supabase.data.uploadWardrobeImage(processedFile, state.user.id, existing?.id || uuid()); }
      const payload = { user_id: state.user.id, name, category, color: form.elements.color.value.trim() || null, size: form.elements.size.value.trim() || null, season: form.elements.season.value.trim() || null, brand: form.elements.brand.value.trim() || null, notes: form.elements.notes.value.trim() || null, image_path: newPath, metadata: existing?.metadata || {} };
      const saved = existing ? await supabase.data.updateWardrobeItem(existing.id, payload) : await supabase.data.saveWardrobeItem(payload);
      if (!saved) throw new Error('Вещь не вернулась из Supabase.');
      if (existing?.image_path && newPath && existing.image_path !== newPath) await supabase.data.removeWardrobeImage(existing.image_path).catch(() => {});
      const index = state.wardrobe.findIndex((item) => item.id === existing?.id);
      if (index >= 0) state.wardrobe[index] = saved; else state.wardrobe.unshift(saved);
      closeWardrobeSheet(); await renderWardrobe(); renderProfile(); showToast(existing ? 'Вещь обновлена' : 'Вещь добавлена', 'success');
    } catch (error) {
      if (newPath && newPath !== existing?.image_path) await supabase.data.removeWardrobeImage(newPath).catch(() => {});
      setFormStatus('wardrobe-form-status', error?.message || 'Не удалось сохранить вещь.', 'error');
    } finally { setBusy(form, false); }
  };
  const deleteActiveItem = async () => {
    const item = state.activeItem; if (!item) return;
    if (!window.confirm(`Удалить «${item.name || 'эту вещь'}»?`)) return;
    try {
      if (state.user && supabase?.data && !String(item.id).startsWith('demo-')) {
        await supabase.data.deleteWardrobeItem(item.id);
        if (item.image_path) await supabase.data.removeWardrobeImage(item.image_path).catch(() => {});
      }
      state.wardrobe = state.wardrobe.filter((value) => value.id !== item.id); state.activeItem = null;
      await renderWardrobe(); renderProfile(); go('wardrobe'); showToast('Вещь удалена', 'success');
    } catch (error) { showToast(error?.message || 'Не удалось удалить вещь', 'error'); }
  };

  const openProfileSheet = () => {
    const form = byId('profile-form'); const profile = state.profile || {}; if (!form) return;
    const preferences = profile.preferences && typeof profile.preferences === 'object' ? profile.preferences : {};
    form.elements.display_name.value = profileName(); form.elements.city.value = profile.city || 'Prague'; form.elements.style_tags.value = (profile.style_tags || []).join(', '); form.elements.favorite_colors.value = Array.isArray(preferences.favorite_colors) ? preferences.favorite_colors.join(', ') : (preferences.favorite_colors || ''); form.elements.fit.value = profile.style_profile?.fit || ''; form.elements.size.value = profile.style_profile?.size || ''; form.elements.preferences.value = preferences.note || '';
    setFormStatus('profile-form-status'); byId('profile-sheet').hidden = false; document.body.classList.add('modal-open'); setTimeout(() => form.elements.display_name?.focus(), 0);
  };
  const closeProfileSheet = () => { const node = byId('profile-sheet'); if (node) node.hidden = true; document.body.classList.remove('modal-open'); };
  const openDeleteAccountSheet = () => {
    const node = byId('delete-account-sheet'); if (!node) return;
    setFormStatus('delete-account-status'); node.hidden = false; document.body.classList.add('modal-open');
    setTimeout(() => node.querySelector('[data-action="close-delete-account"]')?.focus(), 0);
  };
  const closeDeleteAccountSheet = () => { const node = byId('delete-account-sheet'); if (node) node.hidden = true; document.body.classList.remove('modal-open'); };
  const confirmDeleteAccount = async (button) => {
    if (!state.user || !supabase?.data?.deleteAccount) return setFormStatus('delete-account-status', 'Войдите, чтобы удалить аккаунт.', 'error');
    button.disabled = true; button.textContent = 'Удаляем…'; setFormStatus('delete-account-status', 'Удаляю профиль и данные…');
    try {
      await supabase.data.deleteAccount();
      closeDeleteAccountSheet(); state.user = null; state.profile = null; state.wardrobe = []; state.outfits = [];
      await window.MettiAuth?.signOut(); showToast('Аккаунт удалён', 'success');
    } catch (error) {
      button.disabled = false; button.textContent = 'Удалить аккаунт';
      setFormStatus('delete-account-status', error?.message || 'Не удалось удалить аккаунт.', 'error');
    }
  };
  const openStyleSheet = () => {
    const form = byId('style-form'); const profile = state.profile || {}; if (!form) return;
    const preferences = profile.preferences && typeof profile.preferences === 'object' ? profile.preferences : {};
    form.elements.style_tags.value = (profile.style_tags || []).join(', ');
    form.elements.favorite_colors.value = Array.isArray(preferences.favorite_colors) ? preferences.favorite_colors.join(', ') : (preferences.favorite_colors || '');
    form.elements.fit.value = profile.style_profile?.fit || '';
    form.elements.size.value = profile.style_profile?.size || '';
    form.elements.preferences.value = preferences.note || '';
    setFormStatus('style-form-status'); byId('style-sheet').hidden = false; document.body.classList.add('modal-open');
    setTimeout(() => form.elements.style_tags?.focus(), 0);
  };
  const closeStyleSheet = () => { const node = byId('style-sheet'); if (node) node.hidden = true; document.body.classList.remove('modal-open'); };
  const saveProfileForm = async (event) => {
    event.preventDefault(); const form = event.currentTarget; const displayName = form.elements.display_name.value.trim(); const city = form.elements.city.value.trim();
    if (!displayName || !city) return setFormStatus('profile-form-status', 'Заполните имя и город.', 'error');
    if (!state.user || !supabase?.data) return setFormStatus('profile-form-status', 'Войдите, чтобы сохранять профиль.', 'error');
    setBusy(form, true); setFormStatus('profile-form-status', 'Сохраняю…');
    try {
      const tags = form.elements.style_tags.value.split(',').map((value) => value.trim()).filter(Boolean).slice(0, 5);
      const favoriteColors = form.elements.favorite_colors.value.split(',').map((value) => value.trim()).filter(Boolean).slice(0, 8);
      const payload = { id: state.user.id, display_name: displayName, city, style_tags: tags, preferences: { ...(state.profile?.preferences || {}), favorite_colors: favoriteColors, note: form.elements.preferences.value.trim() }, style_profile: { ...(state.profile?.style_profile || {}), fit: form.elements.fit.value || null, size: form.elements.size.value.trim() || null } };
      state.profile = await supabase.data.saveProfile(payload); closeProfileSheet(); renderProfile(); updateWeather(); showToast('Профиль сохранён', 'success');
    } catch (error) { setFormStatus('profile-form-status', error?.message || 'Не удалось сохранить профиль.', 'error'); } finally { setBusy(form, false); }
  };
  const saveStyleForm = async (event) => {
    event.preventDefault(); const form = event.currentTarget;
    if (!state.user || !supabase?.data) return setFormStatus('style-form-status', 'Войдите, чтобы сохранять настройки стилиста.', 'error');
    setBusy(form, true); setFormStatus('style-form-status', 'Сохраняю…');
    try {
      const tags = form.elements.style_tags.value.split(',').map((value) => value.trim()).filter(Boolean).slice(0, 5);
      const favoriteColors = form.elements.favorite_colors.value.split(',').map((value) => value.trim()).filter(Boolean).slice(0, 8);
      const currentPreferences = state.profile?.preferences && typeof state.profile.preferences === 'object' ? state.profile.preferences : {};
      const payload = { id: state.user.id, display_name: profileName(), city: state.profile?.city || 'Prague', style_tags: tags, preferences: { ...currentPreferences, favorite_colors: favoriteColors, note: form.elements.preferences.value.trim() }, style_profile: { ...(state.profile?.style_profile || {}), fit: form.elements.fit.value || null, size: form.elements.size.value.trim() || null } };
      state.profile = await supabase.data.saveProfile(payload); closeStyleSheet(); renderProfile(); updateWeather(); showToast('Настройки стилиста сохранены', 'success');
    } catch (error) { setFormStatus('style-form-status', error?.message || 'Не удалось сохранить настройки.', 'error'); } finally { setBusy(form, false); }
  };

  const addMessage = (text, role) => { const log = byId('chat-log'); if (!log) return null; const node = document.createElement('div'); node.className = `message ${role}`; node.textContent = text; log.append(node); log.scrollTop = log.scrollHeight; return node; };
  const setThinking = (visible) => { const node = document.querySelector('.chat-log .thinking'); if (node) node.hidden = !visible; };
  const fallbackOutfit = (prompt) => ({ title: prompt || 'Образ на сегодня', note: 'Собрала спокойный вариант из вещей, которые уже есть в вашем гардеробе.', item_ids: state.wardrobe.slice(0, 4).map((item) => item.id), temperature_c: state.weather.temperature_c, weather_code: state.weather.weather_code, message: 'С удовольствием. Учитываю погоду и ваш гардероб — собрала спокойный, элегантный вариант.' });
  const renderResult = async (outfit = state.currentOutfit) => {
    if (!outfit) return;
    setText('.screen[data-screen-id="result"] h1', outfit.title || 'Образ на сегодня'); setText('.screen[data-screen-id="result"] .result-note p', `«${outfit.note || 'Собрала этот образ с учётом погоды и вашего гардероба.'}»`);
    const selected = (outfit.item_ids || []).map((id) => state.wardrobe.find((item) => item.id === id)).filter(Boolean);
    const hero = document.querySelector('.result-hero');
    if (hero) {
      const item = selected[0] || state.wardrobe[0]; hero.className = `result-hero placeholder tall ${item ? itemClass(item) : 'photo-outfit'}`; hero.innerHTML = `<span>${item?.name || 'структурный жакет'}</span>`; if (item?.image_path) addImageBackground(hero, item.image_path);
    }
    const grid = document.querySelector('.result-grid'); if (!grid) return;
    grid.innerHTML = '';
    selected.slice(1, 5).forEach((item) => { const node = document.createElement('div'); node.className = `placeholder ${itemClass(item)}`; const label = document.createElement('span'); label.textContent = item.name; node.append(label); grid.append(node); if (item.image_path) addImageBackground(node, item.image_path); });
  };
  const saveCurrentOutfit = async (worn = false) => {
    if (!state.currentOutfit) state.currentOutfit = fallbackOutfit('Образ на сегодня');
    if (!state.user || !supabase?.data) return showToast('Войдите, чтобы сохранять образы', 'error');
    const base = { user_id: state.user.id, title: state.currentOutfit.title || 'Образ на сегодня', note: state.currentOutfit.note || null, temperature_c: state.currentOutfit.temperature_c ?? state.weather.temperature_c, weather_code: state.currentOutfit.weather_code ?? state.weather.weather_code, item_ids: state.currentOutfit.item_ids || [], prompt: state.currentOutfit.prompt || null, is_worn: worn, worn_at: worn ? new Date().toISOString() : null, metadata: state.currentOutfit.metadata || {} };
    try {
      const saved = state.currentOutfit.id ? await supabase.data.updateOutfit(state.currentOutfit.id, { is_worn: worn, worn_at: base.worn_at }) : await supabase.data.saveOutfit(base);
      state.currentOutfit = { ...state.currentOutfit, ...saved }; const existing = state.outfits.findIndex((item) => item.id === saved?.id); if (existing >= 0) state.outfits[existing] = state.currentOutfit; else if (saved) state.outfits.unshift(state.currentOutfit); renderLooks(); showToast(worn ? 'Образ отмечен как надетый' : 'Образ сохранён', 'success');
    } catch (error) { showToast(error?.message || 'Не удалось сохранить образ', 'error'); }
  };
  const ask = async (prompt) => {
    const clean = String(prompt || '').trim(); if (!clean) return;
    go('chat'); addMessage(clean, 'user'); setThinking(true); const requestId = ++state.requestNumber; showToast('Metti собирает образ…');
    try {
      let result;
      if (state.user && supabase?.data?.invokeStylist) result = await supabase.data.invokeStylist({ prompt: clean, weather: state.weather, wardrobe: state.wardrobe.map(({ id, name, category, color, size, season, brand, notes }) => ({ id, name, category, color, size, season, brand, notes })), profile: state.profile });
      else result = fallbackOutfit(clean);
      if (requestId !== state.requestNumber) return;
      state.currentOutfit = { ...result, prompt: clean }; setThinking(false); addMessage(result.message || 'Готово — образ собран из вашего гардероба.', 'assistant'); await renderResult(state.currentOutfit); setTimeout(() => go('result'), 350);
    } catch (error) {
      setThinking(false); addMessage('Не получилось связаться со стилистом. Проверьте подключение и попробуйте ещё раз.', 'assistant'); showToast(error?.message || 'AI-стилист временно недоступен', 'error');
    }
  };

  document.addEventListener('click', (event) => {
    const looksTab = event.target.closest('[data-look-tab]'); if (looksTab) { state.activeLooksTab = looksTab.dataset.lookTab || 'recommended'; renderLooks(); return; }
    const outfitButton = event.target.closest('[data-outfit-id]'); if (outfitButton) { const outfit = state.outfits.find((value) => value.id === outfitButton.dataset.outfitId); if (outfit) { state.currentOutfit = outfit; renderResult(outfit); go('result'); } return; }
    const screenButton = event.target.closest('[data-screen]'); if (screenButton) { const id = screenButton.dataset.itemId || screenButton.closest('[data-item-id]')?.dataset.itemId; if (id) { const item = state.wardrobe.find((value) => value.id === id); if (item) { renderDetail(item); go('item'); return; } } go(screenButton.dataset.screen); return; }
    const itemButton = event.target.closest('[data-item-id]'); if (itemButton) { const item = state.wardrobe.find((value) => value.id === itemButton.dataset.itemId); if (item) { renderDetail(item); go('item'); } return; }
    const promptButton = event.target.closest('[data-prompt]'); if (promptButton) { ask(promptButton.dataset.prompt); return; }
    const tab = event.target.closest('[data-filter]'); if (tab) { tab.parentElement.querySelectorAll('[data-filter]').forEach((item) => item.classList.remove('selected')); tab.classList.add('selected'); const filter = tab.dataset.filter; document.querySelectorAll('.wardrobe-item').forEach((item) => { item.hidden = filter !== 'all' && item.dataset.category !== filter; }); return; }
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'wear') { event.target.textContent = 'Образ надет ✓'; saveCurrentOutfit(true); }
    if (action === 'other') ask('Другой вариант образа');
    if (action === 'save') saveCurrentOutfit(false);
    if (action === 'edit') byId('edit-sheet').hidden = false;
    if (action === 'close-sheet') byId('edit-sheet').hidden = true;
    if (action === 'apply-edit') { byId('edit-sheet').hidden = true; showToast('Новый вариант готов'); }
    if (action === 'open-add-item') openWardrobeSheet();
    if (action === 'add-item') {
      const item = state.activeItem;
      if (!item) return;
      if (!String(item.id).startsWith('demo-')) return showToast('Вещь уже в гардеробе');
      openWardrobeSheet(item);
    }
    if (action === 'edit-item') openWardrobeSheet(state.activeItem);
    if (action === 'delete-item') deleteActiveItem();
    if (action === 'close-wardrobe-sheet') closeWardrobeSheet();
    if (action === 'profile-edit') openProfileSheet();
    if (action === 'close-profile-sheet') closeProfileSheet();
    if (action === 'open-delete-account') openDeleteAccountSheet();
    if (action === 'close-delete-account') closeDeleteAccountSheet();
    if (action === 'confirm-delete-account') confirmDeleteAccount(event.target.closest('[data-action="confirm-delete-account"]'));
    if (action === 'style-edit') openStyleSheet();
    if (action === 'close-style-sheet') closeStyleSheet();
    if (action === 'logout') window.MettiAuth?.signOut();
    if (action === 'dismiss') event.target.closest('.hint').hidden = true;
    if (action === 'send') { const input = byId('prompt-input'); const value = input.value.trim(); if (value) { input.value = ''; ask(value); } }
    if (action === 'send-chat') { const input = byId('chat-input'); const value = input.value.trim(); if (value) { input.value = ''; ask(value); } }
  });
  byId('wardrobe-form')?.addEventListener('submit', saveWardrobeForm);
  byId('wardrobe-sheet')?.querySelectorAll('[data-action="close-wardrobe-sheet"]').forEach((button) => button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); closeWardrobeSheet(); }));
  byId('profile-form')?.addEventListener('submit', saveProfileForm);
  byId('style-form')?.addEventListener('submit', saveStyleForm);
  document.querySelector('.search-box input')?.addEventListener('input', (event) => { const query = event.target.value.trim().toLowerCase(); document.querySelectorAll('.wardrobe-item').forEach((item) => { item.hidden = query.length > 0 && !item.textContent.toLowerCase().includes(query); }); });
  document.querySelectorAll('.sheet-backdrop').forEach((node) => node.addEventListener('click', (event) => { if (event.target === node) { node.hidden = true; document.body.classList.remove('modal-open'); } }));
  window.addEventListener('metti:authenticated', async (event) => { state.user = event.detail?.user || supabase?.currentUser?.(); await loadData(); });
  window.addEventListener('metti:signed-out', () => { state.user = null; state.profile = null; state.wardrobe = []; state.outfits = []; });
  updateDate(); updateWeather();
  if (demoMode) seedDemo();
  else if (supabase?.auth) {
    supabase.auth.restoreSession().then(async (session) => { if (session) { state.user = session.user || supabase.currentUser?.(); if (!state.user) state.user = await supabase.auth.getUser().catch(() => null); await loadData(); } else if (!window.MettiAuth?.isOAuthPending?.()) window.MettiAuth?.show('login'); }).catch(() => { if (!window.MettiAuth?.isOAuthPending?.()) window.MettiAuth?.show('login'); });
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { updateDate(); updateWeather(); } });
})();
