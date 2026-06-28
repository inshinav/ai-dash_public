# AI Dash — current architecture audit

> Phase‑1 audit of the production system before any SaaS evolution.
> Date: 2026‑06‑27 · Branch `main` · grounded in the actual source, not the README.
> Local checkout reflects the seed only; the live owner corpus (~27 LIVE reels) lives
> in `STORAGE_DIR/entries.json` on the VPS and is **not** in git.

---

## 1. Component map

```
                         ┌─────────────────────────── browser ───────────────────────────┐
                         │  React 19 SPA (src/, Vite build → dist/)                        │
                         │  App.tsx (~3068 lines) · owner token in localStorage            │
                         │  api.ts → fetch /ai-dash/api/* with X-AI-Dash-Admin-Token       │
                         └───────────────┬───────────────────────────────┬────────────────┘
                                         │ JSON (read)                    │ JSON+multipart (write, owner only)
                                         ▼                                ▼
        ┌──────────────────────────── Express 5 (server/index.ts, 127.0.0.1:4310) ──────────────────────────┐
        │ helmet CSP · per-IP rate limit (in-memory) · owner token (timing-safe) · async error funnel        │
        │                                                                                                     │
        │  buildDashboardData(ownerView)  ──► merges 3 sources via mergePostsByPostId / dedupMedia            │
        │                                                                                                     │
        │  ManualIntake            EntriesStore              MetadataStore        media.ts        analyze.ts  │
        │  (seed, read-only)       (owner SoT, writable)     (media+notes)        (ffmpeg/ffprobe) (vision)   │
        └───────┬──────────────────────┬─────────────────────────┬──────────────────┬───────────────────────┘
                │                       │                         │                  │
   data/manual-intake.json   STORAGE_DIR/entries.json   STORAGE_DIR/metadata.json   STORAGE_DIR/{videos,thumbnails,screenshots,tmp}
        (in git, seed)        (owner reels, source        (media bindings +          (binary assets, outside git)
                               of truth, not in git)       free-text notes)
```

Process model: one Node process, `systemd` unit `ai-dash` (User `www-data`, `ProtectSystem=strict`, `ReadWritePaths=/var/lib/ai-dash`), nginx proxies only `/ai-dash/` → `127.0.0.1:4310`. Storage root in prod = `/var/lib/ai-dash`. App lives in `/opt/ai-dash` (DEPLOY.md) — note the README references `/var/lib/ai-dash` and DEPLOY.md `/opt/ai-dash`; the systemd `WorkingDirectory=/opt/ai-dash` is authoritative.

## 2. Data flow (input → dashboard)

**Owner write path**
1. Owner enters token once (`/api/auth/check`) → stored in `localStorage`.
2. `EntryForm` POSTs `/api/entries` (typed scalars only — never file paths). `entries.ts:normalizeInput` validates + clamps every field; deterministic `postId` (`TT_<date>_<modelslug>` / `IG_…`) unless explicit; duplicate guard on model+platform+date+identifier.
3. Video → `POST /api/entries/:id/video` → multer tmp → `finalizeUpload` (signature sniff, ffprobe, ffmpeg thumb) → `entries.attachVideo`.
4. Screenshots → `POST /api/entries/:id/screenshots` → `finalizeScreenshot` per file.
5. Optional `POST /api/entries/:id/analyze` → vision model returns a **draft** (content + auto‑read metrics); never auto‑saved — owner reviews and re‑submits as an edit.

**Read path (everyone)**
- `GET /api/data` → `buildDashboardData(ownerView)`:
  - `posts` = `mergePostsByPostId(manual.getPosts(), entries.toPosts())` — owner entries override seed by `postId`.
  - `audience` = seed audience rows only.
  - `media` = `dedupMedia([entries, metadata, manual])`.
  - `screenshots` + `notes` only when `ownerView` (valid token), else `[]` / `{}`.
- Each store projects raw fields → `PostRecord` through the single `derivePost()` so rates are identical regardless of source.
- Frontend `lib.ts` computes everything else (filters, summaries, tiers, audience weighting, insights) client‑side.

## 3. Source of truth per data type

| Data | Source of truth | Mutable | In git | Notes |
|---|---|---|---|---|
| Seed LIVE posts | `data/manual-intake.json` | no (deploy) | yes | 4 posts locally; baseline corpus |
| Owner reels + metrics | `STORAGE_DIR/entries.json` | yes (owner UI) | **no** | the real production dataset |
| `extraMetrics` (traffic/demографics) | inside each entry | yes | no | flat `Record<string,number>`, whole‑percent |
| Audience rows (seed) | `manual-intake.json#audience` | no | yes | 68 rows, dims: Viewer type / Follower status / Gender / Age / Country |
| Media bindings + notes | `STORAGE_DIR/metadata.json` | yes | no | `/api/media` + `/api/notes` |
| Binary media | `STORAGE_DIR/{videos,thumbnails,screenshots}` | yes | no | UUID filenames for entries; deterministic slugs for seed |
| Owner token | `ADMIN_TOKEN` env | — | no | `/etc/ai-dash.env` chmod 600 |

There is **no database**. JSON files are read fully into memory on boot and rewritten atomically on every mutation (`writeJsonFileAtomic`: `.bak` copy → pid‑unique tmp → rename; corrupt reads preserved as `*.corrupt-<ts>`).

## 4. Storage schema (de facto)

- `EntriesFile { schemaVersion:1, entries: Entry[] }`. `Entry` carries identity, content (hook/track/contentAnalysis/tags), `metrics: EntryMetrics` (13 nullable raw numbers), `extraMetrics: Record<string,number>`, `video: MediaItem|null`, `screenshots: EntryScreenshot[]`, timestamps. Forward‑only `migrateEntry` coerces legacy rows.
- `MetadataFile { media: MediaItem[], notes: Record<postId, ManualNotes> }`.
- Seed metric keys actually present: `views, likes, comments, shares, saves, newFollowers, totalPlayTimeSec, averageWatchTimeSec, watchedFullVideoRate, totalViewers, totalViewersDeltaVsOneDayAgo, reach, follows, profileVisits, reposts, skipRate, native*Rate`. `manualIntake.ts` maps `watchedFullVideoRate→completionRate`, `newFollowers→follows` fallback.
- `extraMetrics` convention (consumed by `lib.ts`): `traffic_{foryou,search,personalprofile,other}_pct`, `gender_{male,female,other}_pct`, `age_*_pct`, `geo_<cc>_pct`, `new_viewers_pct`, `returning_viewers_pct`, `followers_pct`, `nonfollowers_pct` — all whole‑percent `0..100`.

## 5. API endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | none | uptime, store status, `aiAnalyze` flag |
| POST | `/api/auth/check` | owner | validate token (no data) |
| GET | `/api/data` | optional | merged dashboard (owner view adds notes+screenshots) |
| GET | `/api/entries` | owner | raw entries for edit pre‑fill |
| POST/PATCH/DELETE | `/api/entries[/:id]` | owner | CRUD reels |
| POST | `/api/entries/:id/video` | owner | upload video |
| POST | `/api/entries/:id/thumbnail` | owner | force thumb regen |
| POST/DELETE | `/api/entries/:id/screenshots[/:sid]` | owner | stat screenshots |
| POST | `/api/entries/:id/analyze` | owner | vision draft |
| GET/POST/DELETE | `/api/media[/:id]` | mixed | media list / bind / delete |
| PATCH | `/api/notes/:postId` | owner | manual notes |
| GET | `/media/:id/video` | none | Range video stream |
| GET | `/media/:id/thumbnail` | none | self‑healing thumb |
| GET | `/screenshots/:id` | **none** | raw stat screenshot (see §10) |

## 6. Security model (today)

- **AuthZ = a single shared secret.** `ADMIN_TOKEN` gates every mutation; compared with `crypto.timingSafeEqual` over SHA‑256 hashes (constant‑length, safe). Token rides a custom header → CSRF‑immune (a cross‑site form can't set it). Client persists it in `localStorage`.
- helmet CSP locks `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`; CORP/Referrer same‑origin.
- Per‑IP sliding‑window rate limit (120/5 min) — **in‑memory, single‑process**; relies on `trust proxy 1` + nginx `X-Forwarded-For`.
- Upload safety: MIME allow‑list + magic‑byte signature sniff (`looksLikeVideo/Image`), size + count caps, bounded concurrent ffmpeg/ffprobe (max 2), `windowsHide`, **no shell interpolation** (spawn with arg array). Path containment asserted on every stored‑path resolution.
- Secrets never in git (`.gitignore` + the owner's `block-secrets` hook). `.env.example` is read‑blocked locally by that hook.

## 7. How the core metrics are computed (`server/derive.ts` + `src/lib.ts`)

- `totalEngagements = Σ(likes,comments,reposts,shares,saves)` over **known** values (all‑null → null).
- Reaction/engagement rates over `rateBase = reach ?? views` (matches IG's reporting; consistent per‑person base). `engagementRateByViews` kept separately as the normalized cross‑platform comparator.
- `retentionRate = clamp01(averageWatchTime / duration)` = VTR. `holdRate = 1 − skipRate` (IG). `completionRate` = TikTok watched‑full. **Hold and completion are deliberately not merged.**
- Aggregates use `ratioOver()` — numerator and denominator summed over the **same** posts where both are present (a `views=null` post can't inflate a rate; a `metric=null` post can't deflate it).
- Benchmark tiers: volume/denominator‑free metrics use global thresholds; `likeRate, engagementRateByReach, followConversion, shareSaveRate` use **per‑platform** thresholds (TikTok ≈ 2× IG) derived from the live 27‑reel corpus p25/median/p75.
- Audience weighting (`buildAudience`): `segment_abs = fraction × (reach ?? views)`, summed across LIVE reels, shown as share of dimension total — honest aggregation by absolutes, with a `weak` flag for n≤1.
- Insights (`createInsights`): only groups with `n≥3` (or paired creatives), each carries `sampleSize`, source metric, a concrete recommendation, and reel links; ranked by `|effect| × min(n,6)/6`. `EXAMPLE` excluded throughout.

## 8. What can be kept verbatim

- `server/derive.ts` — the canonical metric projection. Becomes the "derived" source in the snapshot model.
- `src/lib.ts` — all analytics (tiers, weighted audience, hook archetypes, anomaly classifier, funnel, scoreboard, insights). The SaaS must feed it the same `PostRecord[]` shape.
- `server/jsonFile.ts` — atomic/corruption‑safe write helpers (reuse for any JSON sidecar).
- `server/media.ts` — upload validation, ffmpeg/ffprobe pipeline, Range streaming, signature sniffing. Directly reusable for screenshots; extend with HEIC + EXIF‑rotation.
- Creative ID grouping, EXAMPLE exclusion, `null≠0` discipline, deterministic `postId`.

## 9. What must evolve

| Area | Today | Needs |
|---|---|---|
| Identity | single env token | users + sessions + workspaces + roles |
| Storage | in‑memory JSON | Postgres + migrations + typed access |
| Tenancy | none | `workspace_id` on every private row + enforced authZ |
| Metric values | single latest scalar | append‑only **snapshots** with source/observed‑time/confidence |
| Ingestion | manual only | OAuth connectors + background sync + screenshot completion |
| Rate limit | in‑memory | shared store (PG/Redis) once multi‑process |
| Media | local disk, predictable paths | tenant‑scoped, signed short‑lived URLs, S3‑ready |
| Screenshots route | unauthenticated by id | tenant authZ + signed URL |
| Config | flat `config.ts` | per‑workspace connector creds (encrypted at rest) |

## 10. What blocks multi‑tenant SaaS (ranked)

1. **No tenant boundary.** Every store is global; one token sees everything. Nothing is `workspace`‑scoped. *(blocker)*
2. **No real authentication.** A shared secret can't represent N users/roles/sessions. *(blocker)*
3. **`GET /ai-dash/screenshots/:id` is unauthenticated.** Entry screenshot ids are UUIDs (unguessable) and only surfaced to the owner today, so it's not currently exploitable — but in multi‑tenant it leaks across tenants and must be gated + signed. *(blocker for SaaS)*
4. **JSON file stores** can't do concurrent writers, row‑level locking, or per‑tenant queries; whole‑file rewrite per mutation won't scale past one owner. *(blocker at scale)*
5. **No metric history/provenance** — can't reconcile API vs screenshot vs manual, can't show velocity. *(feature blocker)*
6. **In‑memory rate limit + in‑memory stores** assume exactly one process. *(blocker for horizontal scale)*
7. **No OAuth/token storage/refresh/connector layer.** *(feature blocker)*

## 11. Critical debts (address now)

- Multi‑tenant identity + tenancy column + PG persistence (foundation everything else needs).
- Snapshot/provenance model (so API + screenshot + manual coexist without one clobbering the other).
- Gate + sign the screenshot route.
- Connector abstraction so UI/analytics never import platform payloads.

## 12. Deferrable debts

- Redis (PG‑based queue + advisory locks suffice at one‑VPS scale).
- S3 (keep local disk behind a storage interface; migrate later).
- Full billing (model entitlements now, integrate a provider later).
- Horizontal scaling / multiple workers (single process is fine for the first tenants).

## 13. Production‑migration risks

- **Owner data only exists on the VPS** (`entries.json` + binaries). Any migration must run there, against a **backup**, with a **dry‑run** + object‑count/aggregate parity check, and never delete the JSON.
- Deploy is `git pull` + `npm run build` by the owner (Claude has no SSH). A schema change that needs Postgres means a new install step + a worker unit — must be additive and reversible.
- The dashboard's per‑platform benchmark thresholds are hard‑calibrated to the current corpus; re‑deriving them post‑migration must reproduce the same `PostRecord` inputs or tiers shift silently.
- nginx currently proxies only `/ai-dash/`; adding OAuth callbacks/webhooks needs new locations without touching other `inshinlab.com` subprojects.
- `MAX_UPLOAD_MB=500` + `client_max_body_size 500m` — screenshot batch endpoints must keep their own (smaller) caps.

## 14. Recommended change order

1. **Snapshot + provenance model and canonical metric registry** (additive; `derive.ts` becomes the "derived" source). *(done in slice)*
2. **Connector abstraction + mock IG/TikTok connectors + contract tests** (no creds needed). *(done in slice)*
3. **Dynamic requirement engine + screenshot‑completion subsystem + extraction** (the highest‑value piece that works with zero external APIs). *(done in slice)*
4. **Postgres data foundation + dry‑run importer** for `entries.json` → workspace‑scoped rows (designed; ADR‑002 + migration plan). Run on VPS against a backup only.
5. **Users/sessions/workspaces** replacing the single token (token kept as emergency/admin fallback).
6. **Live OAuth connectors** (IG Login, TikTok Login Kit) once the owner creates the platform apps — code + fixtures ready, flip to live behind a flag.
7. **Hardening**: gate screenshot route, shared rate‑limit, observability, entitlement checks on the backend.

See `social-api-feasibility.md` (coverage matrix), `platform-app-setup.md`, `adr/001-social-data-strategy.md`, `adr/002-saas-architecture.md`, `data-migration-plan.md`, `manual-analytics-completion.md`, `deployment-runbook.md`.
