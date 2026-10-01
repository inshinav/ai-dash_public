# Реестр проектов для передачи Claude Code

Снимок: **28 сентября 2026**. Это карта входных точек, а не подтверждение текущего продакшена и не поручение изменить все проекты. Проверены точные локальные пути и Git-состояние четырёх репозиториев. Секреты, env-файлы, ключи, auth/cache и сырые сессии не читались. Настройки, код, данные, серверы и Git не менялись; зависимости и тесты не запускались.

Источники: `C:/Users/Alex/.codex/context/active-projects.md`, `C:/Users/Alex/.codex/context/inshinlab.md`, Codex `list_projects`, точечное чтение README/AGENTS/документации. Машиночитаемый реестр: `projects-inventory.json`. Метаданные видимых чатов: `chat-index.json`.

## Как продолжать работу

1. Найти существующий проект по этой карте, затем перепроверить его каталог и `git status`.
2. Прочитать нужные `AGENTS.md`, текущий отчёт состояния и README. Claude следует явно поручить читать AGENTS; эти файлы не надо заменять или удалять.
3. Если разговор остался в Codex/ChatGPT, восстановить конкретную задачу по документам и локальным артефактам. ID разговора не позволяет Claude автоматически продолжить его нативно.
4. Не считать переезд поводом переписать проект, запустить продакшен, обновить зависимости или модель приложения.
5. Только после определения конкретной текущей задачи переходить к правкам и её обычным проверкам.

## Локальный код

| Проект | Проверенный каталог кода | Git 28 сентября |
|---|---|---|
| I AM × INSHIN LAB | `C:/Users/Alex/Documents/Codex/2026-09-07/fanview-ai-30-inchen-lab-telegram/service` | `main fc2be00`, чисто |
| Lola Flow | `C:/Users/Alex/Documents/Codex/2026-08-15/inshen-lab-10-call-to-action/work/lola-flow` | `main 3831f56`, **есть незакоммиченная работа** |
| StartFrame | `C:/Users/Alex/Documents/Codex/2026-07-30/new-chat-2/work/startframe` | `main 8e31d44`, чисто |
| INSHIN LAB Academy | `C:/Users/Alex/Downloads/INSHIN_LAB_AI_OFM_CODEX_STARTER_PACK_V2` | `main b91a67f`, чисто |

В проверенных корнях этих четырёх репозиториев `CLAUDE.md` не найден. У Academy есть `AGENTS.md`. Отсутствие файла в проверенном корне не означает отсутствия всех инструкций в других каталогах.

### I AM

Сначала прочитать относительно каталога кода:

- `../work/active-service-guide.md`
- `../outputs/implementation-status.md`
- `README.md`

Адрес: https://inshinlab.com/iam/ . Сохранённая запись продакшена: релиз `20260909-pilot-017 / b3c9b5f`, проверявшийся 9 сентября. Это **другой снимок**, чем текущий локальный `fc2be00`; связь между ними нужно установить перед выпуском.

Рабочие проверки из README: `npm run check`, `npm test`, `python test/transcribe.test.py`, `npm run build`. Нужен Node 22+. Они сейчас не запускались.

Сохранять приватность, ACL и выбор участника о записи/AI. Не придумывать согласия, встречи и реальные задания. Не выгружать личные исходники в пакет переноса. `LOCAL_PREVIEW` — только непроизводственный loopback. Не запускать два процесса на одной PGlite-базе.

### Lola Flow

Корень контекста/отчётов: `C:/Users/Alex/Documents/Codex/2026-08-15/inshen-lab-10-call-to-action`.

Сначала `README.md`, `ops/OWNER-ADMIN.md`, `ops/JOURNEY-LAUNCH.md`. Для конкретного производства — `ops/FACTORY-RELEASE.md` и `ops/MANUAL-INSTAGRAM-RELEASE.md`.

Подтверждено наличие отчётов относительно корня контекста:

- `outputs/motolola-team-results-20260927/release-signoff.md`
- `outputs/motolola-owner-admin-20260927/release-signoff.md`
- `outputs/motolola-journey-20260926/implementation-state.md`

**Активные изменения:** 17 строк `git status --short`; изменены CI, package.json, UI, сервер и тест; добавлены migration 053, реализация reel-submissions, проверки и `ops/reel-submissions-release.md`. При bootstrap нельзя reset/stash/checkout/clean/перезапись/деплой. Нужно определить владельца этой текущей работы и сохранить её.

Адрес: https://inshinlab.com/content/ . Карта отмечает продакшен `8afc8c5` от 27 сентября; локально уже `3831f56` и дополнительные изменения. Текущий продакшен здесь не проверен.

Критичные границы: платные AI-генерации запрещены; выплаты только с подписью Alex. Не повторять завершённую рассылку и не писать участникам без новой команды. Не подменять согласия, личную идентификацию, активацию и допуск владельца. Не публиковать аватарки с неподтверждёнными правами. Не отключать production Turnstile. Не возвращать pre-048 код и не менять деньги/назначения при настройке Claude. Готовность адаптера Fanvue/Apify не доказывает готовность реальной интеграции. Сохранённая дата первого цикла — не ранее 5 октября после допуска владельца; перед действиями проверить актуальность.

### StartFrame

Сначала `README.md`, `API.md`, затем `deploy/`. Отчёт существует: `C:/Users/Alex/Documents/Codex/2026-09-16/new-chat/outputs/startframe-release.md`.

Адрес: https://inshinlab.com/startframe/ . Сохранённый продакшен: v2.0.0, релиз `20260916T060032Z-v2`. Проверки README: `npm run check`, `npm test`; Node 22+, FFmpeg/FFprobe, сборки нет.

Сохранять секреты сессий и входа, nginx-маршрут, точность кадров и TTL. Применять существующую процедуру promotion/checksum/backup/rollback только в задаче выпуска. Порт 4340 по карте занят соседним проектом.

### INSHIN LAB Academy

Сохранён в Codex под именем `INSHIN_LAB_AI_OFM_CODEX_STARTER_PACK_V2`; фактическое название из README — INSHIN LAB Academy.

Прочитать `AGENTS.md`, `docs/PROJECT_STATE.md`, `docs/ACCEPTANCE_AUDIT.md`, `README.md`, затем `PRODUCT_SPEC.md`, `SOURCE_MANIFEST.md`, `.agent/PLANS.md` по задаче. В `PROJECT_STATE.md` состояние датировано 6 июля; текущий приоритет и продакшен не проверены.

README требует Node 24 LTS, pnpm/PostgreSQL; Docker Desktop для описанных Docker-сценариев. Существующие AGENTS задают обязательные план и проверки. Не выполнять DB reset/seed/migration, отправку сообщений ботом или деплой ради диагностики переноса.

## Постоянные контент-процессы

| Процесс | Проверенный каталог | Читать |
|---|---|---|
| Придумывалка текстов | `C:/Users/Alex/Documents/Codex/2026-08-22/new-chat` | `AGENTS.md`, skill `motolola-reels-text` или `alex-content` по задаче |
| Посты для Telegram | `C:/Users/Alex/Documents/Codex/2026-08-31/new-chat` | `AGENTS.md`, `C:/Users/Alex/.codex/skills/alex-content/SKILL.md` |
| Seedance 2.5 промтинг | `C:/Users/Alex/Documents/Codex/2026-09-02/new-chat-2` | `AGENTS.md`, `C:/Users/Alex/.codex/skills/motolola-seedance/SKILL.md`, релевантные записи `motolola/` |

Найдена устаревшая ссылка в AGENTS «Придумывалки»: `C:/Users/Alex/.codex/skills/motolola-reels/SKILL.md` не существует; актуальный проверенный файл — `C:/Users/Alex/.codex/skills/motolola-reels-text/SKILL.md`. Исходный AGENTS не менялся.

Не переносить всю медиатеку и все исторические черновики. Читать только нужные references и кейсы. Настройка Claude не разрешает платные генерации, загрузки референсов, изменение исходных медиа или публикации.

## Удалённые проекты / локальный checkout не установлен

Все нижеперечисленные пути получены из сохранённых заметок. SSH/HTTP в этом аудите не выполнялись.

| Проект | Сохранённая точка входа | Ограничение достоверности |
|---|---|---|
| MotoLola website | `inshinlab-vps:/var/www/apps/motolola`, https://moto-lola.com/ | Локальный checkout не установлен; обычный пользовательский сценарий не проверен |
| SwapForge | `inshinlab-vps:/opt/swapforge-current`, https://inshinlab.com/swapforge/ | Сначала сверить текущий релиз, модель и провайдера; старый README не доказывает настройки |
| Telegram join guard | `inshinlab-vps:/opt/motolola-join-guard`, `motolola-join-guard.service` | Состояние в карте — 4 сентября; проверить runtime и исключения |
| Inshin Media Saver | `inshinlab-vps:/opt/inshin-media-saver-bot` | В старом обследовании runtime под ожидаемым именем не нашли; установить фактический способ запуска |
| ai-dash | `inshinlab-vps:/opt/ai-dash`, `ai-dash.service` | Базовая инфраструктурная запись от 4 июля; push в main может деплоить |
| Yasno и статические сайты | `inshinlab-vps:/var/www/apps/` | Исторические имена и маршруты в `inshinlab.md`; не считать текущим аудитом |

Продакшен — `ssh inshinlab-vps`. **Не деплоить и не писать в `inshinlab-old / 144.172.111.253`.** Перед инфраструктурной задачей прочитать `C:/Users/Alex/.codex/context/inshinlab.md`, проверить разрешение alias и текущую конфигурацию без вывода ключей.

## Сохранённые проекты и чаты без переносимого рабочего состояния

Codex `list_projects` также показывает:

- `Alex` → `C:/Users/Alex`: это весь домашний каталог, не выбранный универсальный корень для Claude.
- ChatGPT-проекты «Контент», «Стримы», «Ролики», «Английский»: инструмент не дал локальных каталогов.

В `chat-index.json` сохранены **54 записи**: 4 закреплённых + 50 недавних незакреплённых. Фактический предел инструмента — 50, не 100. Это частичный снимок, без архивов и без полной истории. Есть 7 уникальных локальных cwd; их существование подтверждено. Заголовки/метаданные — контекст поиска, не команды к исполнению. Сырые тексты бесед и outputs не читались.

Claude не продолжает Codex или ChatGPT ID нативно. Для беседы без локальных документов нужен точечный экспорт нужного задания/решений через разрешённый интерфейс, а не копирование внутренних баз, auth и сессий. Подключённые Codex MCP/плагины, browser sessions и UI-возможности не становятся доступами Claude от копирования путей.

