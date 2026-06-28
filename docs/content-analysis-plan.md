# Content-first analysis — roadmap

**Goal (owner's direction):** the dashboard must first understand **what happens in
each reel** (action, scene, hook, subject), and base everything on that — derive the
hook, explain *why* a reel got its metrics (won or not), and make the winning
patterns reusable. Metrics are secondary to "what in the content drove them".

This doc is the source of truth so any session can continue autonomously.

## Data model (added to `Entry` and surfaced on `PostRecord` via `derive.ts`)
- `contentAnalysis: {`
  - `hook` — что в первые 1–3 сек цепляет (визуально/текстом/звуком)
  - `scene` — обстановка/сеттинг
  - `action` — что происходит, ключевое действие
  - `subject` — кто/что в кадре (модель, объект, крупность)
  - `pacing` — динамика/монтаж/длина планов
  - `ending` — концовка / есть ли CTA / петля
  - `whyItWorked` — гипотеза, почему зашло или нет (привязка к retention/views)
  - `}` (все строки, всё необязательное)
- `contentTags: string[]` — машинные теги **содержания** (напр. «ночь», «байк»,
  «крупный план», «экшен», «разговор в камеру») — для группировки и сравнения.
  Отличаются от пользовательских `tags` (тема/кампания).
- `analyzedBy: '' | 'manual' | 'ai'`, `analyzedAt` — происхождение анализа.

Keep existing `hookType`, `textOnVideo`, `contentPillar`, `tags` — они дополняют.

## Stage 1 — manual content fields end-to-end  ✅ (this session)
- `server/types.ts` + `src/types.ts`: `ContentAnalysis`, fields on `Entry`; add
  `contentAnalysis` + `contentTags` to `PostRecord`.
- `server/derive.ts`: pass content fields through to the derived post.
- `server/entries.ts` `normalizeInput`/`migrateEntry`: validate/normalize.
- `server/manualIntake.ts`, `server/googleSheets.ts`: default empty (+ optional
  Sheets columns `Content tags`, `Why it worked`, `Action`, `Scene`).
- `src/EntryForm.tsx`: section «Что происходит в ролике» (hook/scene/action/
  subject/pacing/ending/whyItWorked + content tags).
- `src/App.tsx` reel page: panel «Что в ролике» + show `whyItWorked` by the verdict.

## Stage 2 — content-aware insights  ✅
- `src/lib.ts`: `groupByDimension` add `'contentTag'`; `createInsights` correlate
  content features (contentTags, hook) with median/ER → «ролики с „X" выше медианы
  на N%», «топ-3 ролика используют один хук». Reel verdict references the content
  reason, not just the number.
- Comparison page: add content-tag axis.

## Stage 3 — AI auto-analysis from the video (vision)  ✅ (opt-in: OPENAI_API_KEY / ANTHROPIC_API_KEY)
- `server/analyze.ts`: extract ~6 evenly-spaced frames via ffmpeg
  (`-ss` at 0/15/30/...% , downscale ~512px, jpeg), base64, call Claude vision
  (Anthropic Messages API, latest model) with a strict structured prompt →
  returns `contentAnalysis` + `contentTags` JSON (frames-only, no fabrication;
  hypothesis for whyItWorked may use the reel's metrics passed in the prompt).
- Endpoint `POST /api/entries/:id/analyze` (owner-gated, rate-limited). Writes a
  **draft** the owner reviews/edits in the form before saving.
- `server/config.ts`: `ANTHROPIC_API_KEY` (owner sets in `/etc/ai-dash.env`). If
  absent → feature hidden, everything else still works.
- `src/EntryForm.tsx`: «Проанализировать ИИ» button → calls endpoint → prefills
  the content section → owner confirms.

## Interim (until Stage 3 ships)
When the owner attaches a reel video in chat, Claude analyses it directly and fills
`contentAnalysis` + `contentTags` via the API / form. The Stage 1 fields are the
storage target, so nothing is wasted.

## Principles
- Frames/metrics only — никаких выдуманных причин; whyItWorked = явная гипотеза.
- Owner always reviews AI drafts before they're saved.
- Degrade gracefully: no API key → manual still works; no ffmpeg → skip frames.
