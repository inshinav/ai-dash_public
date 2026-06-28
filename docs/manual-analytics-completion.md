# Manual Analytics Completion ("Досбор данных")

> The subsystem that fills the metrics no API can return — by telling the owner exactly
> which 2–3 screenshots to take, reading the numbers from them, and asking the user to
> confirm only the uncertain ones. **Built and tested** in this slice (additive, owner‑gated,
> runs on the existing JSON stores).

## Why it exists

Per [`social-api-feasibility.md`](social-api-feasibility.md): TikTok depth metrics
(avg watch, completion, retention, traffic, demographics, profile visits, follows) and
Instagram per‑Reel demographics / traffic / hold / completion are **not** in any API a normal
creator SaaS can use. They are a permanent part of the product, not an afterthought.

## How it works (pipeline)

```
merged PostRecords ──┐
confirmed snapshots ─┤→ requirement engine ──→ tasks (content + account, prioritized)
connector caps ──────┘        │
                              │ owner opens a task on phone
                              ▼
   guide (which screen, 2–4 steps) → "Open in Instagram/TikTok" (official share URL)
                              ▼
   pick 2–3 screenshots → schema-guided extraction (vision, whitelisted to that screen)
                              ▼
   confirm UI: high-confidence auto-checked, low-confidence highlighted/editable, null stays null
                              ▼
   confirmed → append-only metric_snapshots (source=screenshot, provenance) → recompute tasks
```

## Components (code)

| Concern | File | Tested |
|---|---|---|
| Canonical metric registry + per‑platform availability | `server/saas/metrics.ts` | via engine tests |
| Requirement engine (missing → tasks, age‑gating, priority, completeness) | `server/saas/completion.ts` | `completion.test.ts` |
| Bridge: PostRecords + snapshots → tasks | `server/saas/completionService.ts` | smoke + engine tests |
| Provenance snapshots + value‑selection policy + fold‑back | `server/saas/snapshots.ts` | `snapshots.test.ts` |
| Append‑only snapshot store (JSON sidecar) | `server/saas/store.ts` | smoke |
| Locale‑aware parsing + schema‑guided normalization | `server/saas/extraction.ts` | `extraction.test.ts` |
| Vision extractor (reuses `analyze.ts`) | `server/saas/visionExtractor.ts` | manual/fixture |
| Screen guides (versioned, data‑driven) | `server/saas/guides.ts` | — |
| Mobile wizard (standalone, no SPA coupling) | `server/public/` | smoke (HTTP 200) |

## Requirement engine

`computeContentTask(content, present, opts)` / `computeAccountTask(...)`:

- **`present`** = canonical keys already known (legacy non‑null values **and** confirmed snapshots) → a metric the API/manual flow already has is never asked for.
- For each metric, `expectedSourceFor` decides `api` / `screenshot` / `derived` / `manual` / `unsupported` from the registry **and** whether a live connector is attached. Unsupported and derived metrics are never asked for.
- **Age‑gating:** a content task is `scheduled` (not surfaced) until the reel is old enough and the metric's `availableAfterHours` has passed — don't ask before analytics form.
- **Two task levels:** content‑level (per reel) and account‑level (one per account/period — follower demographics are never asked per reel).
- **Status:** `needs_screenshots · partially_completed · scheduled · awaiting_api · completed · no_longer_required`.
- **Priority:** critical screenshot gaps dominate, fresh/partially‑filled reels bubble up; stale account audience is re‑asked after N days.
- After every confirm (or future API sync) tasks are recomputed → a value the API later returns drops its screenshot ask automatically. *(Verified in the smoke test: confirming `reach` removed it from the task's missing list.)*

## Provenance & value selection

Every value is a `MetricSnapshot` with `source`, `observedAt`, `collectedAt`, `confidence`,
`confirmed`, `period`, `segment`, `screenshotId`, `extractionVersion`. Nothing is overwritten.
`selectCurrent` chooses the canonical value by an **explicit policy** (not "API always beats
screenshot"): confirmed > unconfirmed → non‑null > null → later `observedAt` → higher
confidence → more‑trusted source. `foldSnapshotsToMetrics` projects the chosen values back
into the existing `EntryMetrics`/`extraMetrics` shape so the **current dashboard, Creative ID,
weighted audience, and analytics keep working unchanged**, now with a per‑field provenance tag
(API / Screenshot / Manual / Derived).

## Extraction

`extraction.ts` owns the deterministic, tested part:

- `parseCompactNumber` — `12.5K`, `12,5K`, `12,5 тыс.`, `1.2M`, `12 500`, `1 250` (locale‑aware decimal/grouping).
- `parsePercent` — `34.7%`, `34,7 %`.
- `parseDuration` — `6.8s`, `6,8 с`, `1:23`, `1:02:03`, `1m 23s`, `2 мин 5 сек`.
- `buildExtractionResult` whitelists candidates to the metrics that screen can yield, normalizes by metric kind (count/seconds/fraction/percent), attaches confidence, and **never fabricates an unreadable value (stays `null` with a warning).**

The multimodal read is a `ScreenshotExtractor` (production `VisionExtractor` reuses the
existing `analyze.ts` provider). With no vision key it returns empty + a warning so the wizard
degrades to manual entry. `FixtureExtractor` makes the whole flow testable with no model.

## Mobile wizard (`/ai-dash/complete`)

Standalone HTML/CSS/JS served from `server/public/` (isolated from the 3k‑line SPA,
CSP‑compatible). Flow: token unlock → **task list** (actionable first, with completeness bar)
→ **task** → per‑screen guide + **"Open in Instagram/TikTok"** (official share URL) → pick
screenshots → **Распознать** → editable metric rows (low‑confidence highlighted, raw text
shown) → **Подтвердить**. The active task is stored in `sessionStorage` so switching to the
platform app and back **does not reset the wizard**. Target: ~1 minute per reel after habit.

## API (all owner‑gated; `X-AI-Dash-Admin-Token`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/completion/tasks` | prioritized content + account tasks (+ completeness per content) |
| GET | `/api/completion/tasks/:id` | one task + screen guides + post share URL |
| GET | `/api/completion/guides` | all screen guides (versioned) |
| POST | `/api/completion/tasks/:id/screenshots` | upload screenshots + `screenType` → auto‑extract for confirmation |
| POST | `/api/completion/tasks/:id/confirm` | confirmed values → append metric snapshots → recompute |

`/api/health` now reports `stores.snapshots` and `features.completion`.

## Privacy

Screenshots can contain sensitive data. Today they are stored under `STORAGE_DIR/screenshots`
(server‑generated UUID names, owner‑only intake) and are **not** exposed by any public route
(unlike the legacy `/screenshots/:id`, which only resolves entry/seed screenshots). The
structured values survive even if the image is later deleted. Target hardening (Milestone 7):
tenant‑scoped storage, signed short‑lived URLs, encryption at rest, retention policy +
optional auto‑delete after confirmed extraction, audit log, no model training on customer
screenshots without explicit opt‑in.

## Tested behaviours (66 passing tests + a live smoke run)

- Locale number/percent/duration parsing across the prompt's examples.
- TikTok depth metrics routed to screenshots, basic counts to API; IG insights to API, completion marked unsupported.
- Tasks grouped by screen; age‑gating (`scheduled` when too young); `partially_completed` only when a *screenshot‑sourced* value is present (not an API value that's merely also screenshotable).
- Confirm appends provenance‑tagged snapshots; the just‑supplied metric leaves the missing list.
- `null ≠ 0`, confirmed‑beats‑unconfirmed, recency, and source‑trust tie‑breaks in `selectCurrent`.
