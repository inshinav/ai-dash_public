# Локальный аудит Claude Code и доступов

Дата: 28 сентября 2026. Проверка только чтением; настройки и подключения не менялись. Без генерации ответа Claude, OAuth, соединения с сервером или доступа к содержимому секретов и истории диалогов. Машиночитаемый результат — `local-audit.json`.

## Подтверждённое состояние

- Claude Code установлен: `C:\Users\Alex\.local\bin\claude.exe`, версия **2.1.126**.
- `claude auth status`: **loggedIn=false**, `authMethod=none`, `apiProvider=firstParty`, код завершения 1. Наличие файла credentials не подтверждает действующую авторизацию. Для начала потребуется войти в Claude; тариф и доступность моделей не проверены.
- В `C:\Users\Alex\.claude\settings.json` **нет заданных `model` и `effortLevel`**. `permissions.defaultMode` уже равен **`bypassPermissions`**. Это существующая настройка Alex; аудит её не включал и не менял.
- В `C:\Users\Alex\.claude\settings.local.json` `model`, `effortLevel` и `permissions.defaultMode` не заданы. Есть событие **PostToolUse**, 1 группа и 1 hook. Команда hook не извлекалась. Применимость этого файла в домашней папке как local-настроек надо проверить по правилам текущего Claude, не считать автоматически глобальной.
- CLI перечисляет effort: **low, medium, high, xhigh, max**. Режим `ultra` в его `--help` не перечислен. Это перечень CLI, а не проверка поддержки каждого уровня конкретной моделью или тарифом.
- CLI перечисляет permission modes: `acceptEdits`, `auto`, `bypassPermissions`, `default`, `dontAsk`, `plan`.
- Пользовательского `C:\Users\Alex\.claude\CLAUDE.md` нет. Также нет `CLAUDE.md` в `C:\Users\Alex`, `Documents`, `Documents\Codex`, текущей дате и текущем каталоге задачи. Другие проекты на наличие инструкций этим аудитом не обследовались.
- Git **2.53.0.windows.2**, Node **v24.15.0**, GitHub CLI **2.96.0**.
- GitHub CLI уже авторизован на `github.com`, активный аккаунт **inshinav**, хранение в keyring, Git protocol SSH, scopes `gist`, `read:org`, `repo`. Секрет не экспортировался. Доступность отдельных репозиториев этим не проверена.
- `ssh -G inshinlab-vps` разрешает **root@107.189.20.126:22**. Это проверка локальной конфигурации, не успешного соединения. Подключения к production не было.

## Существующие MCP и навыки

В `.claude.json` глобально записаны **codex (stdio), stitch (http), refero (http)**. Есть project-scoped **refero** для `C:/Users/Alex` и **stitch** для `C:/Windows/system32`. Endpoints, commands, headers и значения переменных окружения не извлекались. Работоспособность MCP не проверена. Project-scoped записи не означают доступность сервера во всех проектах.

В Codex config найдены корневые секции MCP: `node_repl`, `claude_code`, `cloudflare`, `cloudflare-docs`, `cloudflare-bindings`, `cloudflare-builds`, `cloudflare-observability`, `openaiDeveloperDocs`, `cua_repl`. Запись сервера не доказывает его переносимость в Claude: app-specific среды исполнения, инструменты и OAuth нужно проверять отдельно.

В `.claude/skills` уже 19 каталогов: `animation-vocabulary`, `brandkit`, `cro`, `design-taste-frontend`, `design-taste-frontend-v1`, `emil-design-eng`, `full-output-enforcement`, `gpt-taste`, `high-end-visual-design`, `image-to-code`, `imagegen-frontend-mobile`, `imagegen-frontend-web`, `impeccable`, `industrial-brutalist-ui`, `landing-page-guide-v2`, `minimalist-ui`, `redesign-existing-projects`, `review-animations`, `stitch-design-taste`.

В `.codex/skills` есть личные `alex-content`, `motolola-reels-text`, `motolola-seedance` и системный каталог `.system`.

В `.agents/skills` есть `agents-sdk`, `cloudflare`, `cloudflare-email-service`, `cloudflare-one`, `cloudflare-one-migrations`, `durable-objects`, `sandbox-sdk`, `turnstile-spin`, `web-perf`, `workers-best-practices`, `wrangler`.

Перечень имён не подтверждает совместимость содержимого навыков. Содержимое в рамках этого аудита не читалось.

## Условия корректного переноса

1. Сначала отдельный вход пользователя в Claude и проверка доступных моделей/тарифа. Названия моделей и уровень усилия задавать по актуальной документации и реально доступным опциям; не трактовать отсутствие model/effort в JSON как конкретный выбранный режим.
2. Перед изменениями сделать локальный backup настроек. Объединять JSON по ключам, сохранять существующие hooks, permissions, env и MCP. Не заменять пользовательские файлы шаблоном целиком.
3. Отдельно учитывать уже включённый `bypassPermissions`. Он не равен доступу к аккаунтам и не устраняет OAuth. Не переключать режим незаметно и не обещать, что инструкции `CLAUDE.md` технически ограничивают этот режим.
4. Существующий Claude MCP `codex` и Codex MCP `claude_code` могут создать перекрёстное делегирование. Не включать вызов одной системы из другой автоматически как способ достижения автономности; проверить назначение перед использованием.
5. Не дублировать установленные навыки автоматически. Есть потенциально пересекающиеся design-навыки и обе версии `design-taste-frontend`; выбрать по содержимому и конкретной задаче, сохраняя существующее.
6. GitHub можно переиспользовать через установленный `gh`; SSH — через существующий alias. Проверять доступ минимальными read-only действиями в рамках будущей разрешённой настройки, без копирования секретов в инструкции.
7. Глобальный `CLAUDE.md` можно добавить как новый файл, но непосредственно перед установкой вновь проверить его наличие, чтобы не затереть изменения, появившиеся после аудита.

## Границы проверки

Не читались содержимое `.credentials.json`, SSH private keys, `.env`, raw sessions, команды hooks, секретные значения из env или MCP. Не выполнялись `claude doctor` (он способен запускать MCP), генерация, авторизация браузером, обновление CLI, установка плагинов или навыков, SSH-соединение, запросы к production. Аудит не подтверждает end-to-end работу Claude, MCP или конкретных проектов.
