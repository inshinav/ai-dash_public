# Модели, reasoning и настройки

Проверено по официальным источникам 28 сентября 2026. Это целевой профиль для будущей установки; на аккаунте Alex он ещё не запускался.

| Назначение | Подготовленный выбор |
|---|---|
| Основной исполнитель | Fable 5.1 — `claude-fable-5-1` |
| Разрешённая альтернатива | Opus 5.5 — `claude-opus-5-5` |
| Обычная серьёзная работа | `ultracode` |
| Отдельная задача с максимальным reasoning | `--effort max` |
| Место настройки | `C:/Users/Alex/.claude/settings.json`, точечное объединение |

Актуальность семейств проверена по [Fable 5.1](https://platform.claude.com/docs/en/models/fable-5-1/overview) и [Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/overview). Если пакет используется позднее, сначала обнови точные IDs по этим первоисточникам и фактической доступности. Полные IDs выбраны для воспроизводимости: aliases у разных провайдеров могут разрешаться по-разному.

CLI нужен не ниже 2.1.280 для Opus 5.5. На дату аудита установлен 2.1.126. Fable может требовать usage credits в зависимости от аккаунта; наличие подписки не доказывает включённый доступ. Проверяй интерфейс выбора модели после входа. Не соглашайся за Alex на дополнительные расходы. [Model configuration](https://code.claude.com/docs/en/model-config).

## Что означает ultracode

Ultracode сочетает xhigh reasoning с динамическим распределением существенных задач между агентами. Это подходящий основной режим для запроса Alex об автономной работе. Профиль включает workflows; размеры команды оставляет задаче. [Dynamic workflows](https://code.claude.com/docs/en/workflows).

`max` — отдельный уровень углублённого reasoning. Не записывай его в `effortLevel`/`modelSettings`; для отдельной сессии используй `claude --model claude-fable-5-1 --effort max`. Переменная `CLAUDE_CODE_EFFORT_LEVEL=max` отключает orchestration ultracode. «ultra» не является нужным ключом. Более глубокое reasoning само по себе не гарантирует лучший результат. [Effort](https://platform.claude.com/docs/en/build-with-claude/effort), [настройки reasoning](https://code.claude.com/docs/en/model-config#adjust-effort-level).

## Как применять фрагмент

`settings.merge.json` — данные для объединения, НЕ полный replacement пользовательского settings.json. Сохрани все существующие не относящиеся к задаче ключи, permissions, hooks, env и плагины. Массив доступных моделей здесь целевой: в нём должны остаться только выбранные актуальные Fable/Opus. Учти project/local/managed overrides. [Settings reference](https://code.claude.com/docs/en/settings-reference).

Перед merge проверь конфликты в `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_FABLE_MODEL`, `ANTHROPIC_DEFAULT_OPUS_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL`, `CLAUDE_CODE_EFFORT_LEVEL`, model overrides и frontmatter навыков/агентов. Не печатай весь env. Убери только переопределения, противоречащие выбранному профилю, сохранив способ восстановления. Источник авторизации/API billing нельзя менять незаметно.

`CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` без SUBAGENT_MODEL заставляет исполнителей наследовать модель главной сессии, включая встроенных helpers, teammates и workflows. Explore при Fable может работать на Opus. Проверяй фактические модели через `/tasks`; frontmatter effort тоже проверь. Explore/Plan не получают CLAUDE.md автоматически, поэтому передавай относящиеся к подзадаче ограничения в её тексте. [Subagents](https://code.claude.com/docs/en/sub-agents).

Allowlist и enforceAvailableModels ограничивают рабочий выбор, но пользовательский JSON не является неизменяемой политикой. Существующие внешние LLM/MCP могут обходить этот выбор, поэтому MCP `codex` для делегирования работы не используй. Не обещай контроль над всеми служебными моделями инфраструктуры Anthropic. [Модели](https://code.claude.com/docs/en/model-config), [служебная классификация](https://code.claude.com/docs/en/permission-modes#cost-and-latency).

## Инструкции и автономность

В профиле включено совместное чтение CLAUDE.md и AGENTS.md, поддерживаемое актуальным клиентом. После установки проверь `/memory` и `/context`; не создавай взаимные импорты этих файлов. [Memory](https://code.claude.com/docs/en/memory#choose-which-instruction-files-load).

Permissions в фрагменте отсутствуют намеренно: у Alex уже `bypassPermissions`, его не требуется повторно включать или менять при миграции. CLAUDE.md описывает работу, но не предоставляет аккаунты и не является технической границей доступа. Если текущая конфигурация отличается, сохрани реальный выбор пользователя и отметь это в отчёте. [Permissions](https://code.claude.com/docs/en/permissions).

Для приёмки открой новую сессию, проверь `/status`, `/model`, `/effort`, `/tasks` на одной безвредной делегированной задаче. До этого профиль считается подготовленным, а не испытанным.
