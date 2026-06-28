# Production deployment

Сервис разворачивается отдельно от корневого сайта:

- приложение: `/opt/ai-dash`;
- private storage: `/var/lib/ai-dash`;
- env: `/etc/ai-dash.env` (`chmod 600`);
- process manager: systemd;
- listen: `127.0.0.1:4310`;
- public path: `/ai-dash/`.

## Обновление одной командой (рекомендуется)

После первой установки выкатка новой версии — одна команда на VPS (от root):

```bash
bash /opt/ai-dash/deploy.sh
```

> Запускайте локальную копию скрипта на сервере (она сама подтягивает свежий `origin/main`).
> В этом публичном зеркале CI выполняет только проверки (`.github/workflows/ci.yml`);
> продакшен-деплой настроен в приватном репозитории.

`deploy.sh` идемпотентен и делает всё сам: бэкап данных в `/var/backups/`,
`git reset --hard origin/main` (или `git clone`, если кода ещё нет),
`npm ci && npm run build && npm prune --omit=dev`, `chown www-data`, рестарт
сервиса и проверку health. **Данные в `/var/lib/ai-dash` не трогаются.** Превью
роликов самовосстанавливаются (кадр ffmpeg генерится при первом запросе, без
отдельного пост-скрипта).

Если в ответе health есть блок `stores` — новая версия поднялась. Откат — см.
раздел «Откат при неудаче» ниже.

Разделы 1–5 описывают **первую установку** и ручные шаги на случай отладки.

## 1. Server prerequisites

```bash
apt-get update
apt-get install -y git ffmpeg nginx
node --version # Node.js 20+
```

## 2. Checkout and build

```bash
git clone https://github.com/inshinav/ai-dash.git /opt/ai-dash
cd /opt/ai-dash
npm ci
npm run check
npm prune --omit=dev
mkdir -p /var/lib/ai-dash
chown -R www-data:www-data /var/lib/ai-dash /opt/ai-dash
```

`/var/lib/ai-dash` (записи владельца, видео, скриншоты, metadata) живёт **вне**
`/opt/ai-dash` и переживает любые деплои. Никогда не размещайте storage внутри
репозитория и не трогайте его при обновлении кода.

Обновление вручную — по шагам (то же, что автоматизирует `deploy.sh`, но с
запоминанием коммита для быстрого отката):

```bash
cd /opt/ai-dash
# 1. бэкап данных и запоминаем текущий коммит для отката
tar czf /var/backups/ai-dash-$(date +%F-%H%M).tgz -C /var/lib ai-dash
PREV=$(git rev-parse HEAD)
# 2. обновление
git pull --ff-only origin main
npm ci
npm run check   # на сервере можно ограничиться `npm run build` (lint+тесты гоняются в разработке)
npm prune --omit=dev
chown -R www-data:www-data /opt/ai-dash
systemctl restart ai-dash
curl -fsS http://127.0.0.1:4310/ai-dash/api/health
```

Откат при неудаче (данные в `/var/lib/ai-dash` не трогаются):

```bash
cd /opt/ai-dash
git reset --hard "$PREV"
npm ci && npm run build && npm prune --omit=dev
systemctl restart ai-dash
```

## 3. Environment

```bash
install -m 600 -o root -g root /opt/ai-dash/.env.example /etc/ai-dash.env
editor /etc/ai-dash.env
```

Обязательно задайте случайный `ADMIN_TOKEN` длиной не менее 32 символов (алиас
`CODEX_ADMIN_TOKEN` тоже принимается). Это токен владельца: он гейтит весь ввод
данных (создание/редактирование/удаление роликов, загрузку медиа, синхронизацию).
Google Sheets опционален — для service account рекомендуется
`GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`, а не многострочный JSON.

Опционально: задайте ключ, чтобы включить ИИ-анализ видео (кнопка
«Проанализировать ИИ» на странице ролика). По умолчанию используется OpenAI —
задайте `OPENAI_API_KEY` (модель по умолчанию `gpt-5.5`). Альтернатива —
`ANTHROPIC_API_KEY` (модель `claude-sonnet-4-6`). Провайдер определяется автоматически
по тому, какой ключ задан; можно зафиксировать через `ANALYZE_PROVIDER=openai|anthropic`
и переопределить модель через `ANALYZE_MODEL`. Без ключа фича скрыта, всё остальное
работает.

## 4. systemd

```bash
cp /opt/ai-dash/deploy/ai-dash.service /etc/systemd/system/ai-dash.service
systemctl daemon-reload
systemctl enable --now ai-dash
systemctl status ai-dash --no-pager
curl -fsS http://127.0.0.1:4310/ai-dash/api/health
```

## 5. nginx

Содержимое `deploy/nginx-location.conf` добавляется внутрь существующего
`server {}` для `inshinlab.com`. Оно затрагивает только `/ai-dash`.

```bash
nginx -t
systemctl reload nginx
```

Не удаляйте `/var/www/html`, существующие `location` и другие приложения.

## 6. Verification

```bash
curl -sSI https://inshinlab.com/ | head -n1
curl -sSI https://inshinlab.com/ai-dash/ | head -n1
curl -sS https://inshinlab.com/ai-dash/api/health
curl -sSI https://inshinlab.com/ai-dash/posts/test | head -n1
```

Ожидается:

- корень сайта: `200`;
- `/ai-dash/`: `200`;
- health: JSON с `ok: true` и блоком `stores` (entries/metadata);
- вложенный frontend-маршрут: `200`;
- `/ai-dash/api/data` без токена: `200` (дашборд открыт на чтение);
- любая мутация без токена — `401`, например:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://inshinlab.com/ai-dash/api/entries
# ожидается 401
```
