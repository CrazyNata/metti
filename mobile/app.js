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
  const languageStorageKey = 'metti-language';
  const readLanguage = () => { try { return window.localStorage.getItem(languageStorageKey) === 'en' ? 'en' : 'ru'; } catch (_) { return 'ru'; } };
  const state = {
    user: null,
    profile: null,
    language: readLanguage(),
    wardrobe: [],
    wardrobeFilter: 'all',
    wardrobeSubcategory: 'all',
    outfits: [],
    activeItem: null,
    currentOutfit: null,
    stylistPhoto: null,
    activeLooksTab: 'recommended',
    weather: { temperature_c: 18, weather_code: 3, city: 'Prague' },
    requestNumber: 0
  };
  const EDITORIAL_IMAGE_BACKGROUND = 'metti-editorial-v3';
  const EDITORIAL_BACKGROUND_COLOR = '#f0e9df';
  const pendingImageNormalizations = new Set();
  const nativeImageRequests = new Map();
  const imageUrlCache = new Map();
  const imageUrlRequests = new Map();
  const IMAGE_URL_CACHE_TTL_MS = 50 * 60 * 1000;
  window.MettiImageProcessing = window.MettiImageProcessing || {};
  window.MettiImageProcessing.resolve = (requestId, processedUrl, errorMessage) => {
    const request = nativeImageRequests.get(requestId);
    if (!request) return;
    clearTimeout(request.timeout);
    nativeImageRequests.delete(requestId);
    if (errorMessage) request.reject(new Error(errorMessage));
    else request.resolve(processedUrl);
  };
  const isEditorialImageReady = (item) => Boolean(item?.image_path);
  let lastDataSyncAt = 0;
  let toastTimer;
  let activeMettiSelect = null;
  let mettiSelectId = 0;
  let screenHistory = [];
  let stylistVoiceRecognition = null;

  const wardrobeSubcategoryOptions = Object.freeze({
    top: Object.freeze([
      { value: 'tshirt', label: 'Футболки' },
      { value: 'sweater', label: 'Кофты' },
      { value: 'hoodie', label: 'Толстовки' },
      { value: 'blazer', label: 'Пиджаки' },
      { value: 'shirt', label: 'Рубашки' },
      { value: 'dress', label: 'Платья' },
      { value: 'outerwear', label: 'Верхняя одежда' }
    ]),
    bottom: Object.freeze([
      { value: 'skirt', label: 'Юбки' },
      { value: 'shorts', label: 'Шорты' },
      { value: 'pants', label: 'Штаны' },
      { value: 'jeans', label: 'Джинсы' }
    ]),
    shoes: Object.freeze([
      { value: 'sneakers', label: 'Кроссовки' },
      { value: 'pumps', label: 'Туфли' },
      { value: 'boots', label: 'Сапоги' },
      { value: 'ankle-boots', label: 'Ботинки' }
    ]),
    accessory: Object.freeze([
      { value: 'bag', label: 'Сумки' },
      { value: 'glasses', label: 'Очки' },
      { value: 'headwear', label: 'Головные уборы' },
      { value: 'jewelry', label: 'Бижутерия' }
    ])
  });
  const subcategoryAliases = Object.freeze({
    'верхняя одежда': 'outerwear',
    футболки: 'tshirt',
    кофты: 'sweater',
    толстовки: 'hoodie',
    пиджаки: 'blazer',
    рубашки: 'shirt',
    платья: 'dress',
    юбки: 'skirt',
    шорты: 'shorts',
    штаны: 'pants',
    джинсы: 'jeans',
    кроссовки: 'sneakers',
    туфли: 'pumps',
    сапоги: 'boots',
    ботинки: 'ankle-boots',
    сумки: 'bag',
    сумка: 'bag',
    очки: 'glasses',
    'головные уборы': 'headwear',
    бижутерия: 'jewelry'
  });
  const canonicalSubcategory = (value) => {
    const raw = String(value || '').trim();
    return subcategoryAliases[raw.toLowerCase()] || raw;
  };
  const categoryForItem = (item) => {
    const category = String(item?.category || '').trim().toLowerCase();
    if (category === 'outer') return 'top';
    return ['top', 'bottom', 'shoes', 'accessory'].includes(category) ? category : 'accessory';
  };
  const itemSubcategory = (item) => {
    const saved = canonicalSubcategory(item?.subcategory || item?.metadata?.subcategory);
    if (saved) return saved;
    if (item?.category === 'outer') return 'outerwear';
    const value = String(item?.name || '').toLowerCase();
    const category = categoryForItem(item);
    if (category === 'top') {
      if (value.includes('жакет') || value.includes('пидж')) return 'blazer';
      if (value.includes('рубаш')) return 'shirt';
      if (value.includes('толстов') || value.includes('худи')) return 'hoodie';
      if (value.includes('кофт') || value.includes('свитер') || value.includes('кардиган')) return 'sweater';
      if (value.includes('плать')) return 'dress';
      if (value.includes('пальто') || value.includes('куртк') || value.includes('плащ')) return 'outerwear';
      return 'tshirt';
    }
    if (category === 'bottom') {
      if (value.includes('юб')) return 'skirt';
      if (value.includes('шорт')) return 'shorts';
      if (value.includes('джин')) return 'jeans';
      return 'pants';
    }
    if (category === 'shoes') {
      if (value.includes('кед') || value.includes('крос')) return 'sneakers';
      if (value.includes('туф')) return 'pumps';
      if (value.includes('сапог')) return 'boots';
      return 'ankle-boots';
    }
    if (value.includes('сум')) return 'bag';
    if (value.includes('очк')) return 'glasses';
    if (value.includes('серьг') || value.includes('кольц') || value.includes('брас') || value.includes('цеп') || value.includes('украш')) return 'jewelry';
    return 'headwear';
  };
  const demoItems = [
    { id: 'demo-jacket', name: 'Бежевый жакет оверсайз', category: 'top', subcategory: 'blazer', color: 'Бежевый', season: 'Осень / Весна', photoClass: 'photo-jacket' },
    { id: 'demo-shirt', name: 'Белый топ', category: 'top', subcategory: 'tshirt', color: 'Молочный', season: 'Круглый год', photoClass: 'photo-shirt' },
    { id: 'demo-jeans', name: 'Прямые джинсы', category: 'bottom', subcategory: 'jeans', color: 'Чёрный', season: 'Круглый год', photoClass: 'photo-jeans' },
    { id: 'demo-loafers', name: 'Коричневые лоферы', category: 'shoes', subcategory: 'pumps', color: 'Коричневый', season: 'Осень / Весна', photoClass: 'photo-loafers' },
    { id: 'demo-bag', name: 'Сумка-тоут', category: 'accessory', subcategory: 'bag', color: 'Тауп', season: 'Круглый год', photoClass: 'photo-bag' },
    { id: 'demo-earrings', name: 'Золотые серьги', category: 'accessory', subcategory: 'jewelry', color: 'Золотой', season: 'Круглый год', photoClass: 'photo-earrings' },
    { id: 'demo-skirt', name: 'Чёрная миди-юбка', category: 'bottom', subcategory: 'skirt', color: 'Чёрный', season: 'Круглый год', photoClass: 'photo-skirt' },
    { id: 'demo-sneakers', name: 'Белые кеды', category: 'shoes', subcategory: 'sneakers', color: 'Белый', season: 'Весна / Лето', photoClass: 'photo-sneakers' },
    { id: 'demo-scarf', name: 'Шёлковый платок', category: 'accessory', subcategory: 'headwear', color: 'Пыльная слива', season: 'Круглый год', photoClass: 'photo-scarf' }
  ];
  const itemClass = (item) => {
    if (item?.photoClass) return item.photoClass;
    const value = `${item.name || ''} ${item.category || ''}`.toLowerCase();
    const subcategory = itemSubcategory(item);
    if (subcategory === 'bag' || value.includes('сум')) return 'item-bag photo-bag';
    if (subcategory === 'jewelry' || value.includes('серьг')) return 'photo-earrings';
    if (subcategory === 'headwear') return 'photo-scarf';
    if (value.includes('жакет') || item.category === 'outer' || ['blazer', 'outerwear'].includes(subcategory)) return 'item-jacket photo-jacket';
    if (value.includes('джин') || value.includes('брюк') || item.category === 'bottom') return 'item-jeans photo-jeans';
    if (value.includes('лофер') || item.category === 'shoes') return 'item-loafers photo-loafers';
    return 'item-shirt photo-shirt';
  };
  const pickOutfitItems = (items) => {
    const available = Array.isArray(items) ? items.filter((item) => item?.id) : [];
    const selected = [];
    const used = new Set();
    const take = (predicate) => {
      const item = available.find((value) => !used.has(String(value.id)) && predicate(value));
      if (!item) return null;
      used.add(String(item.id)); selected.push(item); return item;
    };
    const hero = take((item) => ['outerwear', 'blazer'].includes(itemSubcategory(item))) || take((item) => itemSubcategory(item) === 'dress') || take((item) => categoryForItem(item) === 'top');
    if (hero && itemSubcategory(hero) !== 'dress') take((item) => categoryForItem(item) === 'top' && !['outerwear', 'blazer', 'dress'].includes(itemSubcategory(item)));
    take((item) => categoryForItem(item) === 'bottom');
    take((item) => categoryForItem(item) === 'shoes');
    take((item) => categoryForItem(item) === 'accessory' && itemSubcategory(item) === 'bag');
    take((item) => categoryForItem(item) === 'accessory');
    available.forEach((item) => {
      if (selected.length >= 6 || used.has(String(item.id))) return;
      used.add(String(item.id)); selected.push(item);
    });
    return selected.slice(0, 6);
  };
  const outfitItemIds = (outfit) => Array.isArray(outfit?.item_ids) ? outfit.item_ids : Array.isArray(outfit?.itemIds) ? outfit.itemIds : [];
  const selectedOutfitItems = (outfit) => {
    const selected = outfitItemIds(outfit).map((id) => state.wardrobe.find((item) => String(item.id) === String(id))).filter(Boolean);
    return selected.length || outfit ? selected : [];
  };
  const collageSlots = (items) => {
    const available = Array.isArray(items) ? items.filter((item) => item?.id) : [];
    const used = new Set();
    const take = (predicate) => {
      const item = available.find((value) => !used.has(String(value.id)) && predicate(value));
      if (!item) return null;
      used.add(String(item.id)); return item;
    };
    const hero = take((item) => ['outerwear', 'blazer'].includes(itemSubcategory(item))) || take((item) => itemSubcategory(item) === 'dress') || take((item) => categoryForItem(item) === 'top') || take((item) => categoryForItem(item) === 'bottom') || take((item) => categoryForItem(item) === 'shoes') || take((item) => categoryForItem(item) === 'accessory');
    const top = itemSubcategory(hero) === 'dress' ? null : take((item) => categoryForItem(item) === 'top' && !['outerwear', 'blazer', 'dress'].includes(itemSubcategory(item)));
    const bottom = take((item) => categoryForItem(item) === 'bottom');
    const shoes = take((item) => categoryForItem(item) === 'shoes');
    const bag = take((item) => categoryForItem(item) === 'accessory' && itemSubcategory(item) === 'bag');
    const accent = take((item) => categoryForItem(item) === 'accessory');
    return { hero, top, bottom, shoes, bag, accent };
  };
  const uuid = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `item-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const byId = (id) => document.getElementById(id);
  const defaultLooksMarkup = document.querySelector('.looks-grid')?.innerHTML || '';
  const translate = (value) => window.MettiI18n?.t?.(value, state.language) ?? value;
  const applyLanguage = () => window.MettiI18n?.apply?.(state.language);
  const categoryLabel = (category) => ({ all: 'Все', outer: 'Верхняя одежда', top: 'Верх', bottom: 'Низ', shoes: 'Обувь', accessory: 'Аксессуары' }[category] || category);
  const subcategoryLabel = (value) => {
    const canonical = canonicalSubcategory(value);
    return Object.values(wardrobeSubcategoryOptions).flat().find((option) => option.value === canonical)?.label || value;
  };
  const filterSubcategoryOptions = (category) => category === 'all' ? [{ value: 'all', label: 'Все виды' }] : [{ value: 'all', label: 'Все виды' }, ...(wardrobeSubcategoryOptions[category] || [])];
  const mettiSelectLabel = (select) => {
    const label = select?.closest('label');
    const text = label ? Array.from(label.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join(' ').replace(/\s+/g, ' ').trim() : '';
    return text || select?.getAttribute('aria-label') || 'Выберите вариант';
  };
  const mettiSelectTitle = (select) => translate({ category: 'Выберите категорию', subcategory: 'Выберите вид', fit: 'Выберите посадку' }[select?.name] || 'Выберите вариант');
  const ensureMettiSelectSheet = () => {
    const existing = byId('metti-select-sheet');
    if (existing) return existing;
    const backdrop = document.createElement('div');
    backdrop.id = 'metti-select-sheet';
    backdrop.className = 'sheet-backdrop metti-select-backdrop';
    backdrop.hidden = true;
    backdrop.innerHTML = '<div class="data-sheet metti-select-data-sheet" role="dialog" aria-modal="true" aria-labelledby="metti-select-sheet-title"><div class="metti-select-sheet-handle" aria-hidden="true"></div><button class="data-sheet-close" type="button" data-action="close-metti-select" aria-label="Закрыть">×</button><h2 id="metti-select-sheet-title">Выберите вариант</h2><p id="metti-select-sheet-note" class="metti-select-sheet-note">Выберите один вариант</p><div id="metti-select-options" class="metti-select-options" role="listbox" aria-label="Варианты"></div></div>';
    document.body.append(backdrop);
    return backdrop;
  };
  const syncMettiSelectPicker = (select) => {
    if (!select || select.id === 'wardrobe-subcategory-filter' || select.dataset.mettiSelectEnhanced !== 'true') return;
    const trigger = select.previousElementSibling?.matches?.('.metti-select-trigger') ? select.previousElementSibling : null;
    if (!trigger) return;
    const value = trigger.querySelector('.metti-select-value');
    const selected = Array.from(select.options).find((option) => option.value === select.value) || select.options[select.selectedIndex] || select.options[0];
    if (value) value.textContent = selected ? selected.textContent.trim() : translate('Выберите вариант');
    trigger.setAttribute('aria-label', `${mettiSelectLabel(select)}: ${value?.textContent || ''}`.trim());
  };
  const syncMettiSelectPickers = () => document.querySelectorAll('select:not(#wardrobe-subcategory-filter)').forEach((select) => syncMettiSelectPicker(select));
  const ensureMettiSelectPicker = (select) => {
    if (!select || select.id === 'wardrobe-subcategory-filter' || select.dataset.mettiSelectEnhanced === 'true') return;
    if (!select.id) select.id = `metti-select-${++mettiSelectId}`;
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'metti-select-trigger';
    trigger.dataset.action = 'open-metti-select';
    trigger.dataset.mettiSelectTarget = select.id;
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', 'metti-select-sheet');
    const value = document.createElement('span');
    value.className = 'metti-select-value';
    const chevron = document.createElement('span');
    chevron.className = 'metti-select-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '⌄';
    trigger.append(value, chevron);
    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openMettiSelectSheet(select);
    });
    select.dataset.mettiSelectEnhanced = 'true';
    select.hidden = true;
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    select.parentNode?.insertBefore(trigger, select);
    syncMettiSelectPicker(select);
  };
  const ensureMettiSelectPickers = () => {
    ensureMettiSelectSheet();
    document.querySelectorAll('select:not(#wardrobe-subcategory-filter)').forEach((select) => ensureMettiSelectPicker(select));
    syncMettiSelectPickers();
  };
  const renderMettiSelectSheet = (select) => {
    const sheet = ensureMettiSelectSheet();
    const title = byId('metti-select-sheet-title');
    const note = byId('metti-select-sheet-note');
    const optionsNode = byId('metti-select-options');
    if (!sheet || !title || !note || !optionsNode || !select) return;
    title.textContent = mettiSelectTitle(select);
    note.textContent = translate('Выберите один вариант');
    optionsNode.setAttribute('aria-label', mettiSelectLabel(select));
    optionsNode.innerHTML = '';
    Array.from(select.options).forEach((option) => {
      const optionButton = document.createElement('button');
      const isSelected = option.value === select.value;
      optionButton.type = 'button';
      optionButton.className = `metti-select-option${isSelected ? ' is-selected' : ''}`;
      optionButton.dataset.mettiSelectOption = option.value;
      optionButton.setAttribute('role', 'option');
      optionButton.setAttribute('aria-selected', String(isSelected));
      optionButton.disabled = option.disabled;
      const optionLabel = document.createElement('span');
      optionLabel.textContent = translate(option.textContent.trim());
      const check = document.createElement('span');
      check.className = 'metti-select-check';
      check.setAttribute('aria-hidden', 'true');
      check.textContent = isSelected ? '✓' : '';
      optionButton.append(optionLabel, check);
      optionsNode.append(optionButton);
    });
  };
  const openMettiSelectSheet = (select) => {
    if (!select) return;
    activeMettiSelect = select;
    renderMettiSelectSheet(select);
    const sheet = byId('metti-select-sheet');
    if (!sheet) return;
    sheet.hidden = false;
    document.body.classList.add('modal-open');
    select.previousElementSibling?.setAttribute('aria-expanded', 'true');
    setTimeout(() => sheet.querySelector('.metti-select-option[aria-selected="true"]')?.focus(), 0);
  };
  const closeMettiSelectSheet = ({ restoreFocus = true } = {}) => {
    const select = activeMettiSelect;
    const sheet = byId('metti-select-sheet');
    if (sheet) sheet.hidden = true;
    activeMettiSelect = null;
    const trigger = select?.previousElementSibling?.matches?.('.metti-select-trigger') ? select.previousElementSibling : null;
    trigger?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger?.focus();
    if (!document.querySelector('.sheet-backdrop:not([hidden]), .sheet:not([hidden])')) document.body.classList.remove('modal-open');
  };
  const chooseMettiSelectOption = (value) => {
    const select = activeMettiSelect;
    if (!select) return;
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    syncMettiSelectPicker(select);
    closeMettiSelectSheet();
  };
  const ensureWardrobeSubcategoryPicker = () => {
    const select = byId('wardrobe-subcategory-filter');
    const source = select?.closest('.subcategory-filter');
    if (!select || !source) return;
    if (!byId('wardrobe-subcategory-trigger')) {
      const caption = Array.from(source.children).find((child) => child.tagName === 'SPAN');
      const wrapper = document.createElement('div');
      wrapper.className = 'subcategory-filter';
      if (caption) wrapper.append(caption.cloneNode(true));
      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.id = 'wardrobe-subcategory-trigger';
      trigger.className = 'subcategory-trigger';
      trigger.dataset.action = 'open-wardrobe-subcategory';
      trigger.setAttribute('aria-haspopup', 'dialog');
      trigger.setAttribute('aria-expanded', 'false');
      const value = document.createElement('span');
      value.id = 'wardrobe-subcategory-value';
      const chevron = document.createElement('span');
      chevron.className = 'subcategory-trigger-chevron';
      chevron.setAttribute('aria-hidden', 'true');
      chevron.textContent = '⌄';
      trigger.append(value, chevron);
      select.hidden = true;
      select.tabIndex = -1;
      select.setAttribute('aria-hidden', 'true');
      wrapper.append(trigger, select);
      source.replaceWith(wrapper);
    }
    if (!byId('wardrobe-subcategory-sheet')) {
      const backdrop = document.createElement('div');
      backdrop.id = 'wardrobe-subcategory-sheet';
      backdrop.className = 'sheet-backdrop subcategory-sheet-backdrop';
      backdrop.hidden = true;
      backdrop.innerHTML = '<div class="data-sheet subcategory-data-sheet" role="dialog" aria-modal="true" aria-labelledby="wardrobe-subcategory-sheet-title"><div class="subcategory-sheet-handle" aria-hidden="true"></div><button class="data-sheet-close" type="button" data-action="close-wardrobe-subcategory" aria-label="Закрыть">×</button><h2 id="wardrobe-subcategory-sheet-title">Выберите вид</h2><p class="subcategory-sheet-note"><span id="wardrobe-subcategory-sheet-caption">Подкатегория</span> · <span id="wardrobe-subcategory-sheet-category">Все</span></p><div id="wardrobe-subcategory-options" class="subcategory-sheet-options" role="listbox" aria-label="Подкатегория"></div></div>';
      document.body.append(backdrop);
    }
  };
  const renderWardrobeSubcategoryFilter = () => {
    ensureWardrobeSubcategoryPicker();
    const select = byId('wardrobe-subcategory-filter');
    if (!select) return;
    const category = state.wardrobeFilter || 'all';
    const options = filterSubcategoryOptions(category);
    select.innerHTML = '';
    options.forEach((option) => {
      const node = document.createElement('option');
      node.value = option.value;
      node.textContent = translate(option.label);
      select.append(node);
    });
    const selected = options.some((option) => option.value === state.wardrobeSubcategory) ? state.wardrobeSubcategory : 'all';
    state.wardrobeSubcategory = selected;
    select.value = selected;
    const label = byId('wardrobe-subcategory-category');
    if (label) label.textContent = translate(categoryLabel(category));
    const triggerValue = byId('wardrobe-subcategory-value');
    if (triggerValue) triggerValue.textContent = translate(options.find((option) => option.value === selected)?.label || 'Все виды');
    const sheetCaption = byId('wardrobe-subcategory-sheet-caption');
    if (sheetCaption) sheetCaption.textContent = translate('Подкатегория');
    const sheetCategory = byId('wardrobe-subcategory-sheet-category');
    if (sheetCategory) sheetCategory.textContent = translate(categoryLabel(category));
    const optionList = byId('wardrobe-subcategory-options');
    if (optionList) {
      optionList.innerHTML = '';
      options.forEach((option) => {
        const optionButton = document.createElement('button');
        const isSelected = option.value === selected;
        optionButton.type = 'button';
        optionButton.className = `subcategory-sheet-option${isSelected ? ' is-selected' : ''}`;
        optionButton.dataset.subcategoryOption = option.value;
        optionButton.setAttribute('role', 'option');
        optionButton.setAttribute('aria-selected', String(isSelected));
        const optionLabel = document.createElement('span');
        optionLabel.textContent = translate(option.label);
        const check = document.createElement('span');
        check.className = 'subcategory-sheet-check';
        check.setAttribute('aria-hidden', 'true');
        check.textContent = isSelected ? '✓' : '';
        optionButton.append(optionLabel, check);
        optionList.append(optionButton);
      });
    }
  };
  const openWardrobeSubcategorySheet = () => {
    ensureWardrobeSubcategoryPicker();
    renderWardrobeSubcategoryFilter();
    const node = byId('wardrobe-subcategory-sheet');
    if (!node) return;
    node.hidden = false;
    document.body.classList.add('modal-open');
    byId('wardrobe-subcategory-trigger')?.setAttribute('aria-expanded', 'true');
    setTimeout(() => node.querySelector('.subcategory-sheet-option[aria-selected="true"]')?.focus(), 0);
  };
  const closeWardrobeSubcategorySheet = ({ restoreFocus = true } = {}) => {
    const node = byId('wardrobe-subcategory-sheet');
    if (node) node.hidden = true;
    document.body.classList.remove('modal-open');
    const trigger = byId('wardrobe-subcategory-trigger');
    trigger?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger?.focus();
  };
  const chooseWardrobeSubcategory = (value) => {
    state.wardrobeSubcategory = value || 'all';
    const select = byId('wardrobe-subcategory-filter');
    if (select) select.value = state.wardrobeSubcategory;
    applyWardrobeFilters();
    renderWardrobeSubcategoryFilter();
    closeWardrobeSubcategorySheet();
  };
  const applyWardrobeFilters = () => {
    const query = document.querySelector('.search-box input')?.value.trim().toLowerCase() || '';
    const category = state.wardrobeFilter || 'all';
    const subcategory = state.wardrobeSubcategory || 'all';
    document.querySelectorAll('.wardrobe-item').forEach((item) => {
      const itemCategory = item.dataset.category === 'outer' ? 'top' : item.dataset.category;
      const categoryMatches = category === 'all' || itemCategory === category;
      const subcategoryMatches = subcategory === 'all' || canonicalSubcategory(item.dataset.subcategory) === subcategory;
      const queryMatches = !query || item.textContent.toLowerCase().includes(query);
      item.hidden = !(categoryMatches && subcategoryMatches && queryMatches);
    });
  };
  const setText = (selector, value) => { const node = document.querySelector(selector); if (node) node.textContent = translate(value ?? ''); };
  const showToast = (message, type = '') => {
    if (!toast) return;
    toast.textContent = translate(message);
    toast.className = `toast show${type ? ` ${type}` : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.className = 'toast'; }, 2200);
  };
  const ensureStylistComposer = () => {
    const icons = document.querySelector('.screen[data-screen-id="stylist"] .composer-media-icons');
    if (!icons || icons.dataset.ready === 'true') return;
    icons.dataset.ready = 'true';
    const createButton = (id, action, label, svg) => {
      const button = document.createElement('button');
      button.id = id;
      button.type = 'button';
      button.className = 'composer-media-button';
      button.dataset.action = action;
      button.setAttribute('aria-label', label);
      button.innerHTML = svg;
      return button;
    };
    const camera = createButton('stylist-camera-button', 'open-stylist-photo', 'Приложить фото', '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 5 9.5 3h5L16 5"/><circle cx="12" cy="12" r="3"/></svg>');
    const voice = createButton('stylist-voice-button', 'start-voice-input', 'Голосовой ввод', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V7a3 3 0 0 1 3-3Z"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/></svg>');
    icons.replaceChildren(camera, voice);
    const input = document.createElement('input');
    input.id = 'stylist-photo-input';
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');
    input.hidden = true;
    input.tabIndex = -1;
    icons.parentElement?.append(input);
    const status = document.createElement('div');
    status.id = 'stylist-photo-status';
    status.className = 'composer-photo-status';
    status.hidden = true;
    icons.closest('.composer-card')?.append(status);
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      if (!String(file.type || '').startsWith('image/')) {
        input.value = '';
        return showToast('Выберите изображение', 'error');
      }
      if (file.size > 5 * 1024 * 1024) {
        input.value = '';
        return showToast('Фото должно быть меньше 5 МБ', 'error');
      }
      state.stylistPhoto = file;
      status.textContent = state.language === 'en' ? `Photo attached: ${file.name}` : `Фото прикреплено: ${file.name}`;
      status.hidden = false;
      camera.classList.add('is-selected');
      showToast(state.language === 'en' ? 'Photo attached' : 'Фото прикреплено', 'success');
    });
  };
  const startBrowserVoiceInput = () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return showToast(state.language === 'en' ? 'Voice input is unavailable' : 'Голосовой ввод недоступен', 'error');
    if (stylistVoiceRecognition) {
      stylistVoiceRecognition.stop();
      return;
    }
    const recognition = new Recognition();
    recognition.lang = state.language === 'en' ? 'en-US' : 'ru-RU';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => byId('stylist-voice-button')?.classList.add('is-selected');
    recognition.onresult = (event) => {
      const value = Array.from(event.results || []).map((result) => result[0]?.transcript || '').join(' ').trim();
      const input = byId('prompt-input');
      if (value && input) { input.value = `${input.value} ${value}`.trim(); input.focus(); }
    };
    recognition.onerror = () => showToast(state.language === 'en' ? 'Could not recognize speech' : 'Не удалось распознать речь', 'error');
    recognition.onend = () => { stylistVoiceRecognition = null; byId('stylist-voice-button')?.classList.remove('is-selected'); };
    stylistVoiceRecognition = recognition;
    try {
      recognition.start();
      showToast(state.language === 'en' ? 'Listening…' : 'Говорите…');
    } catch (_) {
      stylistVoiceRecognition = null;
      showToast(state.language === 'en' ? 'Voice input is unavailable' : 'Голосовой ввод недоступен', 'error');
    }
  };
  const activeScreenId = () => document.querySelector('.screen.active')?.dataset.screenId || 'home';
  const languageLabel = (language = state.language) => language === 'en' ? 'English' : 'Русский';
  const syncLanguageControls = () => {
    window.MettiI18n?.apply?.(state.language);
    document.documentElement.lang = state.language;
    setText('#profile-language-value', languageLabel());
    document.querySelectorAll('[data-language-option]').forEach((option) => {
      const selected = option.dataset.languageOption === state.language;
      option.classList.toggle('is-selected', selected);
      option.setAttribute('aria-checked', String(selected));
    });
    syncMettiSelectPickers();
  };
  const setLanguage = (language, { notify = true } = {}) => {
    state.language = language === 'en' ? 'en' : 'ru';
    if (window.MettiI18n?.setLanguage) window.MettiI18n.setLanguage(state.language);
    else { try { window.localStorage.setItem(languageStorageKey, state.language); } catch (_) { /* Storage can be unavailable in private file contexts. */ } }
    renderProfile(); renderLooks(); renderWardrobeSubcategoryFilter(); applyWardrobeFilters(); renderHomeCollage(); updateDate(); updateWeather();
    syncLanguageControls();
    if (notify) showToast(state.language === 'en' ? 'English selected' : 'Русский выбран', 'success');
  };
  const setFormStatus = (id, message = '', type = '') => {
    const node = byId(id);
    if (!node) return;
    node.textContent = translate(message);
    node.className = `auth-status${type ? ` ${type}` : ''}`;
  };
  const setBusy = (form, busy, label = 'Сохранить') => {
    const button = form?.querySelector('button[type="submit"]');
    if (!button) return;
    if (busy) {
      button.dataset.label = button.innerHTML;
      button.innerHTML = translate('Секунду…');
      button.disabled = true;
    } else {
      button.innerHTML = button.dataset.label || label;
      button.disabled = false;
    }
  };
  const go = (screen, behavior = 'smooth', { pushHistory = true, resetHistory = false } = {}) => {
    const target = document.querySelector(`.screen[data-screen-id="${screen}"]`);
    if (!target) return;
    const current = activeScreenId();
    if (resetHistory) screenHistory = [];
    else if (pushHistory && current !== screen) {
      if (screenHistory[screenHistory.length - 1] !== current) screenHistory.push(current);
      if (screenHistory.length > 20) screenHistory.shift();
    }
    document.querySelectorAll('.screen').forEach((item) => item.classList.toggle('active', item === target));
    document.querySelectorAll('.bottom-nav button').forEach((item) => {
      const active = item.dataset.screen === screen;
      item.classList.toggle('active', active);
      if (active) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
    });
    if (appScroll) appScroll.scrollTo({ top: 0, behavior }); else phone?.scrollTo({ top: 0, behavior });
  };
  const goBack = () => {
    const current = activeScreenId();
    const previous = screenHistory.pop();
    if (previous && previous !== current) { go(previous, 'smooth', { pushHistory: false }); return true; }
    if (current !== 'home') { go('home', 'smooth', { pushHistory: false, resetHistory: true }); return true; }
    return false;
  };
  const weatherLabel = (code) => {
    if (code === 0) return [translate('Ясно'), '☀'];
    if (code === 1 || code === 2) return [translate('Переменная облачность'), '☁'];
    if (code === 3) return [translate('Облачно'), '☁'];
    if (code === 45 || code === 48) return [translate('Туман'), '☁'];
    if (code >= 51 && code <= 67) return [translate('Дождь'), '☂'];
    if (code >= 71 && code <= 77) return [translate('Снег'), '❄'];
    if (code >= 80 && code <= 82) return [translate('Ливни'), '☂'];
    if (code >= 95) return [translate('Гроза'), '⚡'];
    return [translate('Облачно'), '☁'];
  };
  const updateDate = () => {
    if (!dateNode) return;
    const now = new Date();
    const options = { timeZone: 'Europe/Prague' };
    const locale = state.language === 'en' ? 'en-US' : 'ru-RU';
    const weekday = new Intl.DateTimeFormat(locale, { ...options, weekday: 'long' }).format(now).toUpperCase();
    const day = new Intl.DateTimeFormat(locale, { ...options, day: 'numeric' }).format(now);
    const month = new Intl.DateTimeFormat(locale, { ...options, month: 'short' }).format(now).replace(/\./g, '').toUpperCase();
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
      if (weatherSmall) weatherSmall.textContent = Number.isFinite(maximum) ? `${description} · ${translate('до')} ${maximum}°C` : `${description} · ${translate('сейчас')}`;
      if (weatherIcon) weatherIcon.textContent = icon;
    } catch (_) {
      // Keep the bundled text when the prototype is offline or the request times out.
    } finally { clearTimeout(timeout); }
  };

  const profileName = () => state.profile?.display_name || state.user?.user_metadata?.full_name || state.user?.email?.split('@')[0] || 'Наталия';
  const timeOfDayGreeting = () => {
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
    if (hour >= 5 && hour < 12) return 'Доброе утро,';
    if (hour >= 12 && hour < 18) return 'Добрый день,';
    if (hour >= 18) return 'Добрый вечер,';
    return 'Доброй ночи,';
  };
  const updateGreeting = (name = profileName()) => {
    const greeting = document.querySelector('.screen[data-screen-id="home"] h1');
    if (!greeting) return;
    greeting.innerHTML = '';
    const greetingText = document.createElement('span');
    greetingText.textContent = translate(timeOfDayGreeting());
    const lineBreak = document.createElement('br');
    const greetingName = document.createElement('span');
    greetingName.textContent = name;
    greeting.append(greetingText, lineBreak, greetingName);
  };
  const styleTags = () => Array.isArray(state.profile?.style_tags) && state.profile.style_tags.length ? state.profile.style_tags : ['Спокойный', 'Элегантный'];
  const renderProfile = () => {
    const name = profileName();
    const city = state.profile?.city || 'Prague';
    const tags = styleTags();
    const displayStyleLabel = tags.slice(0, 2).map((tag) => translate(tag)).join(' · ');
    setText('.screen[data-screen-id="profile"] .profile-heading h1', name);
    setText('.screen[data-screen-id="profile"] .profile-card-copy strong', name);
    updateGreeting(name);
    setText('.screen[data-screen-id="profile"] .profile-card-copy small', displayStyleLabel);
    setText('.screen[data-screen-id="profile"] .profile-style-card strong', displayStyleLabel);
    setText('.screen[data-screen-id="profile"] .profile-style-card small', state.language === 'en' ? `Works for ${city}, work, and occasions.` : `Подходит для ${city}, работы и встреч.`);
    setText('#profile-language-value', languageLabel());
    document.querySelectorAll('.profile-style-chips span').forEach((chip, index) => { chip.textContent = translate(tags[index] || ''); chip.hidden = !tags[index]; });
    document.querySelectorAll('.profile-hero-avatar,.profile-button,.large-avatar').forEach((node) => { node.textContent = name.slice(0, 1).toUpperCase(); });
    const count = state.wardrobe.length;
    setText('#wardrobe-count', `${count} ${count === 1 ? 'вещь' : count >= 2 && count <= 4 ? 'вещи' : 'вещей'}`);
    document.querySelectorAll('.profile-menu-row strong').forEach((node, index) => { if (index === 0) node.textContent = String(count); if (index === 1) node.textContent = String(state.outfits.length); });
  };
  const requestSignedImageUrl = async (path) => {
    if (!path || !supabase?.data?.createWardrobeImageUrl) return '';
    try { return await supabase.data.createWardrobeImageUrl(path); } catch (_) { return ''; }
  };
  const rememberImageUrl = (path, url) => {
    if (path && url) imageUrlCache.set(path, { url, expiresAt: Date.now() + IMAGE_URL_CACHE_TTL_MS });
    return url;
  };
  const imageUrl = async (path) => {
    const key = String(path || '').trim();
    if (!key) return '';
    const cached = imageUrlCache.get(key);
    if (cached && cached.expiresAt > Date.now() + 60 * 1000) return cached.url;
    const pending = imageUrlRequests.get(key);
    if (pending) return pending;
    let request;
    request = Promise.resolve().then(() => requestSignedImageUrl(key)).then((url) => rememberImageUrl(key, url)).catch(() => '').finally(() => {
      if (imageUrlRequests.get(key) === request) imageUrlRequests.delete(key);
    });
    imageUrlRequests.set(key, request);
    return request;
  };
  const primeImageUrls = (paths) => {
    const uniquePaths = [...new Set((Array.isArray(paths) ? paths : []).map((path) => String(path || '').trim()).filter(Boolean))];
    const pendingPaths = uniquePaths.filter((path) => {
      const cached = imageUrlCache.get(path);
      return !(cached && cached.expiresAt > Date.now() + 60 * 1000) && !imageUrlRequests.has(path);
    });
    if (!pendingPaths.length) return;
    if (typeof supabase?.data?.createWardrobeImageUrls !== 'function') {
      pendingPaths.forEach((path) => { void imageUrl(path); });
      return;
    }
    const batchPromise = Promise.resolve().then(() => supabase.data.createWardrobeImageUrls(pendingPaths)).catch(() => ({}));
    pendingPaths.forEach((path) => {
      let request;
      request = batchPromise.then((urls) => urls?.[path] || requestSignedImageUrl(path)).then((url) => rememberImageUrl(path, url)).catch(() => '').finally(() => {
        if (imageUrlRequests.get(path) === request) imageUrlRequests.delete(path);
      });
      imageUrlRequests.set(path, request);
    });
  };
  const addImageBackground = async (node, path) => {
    const key = String(path || '').trim();
    if (!node || !key) return false;
    node.dataset.imagePath = key;
    node.classList.add('image-loading');
    node.classList.remove('image-failed');
    const url = await imageUrl(key);
    if (!url || !node?.isConnected || node.dataset.imagePath !== key) {
      if (node?.isConnected && node.dataset.imagePath === key) {
        node.classList.remove('image-loading');
        node.classList.add('image-failed');
      }
      return false;
    }
    // The editorial placeholder classes use !important background rules. Set the
    // signed private image with the same priority so uploaded photos win.
    node.style.setProperty('background-image', `url("${url.replace(/"/g, '\\"')}")`, 'important');
    node.style.setProperty('background-position', 'center', 'important');
    node.style.setProperty('background-size', 'cover', 'important');
    node.style.setProperty('background-repeat', 'no-repeat', 'important');
    node.style.setProperty('background-color', '#f0e9df', 'important');
    node.classList.remove('image-loading', 'image-failed');
    node.classList.add('has-image');
    return true;
  };
  const renderVisualNode = async (node, item, layoutClass, emptyLabel, keepEmpty = false) => {
    if (!node) return;
    node.hidden = !item && !keepEmpty;
    const classes = String(layoutClass || '').split(/\s+/).filter(Boolean);
    const canUseDemoArt = item && String(item.id).startsWith('demo-');
    const useDemoHeroPhoto = canUseDemoArt && item.id === 'demo-jacket' && node.dataset.collageSlot === 'hero';
    const imageReady = Boolean(item?.image_path);
    const visualClasses = item && (imageReady || canUseDemoArt) ? (useDemoHeroPhoto ? ['photo-outfit'] : itemClass(item).split(/\s+/)) : ['collage-empty'];
    node.className = [...classes, 'placeholder', ...visualClasses].join(' ');
    ['background-image', 'background-position', 'background-size', 'background-repeat', 'background-color'].forEach((property) => node.style.removeProperty(property));
    node.classList.remove('has-image');
    node.innerHTML = '';
    const label = document.createElement('span');
    label.textContent = translate(item?.name || emptyLabel || 'Вещь');
    node.append(label);
    node.setAttribute('aria-label', label.textContent);
    if (imageReady) void addImageBackground(node, item.image_path);
  };
  const renderHomeCollage = async (outfit = state.currentOutfit) => {
    const collage = document.querySelector('.screen[data-screen-id="home"] .outfit-collage');
    if (!collage) return;
    const selectedItems = selectedOutfitItems(outfit);
    const hasOutfit = selectedItems.length > 0;
    document.querySelector('[data-action="wear"]')?.toggleAttribute('hidden', !hasOutfit);
    document.querySelector('[data-action="other"]')?.toggleAttribute('hidden', !hasOutfit);
    const slots = collageSlots(selectedItems);
    const definitions = [
      ['hero', '.collage-main', 'collage-main', 'Главная вещь'],
      ['top', '[data-collage-slot="top"]', 'pink', 'Верх'],
      ['bottom', '[data-collage-slot="bottom"]', '', 'Низ'],
      ['shoes', '[data-collage-slot="shoes"]', '', 'Обувь'],
      ['bag', '[data-collage-slot="bag"]', 'pink', 'Аксессуар'],
      ['accent', '[data-collage-slot="accent"]', '', 'Аксессуар']
    ];
    const sideCount = [slots.top, slots.bottom].filter(Boolean).length;
    const bottomCount = [slots.shoes, slots.bag, slots.accent].filter(Boolean).length;
    collage.classList.remove('side-count-0', 'side-count-1', 'side-count-2', 'bottom-count-0', 'bottom-count-1', 'bottom-count-2', 'bottom-count-3');
    collage.classList.add(`side-count-${sideCount}`, `bottom-count-${bottomCount}`);
    await Promise.all(definitions.map(([key, selector, layoutClass, emptyLabel]) => renderVisualNode(collage.querySelector(selector), slots[key], layoutClass, emptyLabel, !hasOutfit)));
    collage.setAttribute('aria-label', translate('Коллаж образа из вашего гардероба'));
  };
  const renderWardrobe = async () => {
    const grid = byId('wardrobe-grid');
    if (!grid) return;
    const items = state.wardrobe;
    const empty = byId('wardrobe-empty');
    primeImageUrls(items.map((item) => item.image_path));
    grid.innerHTML = '';
    if (!items.length) { empty?.classList.add('show'); renderWardrobeSubcategoryFilter(); applyWardrobeFilters(); renderProfile(); return; }
    empty?.classList.remove('show');
    items.forEach((item) => {
      const button = document.createElement('button');
      button.className = 'wardrobe-item';
      button.type = 'button';
      button.dataset.itemId = item.id;
      button.dataset.category = categoryForItem(item);
      button.dataset.subcategory = itemSubcategory(item);
      const art = document.createElement('div');
      art.className = `item-art ${itemClass(item)}`;
      const label = document.createElement('span');
      label.textContent = translate(item.name || 'Вещь');
      art.append(label); button.append(art); grid.append(button);
      if (isEditorialImageReady(item)) void addImageBackground(art, item.image_path);
    });
    renderWardrobeSubcategoryFilter(); applyWardrobeFilters(); renderProfile();
  };
  const renderDetail = async (item) => {
    if (!item) return;
    state.activeItem = item;
    const art = document.querySelector('.item-detail-art');
    if (art) {
      art.className = `item-detail-art placeholder ${itemClass(item)}`;
      art.innerHTML = '';
      const label = document.createElement('span'); label.textContent = translate(item.name || 'Вещь'); art.append(label);
      if (isEditorialImageReady(item)) void addImageBackground(art, item.image_path);
    }
    setText('.screen[data-screen-id="item"] .detail-title', item.name || 'Вещь');
    const chips = document.querySelector('.detail-chips');
    if (chips) {
      chips.innerHTML = '';
      [categoryLabel(categoryForItem(item)), subcategoryLabel(itemSubcategory(item)), item.color, item.size, item.season].filter(Boolean).slice(0, 5).forEach((value) => { const node = document.createElement('span'); node.textContent = translate(value); chips.append(node); });
    }
    const addButton = document.querySelector('[data-action="add-item"]');
    if (addButton) addButton.textContent = translate(item.id && !String(item.id).startsWith('demo-') ? 'В гардеробе ✓' : 'Добавить в гардероб');
  };
  const processNativeWardrobeImage = async (file) => {
    const bridge = window.MettiAndroid;
    if (!bridge || typeof bridge.removeImageBackground !== 'function') return null;
    let processedUrl = '';
    const requestId = `metti-image-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Не удалось прочитать фотографию.'));
        reader.readAsDataURL(file);
      });
      processedUrl = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          nativeImageRequests.delete(requestId);
          reject(new Error('Обработка фотографии заняла слишком много времени.'));
        }, 120000);
        nativeImageRequests.set(requestId, { resolve, reject, timeout });
        try {
          bridge.removeImageBackground(dataUrl, requestId);
        } catch (error) {
          clearTimeout(timeout);
          nativeImageRequests.delete(requestId);
          reject(error);
        }
      });
      const response = await fetch(processedUrl);
      if (!response.ok) throw new Error('Не удалось получить обработанную фотографию.');
      const blob = await response.blob();
      if (!blob.size || !String(blob.type || '').startsWith('image/')) throw new Error('Обработанная фотография повреждена.');
      return new File([blob], `${String(file.name || 'wardrobe').replace(/\.[^.]+$/, '')}-metti-editorial.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
    } catch (_) {
      return null;
    } finally {
      if (processedUrl && typeof bridge.releaseProcessedImage === 'function') bridge.releaseProcessedImage(processedUrl);
      nativeImageRequests.delete(requestId);
    }
  };
  const prepareWardrobeImage = async (file) => {
    if (!file || !String(file.type || '').startsWith('image/') || /heic|heif/i.test(file.type || '')) return file;
    const nativeProcessed = await processNativeWardrobeImage(file);
    if (nativeProcessed) return nativeProcessed;
    const objectUrl = URL.createObjectURL(file);
    let canvas;
    let output;
    try {
      const image = await new Promise((resolve, reject) => {
        const node = new Image();
        node.crossOrigin = 'anonymous';
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
      outputContext.fillStyle = EDITORIAL_BACKGROUND_COLOR;
      outputContext.fillRect(0, 0, width, height);
      outputContext.drawImage(canvas, 0, 0);
      const blob = await new Promise((resolve) => output.toBlob(resolve, 'image/jpeg', 0.9));
      if (!blob) return file;
      return new File([blob], `${String(file.name || 'wardrobe').replace(/\.[^.]+$/, '')}-metti-editorial.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
    } catch (_) {
      return file;
    } finally {
      URL.revokeObjectURL(objectUrl);
      if (canvas) { canvas.width = 0; canvas.height = 0; }
      if (output) { output.width = 0; output.height = 0; }
    }
  };
  const isPendingMcpImage = (item) => Boolean(item?.id && item?.image_path && item?.metadata?.image_source === 'mcp' && item?.metadata?.image_background !== EDITORIAL_IMAGE_BACKGROUND);
  const findOriginalMcpImagePath = async (item) => {
    const userId = state.user?.id;
    if (!userId || !item?.id || typeof supabase?.data?.listWardrobeImageVersions !== 'function') return '';
    try {
      const rows = await supabase.data.listWardrobeImageVersions(userId, item.id);
      const uuidSuffix = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const prefix = `${item.id}-`;
      const candidates = (Array.isArray(rows) ? rows : []).map((row) => {
        const rawName = String(row?.name || '').trim();
        if (!rawName) return null;
        const path = rawName.includes('/') ? rawName : `${userId}/${rawName}`;
        const name = path.split('/').pop() || '';
        const extension = name.match(/\.[^.]+$/)?.[0] || '';
        const suffix = name.startsWith(prefix) ? name.slice(prefix.length, -extension.length || undefined) : '';
        return uuidSuffix.test(suffix) ? { path, createdAt: String(row?.created_at || '') } : null;
      }).filter(Boolean);
      candidates.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      return candidates[0]?.path || '';
    } catch (_) {
      return '';
    }
  };
  const normalizePendingMcpImage = async (item) => {
    if (!isPendingMcpImage(item) || pendingImageNormalizations.has(item.id)) return false;
    pendingImageNormalizations.add(item.id);
    const userId = state.user?.id;
    const originalPath = item.image_path;
    let replacementPath = '';
    try {
      const sourcePath = await findOriginalMcpImagePath(item) || originalPath;
      const sourceUrl = await imageUrl(sourcePath);
      if (!sourceUrl) return false;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      let response;
      try {
        response = await fetch(sourceUrl, { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) return false;
      const blob = await response.blob();
      const mimeType = String(blob.type || '').toLowerCase().split(';')[0];
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) return false;
      const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
      const sourceFile = new File([blob], `mcp-${item.id}.${extension}`, { type: mimeType, lastModified: Date.now() });
      const processedFile = await prepareWardrobeImage(sourceFile);
      if (!processedFile || processedFile === sourceFile) return false;
      if (!userId || state.user?.id !== userId) return false;
      replacementPath = await supabase.data.uploadWardrobeImage(processedFile, userId, item.id);
      const metadata = item.metadata && typeof item.metadata === 'object' ? { ...item.metadata } : {};
      metadata.image_background = EDITORIAL_IMAGE_BACKGROUND;
      const saved = await supabase.data.updateWardrobeItem(item.id, { image_path: replacementPath, metadata });
      if (!saved) throw new Error('Не удалось обновить фотографию вещи.');
      await Promise.all([...new Set([originalPath, sourcePath].filter((path) => path && path !== replacementPath))].map((path) => supabase.data.removeWardrobeImage(path).catch(() => {})));
      const index = state.wardrobe.findIndex((value) => value.id === item.id);
      if (index >= 0) state.wardrobe[index] = saved;
      return true;
    } catch (_) {
      if (replacementPath) await supabase.data.removeWardrobeImage(replacementPath).catch(() => {});
      return false;
    } finally {
      pendingImageNormalizations.delete(item.id);
    }
  };
  const normalizePendingMcpImages = async () => {
    if (!state.user || !supabase?.data) return;
    const pending = state.wardrobe.filter(isPendingMcpImage).slice(0, 12);
    if (pending.length) showToast(`Оформляю ${pending.length} фото…`);
    let changed = false;
    for (const item of pending) {
      if (await normalizePendingMcpImage(item)) changed = true;
    }
    if (changed) {
      await renderWardrobe();
      await renderHomeCollage();
      showToast('Фото оформлены в стиле Metti', 'success');
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
      badge.textContent = translate(outfit.is_worn ? 'Надето' : 'Сохранено');
      const title = document.createElement('strong');
      title.textContent = translate(outfit.title || 'Образ на сегодня');
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
      if (!state.outfits.length) { note.classList.remove('show'); applyLanguage(); return; }
      const worn = state.outfits.filter((outfit) => outfit.is_worn).length;
      note.textContent = translate(`${state.outfits.length} сохранённых образа${worn ? ` · ${worn} надето` : ''}`);
      note.classList.add('show');
      applyLanguage(); return;
    }
    const matches = tab === 'worn' ? state.outfits.filter((outfit) => outfit.is_worn) : state.outfits;
    if (!matches.length) {
      grid.innerHTML = '';
      grid.hidden = true;
      note.textContent = translate(tab === 'worn' ? 'Надетых образов пока нет.' : 'Сохранённых образов пока нет.');
      note.classList.add('show');
      applyLanguage(); return;
    }
    renderOutfitCards(matches);
    grid.hidden = false;
    note.textContent = translate(tab === 'worn' ? `Надетых образов: ${matches.length}` : `Сохранённых образов: ${matches.length}`);
    note.classList.add('show');
    applyLanguage();
  };
  const loadData = async () => {
    if (!state.user || !supabase?.data) return;
    lastDataSyncAt = Date.now();
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
    if (!state.currentOutfit) state.currentOutfit = state.outfits[0] || null;
    renderProfile(); await renderWardrobe(); renderLooks(); await renderHomeCollage(); updateWeather();
    void normalizePendingMcpImages();
  };
  const seedDemo = () => { state.wardrobe = [...demoItems]; state.profile = { display_name: state.language === 'en' ? 'Natalia' : 'Наталия', city: 'Prague', style_tags: ['Спокойный', 'Элегантный'] }; state.outfits = []; state.currentOutfit = { item_ids: pickOutfitItems(state.wardrobe).map((item) => item.id) }; renderProfile(); renderWardrobe(); renderLooks(); renderHomeCollage(); };

  const renderWardrobeFormSubcategories = (category, selected = '') => {
    const select = byId('wardrobe-form')?.elements.subcategory;
    if (!select) return;
    const options = wardrobeSubcategoryOptions[category] || [];
    select.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = translate('Выберите вид');
    select.append(placeholder);
    options.forEach((option) => {
      const node = document.createElement('option');
      node.value = option.value;
      node.textContent = translate(option.label);
      select.append(node);
    });
    select.value = canonicalSubcategory(selected);
    syncMettiSelectPicker(select);
  };

  const openWardrobeSheet = (item = null) => {
    const backdrop = byId('wardrobe-sheet'); const form = byId('wardrobe-form'); if (!backdrop || !form) return;
    const persistedItem = item && !String(item.id).startsWith('demo-');
    form.dataset.itemId = persistedItem ? item.id : '';
    byId('wardrobe-form-title').textContent = translate(persistedItem ? 'Изменить вещь' : 'Новая вещь');
    ['name','color','size','season','brand','notes'].forEach((name) => { if (form.elements[name]) form.elements[name].value = item?.[name] || ''; });
    const category = item ? categoryForItem(item) : 'top';
    if (form.elements.category) form.elements.category.value = category;
    renderWardrobeFormSubcategories(category, item ? itemSubcategory(item) : '');
    syncMettiSelectPickers();
    if (form.elements.image) form.elements.image.value = '';
    setFormStatus('wardrobe-form-status'); backdrop.hidden = false; document.body.classList.add('modal-open');
    setTimeout(() => form.elements.name?.focus(), 0);
  };
  const closeWardrobeSheet = () => { const node = byId('wardrobe-sheet'); if (node) node.hidden = true; document.body.classList.remove('modal-open'); };
  const saveWardrobeForm = async (event) => {
    event.preventDefault(); const form = event.currentTarget;
    const name = form.elements.name.value.trim(); const category = form.elements.category.value; const subcategory = form.elements.subcategory?.value || '';
    if (!name) return setFormStatus('wardrobe-form-status', 'Введите название вещи.', 'error');
    if (!subcategory) return setFormStatus('wardrobe-form-status', 'Выберите вид вещи.', 'error');
    if (!state.user || !supabase?.data) return setFormStatus('wardrobe-form-status', 'Войдите, чтобы сохранять вещи.', 'error');
    // Demo cards are only templates; when opened from a demo card, create a
    // new persisted item instead of trying to update the demo id.
    const existing = state.wardrobe.find((item) => item.id === form.dataset.itemId && !String(item.id).startsWith('demo-'));
    const file = form.elements.image.files?.[0];
    if (file && file.size > 5 * 1024 * 1024) return setFormStatus('wardrobe-form-status', 'Файл должен быть меньше 5 МБ.', 'error');
    setBusy(form, true); setFormStatus('wardrobe-form-status', file ? 'Оформляю фото в стиле Metti…' : 'Сохраняю…');
    let newPath = existing?.image_path || null;
    try {
      const processedFile = file ? await prepareWardrobeImage(file) : null;
      if (processedFile && processedFile.size > 5 * 1024 * 1024) throw new Error('После обработки файл получился больше 5 МБ. Выберите фото поменьше.');
      if (processedFile) { setFormStatus('wardrobe-form-status', 'Загружаю фотографию…'); newPath = await supabase.data.uploadWardrobeImage(processedFile, state.user.id, existing?.id || uuid()); }
      const metadata = existing?.metadata && typeof existing.metadata === 'object' ? { ...existing.metadata } : {};
      if (file) { delete metadata.image_source; delete metadata.image_background; }
      metadata.subcategory = subcategory;
      const payload = { user_id: state.user.id, name, category, color: form.elements.color.value.trim() || null, size: form.elements.size.value.trim() || null, season: form.elements.season.value.trim() || null, brand: form.elements.brand.value.trim() || null, notes: form.elements.notes.value.trim() || null, image_path: newPath, metadata };
      const saved = existing ? await supabase.data.updateWardrobeItem(existing.id, payload) : await supabase.data.saveWardrobeItem(payload);
      if (!saved) throw new Error('Вещь не вернулась из Supabase.');
      if (existing?.image_path && newPath && existing.image_path !== newPath) await supabase.data.removeWardrobeImage(existing.image_path).catch(() => {});
      const index = state.wardrobe.findIndex((item) => item.id === existing?.id);
      if (index >= 0) state.wardrobe[index] = saved; else state.wardrobe.unshift(saved);
      closeWardrobeSheet(); await renderWardrobe(); await renderHomeCollage(); renderProfile(); showToast(existing ? 'Вещь обновлена' : 'Вещь добавлена', 'success');
    } catch (error) {
      if (newPath && newPath !== existing?.image_path) await supabase.data.removeWardrobeImage(newPath).catch(() => {});
      setFormStatus('wardrobe-form-status', error?.message || 'Не удалось сохранить вещь.', 'error');
    } finally { setBusy(form, false); }
  };
  const deleteActiveItem = async () => {
    const item = state.activeItem; if (!item) return;
    const itemName = translate(item.name || 'эту вещь');
    const deletePrompt = state.language === 'en' ? `Delete “${itemName}”?` : `Удалить «${itemName}»?`;
    if (!window.confirm(deletePrompt)) return;
    try {
      if (state.user && supabase?.data && !String(item.id).startsWith('demo-')) {
        await supabase.data.deleteWardrobeItem(item.id);
        if (item.image_path) await supabase.data.removeWardrobeImage(item.image_path).catch(() => {});
      }
      state.wardrobe = state.wardrobe.filter((value) => value.id !== item.id); state.activeItem = null;
      await renderWardrobe(); await renderHomeCollage(); renderProfile(); go('wardrobe'); showToast('Вещь удалена', 'success');
    } catch (error) { showToast(error?.message || 'Не удалось удалить вещь', 'error'); }
  };

  const openProfileSheet = () => {
    const form = byId('profile-form'); const profile = state.profile || {}; if (!form) return;
    const preferences = profile.preferences && typeof profile.preferences === 'object' ? profile.preferences : {};
    form.elements.display_name.value = profileName(); form.elements.city.value = profile.city || 'Prague'; form.elements.style_tags.value = (profile.style_tags || []).join(', '); form.elements.favorite_colors.value = Array.isArray(preferences.favorite_colors) ? preferences.favorite_colors.join(', ') : (preferences.favorite_colors || ''); form.elements.fit.value = profile.style_profile?.fit || ''; form.elements.size.value = profile.style_profile?.size || ''; form.elements.preferences.value = preferences.note || '';
    syncMettiSelectPickers();
    setFormStatus('profile-form-status'); byId('profile-sheet').hidden = false; document.body.classList.add('modal-open'); setTimeout(() => form.elements.display_name?.focus(), 0);
  };
  const closeProfileSheet = () => { const node = byId('profile-sheet'); if (node) node.hidden = true; document.body.classList.remove('modal-open'); };
  const openLanguageSheet = () => {
    const node = byId('language-sheet'); if (!node) return;
    syncLanguageControls(); node.hidden = false; document.body.classList.add('modal-open');
    setTimeout(() => node.querySelector(`[data-language-option="${state.language}"]`)?.focus(), 0);
  };
  const closeLanguageSheet = () => { const node = byId('language-sheet'); if (node) node.hidden = true; document.body.classList.remove('modal-open'); };
  const openDeleteAccountSheet = () => {
    const node = byId('delete-account-sheet'); if (!node) return;
    setFormStatus('delete-account-status'); node.hidden = false; document.body.classList.add('modal-open');
    setTimeout(() => node.querySelector('[data-action="close-delete-account"]')?.focus(), 0);
  };
  const closeDeleteAccountSheet = () => { const node = byId('delete-account-sheet'); if (node) node.hidden = true; document.body.classList.remove('modal-open'); };
  const confirmDeleteAccount = async (button) => {
    if (!state.user || !supabase?.data?.deleteAccount) return setFormStatus('delete-account-status', 'Войдите, чтобы удалить аккаунт.', 'error');
    button.disabled = true; button.textContent = translate('Удаляем…'); setFormStatus('delete-account-status', 'Удаляю профиль и данные…');
    try {
      await supabase.data.deleteAccount();
      closeDeleteAccountSheet(); state.user = null; state.profile = null; state.wardrobe = []; state.outfits = [];
      await window.MettiAuth?.signOut(); showToast('Аккаунт удалён', 'success');
    } catch (error) {
      button.disabled = false; button.textContent = translate('Удалить аккаунт');
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
    syncMettiSelectPickers();
    setFormStatus('style-form-status'); byId('style-sheet').hidden = false; document.body.classList.add('modal-open');
    setTimeout(() => form.elements.style_tags?.focus(), 0);
  };
  const closeStyleSheet = () => { const node = byId('style-sheet'); if (node) node.hidden = true; document.body.classList.remove('modal-open'); };
  const closeVisibleModal = () => {
    if (activeMettiSelect) { closeMettiSelectSheet({ restoreFocus: false }); return true; }
    const subcategory = byId('wardrobe-subcategory-sheet');
    if (subcategory && !subcategory.hidden) { closeWardrobeSubcategorySheet({ restoreFocus: false }); return true; }
    const backdrop = document.querySelector('.sheet-backdrop:not([hidden])');
    if (backdrop) {
      if (backdrop.id === 'wardrobe-sheet') closeWardrobeSheet();
      else if (backdrop.id === 'profile-sheet') closeProfileSheet();
      else if (backdrop.id === 'language-sheet') closeLanguageSheet();
      else if (backdrop.id === 'delete-account-sheet') closeDeleteAccountSheet();
      else if (backdrop.id === 'style-sheet') closeStyleSheet();
      else { backdrop.hidden = true; document.body.classList.remove('modal-open'); }
      return true;
    }
    const sheet = document.querySelector('.sheet:not([hidden])');
    if (sheet) { sheet.hidden = true; return true; }
    return false;
  };
  window.MettiNativeBack = () => closeVisibleModal() || goBack();
  window.addEventListener('metti:voice-result', (event) => {
    const value = String(event.detail || '').trim();
    const input = byId('prompt-input');
    if (value && input) { input.value = `${input.value} ${value}`.trim(); input.focus(); showToast(state.language === 'en' ? 'Text added' : 'Текст добавлен', 'success'); }
  });
  window.addEventListener('metti:voice-error', () => showToast(state.language === 'en' ? 'Voice input is unavailable' : 'Голосовой ввод недоступен', 'error'));
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

  const addMessage = (text, role) => { const log = byId('chat-log'); if (!log) return null; const node = document.createElement('div'); node.className = `message ${role}`; node.textContent = translate(text); log.append(node); log.scrollTop = log.scrollHeight; return node; };
  const setThinking = (visible) => { const node = document.querySelector('.chat-log .thinking'); if (node) node.hidden = !visible; };
  const fallbackOutfit = (prompt) => ({ title: prompt || 'Образ на сегодня', note: 'Собрала спокойный вариант из вещей, которые уже есть в вашем гардеробе.', item_ids: pickOutfitItems(state.wardrobe).map((item) => item.id), temperature_c: state.weather.temperature_c, weather_code: state.weather.weather_code, message: 'С удовольствием. Учитываю погоду и ваш гардероб — собрала спокойный, элегантный вариант.' });
  const renderResult = async (outfit = state.currentOutfit) => {
    if (!outfit) return;
    setText('.screen[data-screen-id="result"] h1', outfit.title || 'Образ на сегодня'); setText('.screen[data-screen-id="result"] .result-note p', `«${outfit.note || 'Собрала этот образ с учётом погоды и вашего гардероба.'}»`);
    const slots = collageSlots(selectedOutfitItems(outfit));
    const hero = document.querySelector('.result-hero');
    if (hero) await renderVisualNode(hero, slots.hero, 'result-hero tall', 'Главная вещь');
    const grid = document.querySelector('.result-grid'); if (!grid) return;
    grid.innerHTML = '';
    const gridItems = [slots.top, slots.bottom, slots.shoes, slots.bag, slots.accent].filter(Boolean);
    await Promise.all(gridItems.map(async (item) => { const node = document.createElement('div'); grid.append(node); await renderVisualNode(node, item, '', 'Вещь'); }));
    await renderHomeCollage(outfit);
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
    const promptForStylist = state.language === 'en' ? translate(clean) : clean;
    go('chat'); addMessage(promptForStylist, 'user'); setThinking(true); const requestId = ++state.requestNumber; showToast('Metti собирает образ…');
    try {
      let result;
      if (state.user && supabase?.data?.invokeStylist) result = await supabase.data.invokeStylist({ prompt: promptForStylist, language: state.language, weather: state.weather, wardrobe: state.wardrobe.map((item) => ({ id: item.id, name: item.name, category: categoryForItem(item), subcategory: itemSubcategory(item), color: item.color, size: item.size, season: item.season, brand: item.brand, notes: item.notes })), profile: state.profile });
      else result = fallbackOutfit(promptForStylist);
      if (requestId !== state.requestNumber) return;
      state.currentOutfit = { ...result, prompt: promptForStylist }; setThinking(false); addMessage(result.message || 'Готово — образ собран из вашего гардероба.', 'assistant'); await renderResult(state.currentOutfit); setTimeout(() => go('result'), 350);
    } catch (error) {
      setThinking(false); addMessage('Не получилось связаться со стилистом. Проверьте подключение и попробуйте ещё раз.', 'assistant'); showToast(error?.message || 'AI-стилист временно недоступен', 'error');
    }
  };

  document.addEventListener('click', (event) => {
    const mettiSelectOption = event.target.closest('[data-metti-select-option]'); if (mettiSelectOption) { chooseMettiSelectOption(mettiSelectOption.dataset.mettiSelectOption); return; }
    const subcategoryOption = event.target.closest('[data-subcategory-option]'); if (subcategoryOption) { chooseWardrobeSubcategory(subcategoryOption.dataset.subcategoryOption); return; }
    const looksTab = event.target.closest('[data-look-tab]'); if (looksTab) { state.activeLooksTab = looksTab.dataset.lookTab || 'recommended'; renderLooks(); return; }
    const languageOption = event.target.closest('[data-language-option]'); if (languageOption) { setLanguage(languageOption.dataset.languageOption); closeLanguageSheet(); return; }
    const outfitButton = event.target.closest('[data-outfit-id]'); if (outfitButton) { const outfit = state.outfits.find((value) => value.id === outfitButton.dataset.outfitId); if (outfit) { state.currentOutfit = outfit; renderResult(outfit); go('result'); } return; }
    const screenButton = event.target.closest('[data-screen]'); if (screenButton) { const id = screenButton.dataset.itemId || screenButton.closest('[data-item-id]')?.dataset.itemId; if (id) { const item = state.wardrobe.find((value) => value.id === id); if (item) { renderDetail(item); go('item'); return; } } const isBottomNav = Boolean(screenButton.closest('.bottom-nav')); go(screenButton.dataset.screen, 'smooth', { pushHistory: !isBottomNav, resetHistory: isBottomNav }); return; }
    const itemButton = event.target.closest('[data-item-id]'); if (itemButton) { const item = state.wardrobe.find((value) => value.id === itemButton.dataset.itemId); if (item) { renderDetail(item); go('item'); } return; }
    const promptButton = event.target.closest('[data-prompt]'); if (promptButton) { ask(promptButton.dataset.prompt); return; }
    const tab = event.target.closest('[data-filter]'); if (tab) { tab.parentElement.querySelectorAll('[data-filter]').forEach((item) => item.classList.remove('selected')); tab.classList.add('selected'); state.wardrobeFilter = tab.dataset.filter || 'all'; state.wardrobeSubcategory = 'all'; renderWardrobeSubcategoryFilter(); applyWardrobeFilters(); return; }
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'open-wardrobe-subcategory') { openWardrobeSubcategorySheet(); return; }
    if (action === 'close-wardrobe-subcategory') { closeWardrobeSubcategorySheet(); return; }
    if (action === 'open-metti-select') { openMettiSelectSheet(byId(event.target.closest('[data-metti-select-target]')?.dataset.mettiSelectTarget)); return; }
    if (action === 'close-metti-select') { closeMettiSelectSheet(); return; }
    if (action === 'wear') { event.target.textContent = translate('Образ надет ✓'); saveCurrentOutfit(true); }
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
    if (action === 'open-language-sheet') openLanguageSheet();
    if (action === 'close-language-sheet') closeLanguageSheet();
    if (action === 'open-delete-account') openDeleteAccountSheet();
    if (action === 'close-delete-account') closeDeleteAccountSheet();
    if (action === 'confirm-delete-account') confirmDeleteAccount(event.target.closest('[data-action="confirm-delete-account"]'));
    if (action === 'style-edit') openStyleSheet();
    if (action === 'close-style-sheet') closeStyleSheet();
    if (action === 'open-stylist-photo') byId('stylist-photo-input')?.click();
    if (action === 'start-voice-input') { if (window.MettiAndroid?.startVoiceInput) window.MettiAndroid.startVoiceInput(state.language === 'en' ? 'en-US' : 'ru-RU'); else startBrowserVoiceInput(); }
    if (action === 'logout') window.MettiAuth?.signOut();
    if (action === 'dismiss') event.target.closest('.hint').hidden = true;
    if (action === 'send') { const input = byId('prompt-input'); const value = input.value.trim(); if (value) { input.value = ''; ask(value); } }
    if (action === 'send-chat') { const input = byId('chat-input'); const value = input.value.trim(); if (value) { input.value = ''; ask(value); } }
  });
  byId('wardrobe-form')?.addEventListener('submit', saveWardrobeForm);
  byId('wardrobe-form')?.elements.category?.addEventListener('change', (event) => renderWardrobeFormSubcategories(event.target.value));
  byId('wardrobe-subcategory-filter')?.addEventListener('change', (event) => { state.wardrobeSubcategory = event.target.value || 'all'; applyWardrobeFilters(); });
  byId('wardrobe-sheet')?.querySelectorAll('[data-action="close-wardrobe-sheet"]').forEach((button) => button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); closeWardrobeSheet(); }));
  byId('profile-form')?.addEventListener('submit', saveProfileForm);
  byId('style-form')?.addEventListener('submit', saveStyleForm);
  document.querySelector('.search-box input')?.addEventListener('input', applyWardrobeFilters);
  ensureWardrobeSubcategoryPicker();
  ensureMettiSelectPickers();
  ensureStylistComposer();
  document.querySelectorAll('.sheet-backdrop').forEach((node) => node.addEventListener('click', (event) => { if (event.target === node) { if (node.id === 'wardrobe-subcategory-sheet') closeWardrobeSubcategorySheet(); else if (node.id === 'metti-select-sheet') closeMettiSelectSheet(); else { node.hidden = true; document.body.classList.remove('modal-open'); } } }));
  document.addEventListener('keydown', (event) => { const node = byId('wardrobe-subcategory-sheet'); const selectSheet = byId('metti-select-sheet'); if (event.key !== 'Escape') return; if (selectSheet && !selectSheet.hidden) { closeMettiSelectSheet(); return; } if (node && !node.hidden) { closeWardrobeSubcategorySheet(); return; } closeVisibleModal(); });
  window.addEventListener('metti:authenticated', async (event) => { state.user = event.detail?.user || supabase?.currentUser?.(); await loadData(); });
  window.addEventListener('metti:signed-out', () => { state.user = null; state.profile = null; state.wardrobe = []; state.outfits = []; });
  renderWardrobeSubcategoryFilter(); applyWardrobeFilters(); syncLanguageControls(); updateDate(); updateGreeting(); updateWeather();
  if (demoMode) seedDemo();
  else if (supabase?.auth) {
    supabase.auth.restoreSession().then(async (session) => { if (session) { state.user = session.user || supabase.currentUser?.(); if (!state.user) state.user = await supabase.auth.getUser().catch(() => null); await loadData(); } else if (!window.MettiAuth?.isOAuthPending?.()) window.MettiAuth?.show('login'); }).catch(() => { if (!window.MettiAuth?.isOAuthPending?.()) window.MettiAuth?.show('login'); });
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { updateDate(); updateGreeting(); updateWeather(); if (state.user && Date.now() - lastDataSyncAt > 15000) void loadData(); } });
  window.setInterval(() => { if (!document.hidden) { updateDate(); updateGreeting(); } }, 60000);
})();
