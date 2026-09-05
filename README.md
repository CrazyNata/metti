# Metti

Metti — самостоятельное мобильное приложение про моду и персональный AI-стиль.

## Первый прототип

Папка `mobile/` содержит автономный offline-friendly прототип экранов по переданному HTML-дизайну:

- главная с образом дня;
- AI-стилист;
- состояние «собираю образ»;
- результат образа.

Дата на главной берётся с устройства. Погода для Праги обновляется через Open-Meteo при наличии сети; без сети остаётся встроенный запасной текст, поэтому прототип продолжает работать офлайн. Metti не связан с другими проектами.

## Supabase

Metti подключён к отдельному Supabase-проекту. Клиентский publishable key находится в `mobile/supabase-config.js`; секретные ключи в приложение не добавляются. Схема и RLS-политики находятся в `supabase/schema.sql`, а данные разделены по пользователям через Supabase Auth.

Гардероб хранится в `public.wardrobe_items`, фотографии — в приватном bucket `wardrobe`. Файлы складываются в папку с `auth.uid()`, а Storage-политики разрешают чтение, загрузку, замену и удаление только владельцу. Профиль и сохранённые образы используют те же RLS-ограничения.

Для прототипа в Auth отключено обязательное подтверждение email: регистрация сразу создаёт активную сессию и не требует письма. Восстановление пароля по-прежнему отправляет письмо по запросу пользователя.

Защищённые Edge Functions `metti-stylist` и `metti-mcp` используют один общий `StylistService`: он сам загружает гардероб, профиль и историю носки пользователя, мягко фильтрует кандидатов, вызывает AI и валидирует каждый `itemId`. MCP не содержит отдельного стилиста или отдельной логики промтов. Сначала используется Gemini через секрет `GEMINI_API_KEY` (модель `gemini-3.5-flash-lite`), а если Gemini недоступен или исчерпал лимит, автоматически подключается `OPENAI_API_KEY`. Если оба провайдера временно недоступны или не настроены, функция возвращает базовый образ из гардероба без внешнего AI, чтобы приложение не показывало ошибку. Добавьте секреты в Supabase Dashboard → Edge Functions → Secrets; ключи никогда не хранятся в приложении и не должны попадать в Git.

Обработка фотографий гардероба вынесена в общий backend image-service. В развёрнутом проекте по умолчанию используется Cloudflare Worker `metti-image-processor` с `segment=foreground`/BiRefNet; для category-aware обработки `METTI_IMAGE_PROCESSOR_URL` заменяет его на приватный `services/image-processor/` с `grounding_dino_sam2`, детектором по категории, SAM/SAM2 и matting. Supabase Edge Functions передают оригинал, получают прозрачный PNG-cutout и метрики качества, а затем сохраняют оригинал и проверенную квадратную карточку. Инструкция запуска и контракт находятся в `docs/IMAGE_PROCESSING.md`, `cloudflare/image-processor/README.md` и `services/image-processor/README.md`.

Удаление аккаунта выполняет отдельная защищённая Edge Function `metti-delete-account`: она удаляет приватные фотографии, затем Auth-пользователя, а связанные профиль, гардероб и образы удаляются каскадно. Секретный service-role ключ используется только внутри функции.

## Android release

Для установки на подключённый телефон используется debug-сборка:

`android/app/build/outputs/apk/debug/app-debug.apk`

Подписанный production App Bundle для Google Play собирается здесь:

`android/app/build/outputs/bundle/release/app-release.aab`

Android-проект целится в API 36, а `versionCode` первой публикации равен `1`. Ключ загрузки хранится вне Git в `.tools/metti-upload-key.jks`; локальные параметры подписи находятся в игнорируемом `android/keystore.properties`. Не удаляйте и не публикуйте их: тот же upload-key нужен для будущих обновлений.

Подробные команды сборки и шаги Play Console находятся в `docs/android-release.md`. Debug APK проверен установкой на подключённый Android-телефон; системные отступы для target API 36 обработаны в `MainActivity`.

Для Google-входа в Android используется redirect URI `metti://auth-callback`; он уже добавлен в Supabase Auth → URL Configuration → Redirect URLs рядом с web-адресом прототипа.

## Legal pages and Play Console

Страницы `mobile/privacy.html` и `mobile/account-deletion.html` опубликованы через workflow GitHub Pages. После включения GitHub Pages с источником **GitHub Actions** в настройках репозитория будут доступны:

- `https://crazynata.github.io/metti/privacy.html`;
- `https://crazynata.github.io/metti/account-deletion.html`.

После включения Pages добавьте адрес `https://crazynata.github.io/metti/account-deletion.html` в Supabase Auth → URL Configuration → Redirect URLs, чтобы Google-пользователь мог подтвердить удаление через веб-форму. Внутри приложения удаление доступно из профиля независимо от способа входа.

Перед отправкой релиза в Play Console остаётся заполнить карточку приложения, Data Safety, контентные анкеты, возрастной рейтинг, контакты поддержки и загрузить скриншоты/иконку. Для Google-входа после первой загрузки также добавьте SHA-1/SHA-256 сертификата Play App Signing в Google Cloud OAuth client.
