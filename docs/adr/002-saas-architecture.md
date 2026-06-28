# ADR‑002 — SaaS architecture

- **Status:** Accepted (target architecture) · 2026‑06‑27
- **Evidence:** [`../current-architecture-audit.md`](../current-architecture-audit.md)

## Context

Evolve a single‑process, JSON‑file, single‑owner Express+React app into a multi‑tenant
SaaS **for one maintainer to run on the existing VPS**, without microservice sprawl and
without breaking the working dashboard, Creative ID, or analytics.

## Decision — a modular monolith

Keep one deployable Node/Express process and the existing React SPA; add modules, not
services.

| Concern | Choice | Why |
|---|---|---|
| Runtime | keep **Express 5 + React 19 + Vite + TypeScript** | working, owner knows it, no rewrite |
| Database | **PostgreSQL** | row‑level tenancy, history/snapshots, concurrent writers — the JSON stores can't do these |
| Schema access | **typed query builder (Kysely)** + plain SQL migrations | type‑safe, no heavy ORM, transparent SQL; Drizzle is an acceptable alternative |
| Migrations | **node‑pg‑migrate** (or Kysely migrations) | forward‑only, checked into git, run on deploy |
| Background jobs | **PostgreSQL‑backed queue** (`pg-boss`) | no Redis to operate; gives retries, scheduling, idempotency, visibility at one‑VPS scale |
| Object storage | **local disk behind a `MediaStorage` interface** now; **S3‑compatible** later | avoid premature migration risk; interface keeps S3 a config swap |
| Auth | **server‑side sessions**, HTTP‑only `SameSite=Lax` cookie, CSRF token, session rotation | replaces the single shared token; the token survives as emergency/admin fallback |
| Connectors | **adapter modules** behind `SocialConnector` | UI/analytics never import a platform payload |
| Analytics | **unchanged `derive.ts` + `lib.ts`** fed from snapshots | preserve all current product value |
| Entitlements | **`workspace_entitlements` checked on the backend** | tariffs enforced server‑side, not by hiding UI |

### Why not microservices / Redis / mandatory S3

One maintainer, one VPS, modest load. Microservices add deploy/observability overhead with
no benefit yet. A PG‑backed queue removes a whole moving part (Redis). Local disk already
works and is backed up; an S3 swap is a config change behind the storage interface when
scale demands it. The architecture **enables** all three later without requiring them now.

## Module layout (target)

```
server/
  auth/         sessions, CSRF, workspace membership, owner-token fallback
  tenancy/      workspace context + per-request authZ guard
  db/           pool, migrations, kysely types
  connectors/   SocialConnector adapters (instagram, tiktok, tiktok-business)   ← built (mock)
  sync/         job definitions, scheduler, cursor persistence, rate-limit, dead-letter
  metrics/      canonical registry + snapshots + provenance                      ← built
  completion/   requirement engine + screenshot tasks + extraction               ← built
  media/        MediaStorage interface (local now, S3 later), ffmpeg pipeline     ← reuse existing
  billing/      entitlements (enforced), subscriptions (later)
  public/       standalone mobile completion wizard                              ← built
```

Already implemented additively today (no DB yet): `server/saas/` (metrics, snapshots,
connectors, completion, extraction, store) + the mobile wizard, all behind the existing
owner token and a separate JSON sidecar. These modules are written to be a **drop‑in match**
for the Postgres tables below (same row shape) so the migration is mechanical.

## Data model → see [§13 of the audit] and `data-migration-plan.md`

Core tables: `users, sessions, workspaces, workspace_members, models, social_connections,
social_accounts, content_items, creative_groups, metric_definitions, metric_snapshots,
audience_snapshots, raw_api_payloads, sync_runs, sync_errors, manual_completion_tasks,
analytics_screenshots, screenshot_extractions, manual_overrides, media_assets, audit_logs,
subscriptions, workspace_entitlements`.

Invariants enforced by schema + guards: every private row carries `workspace_id`; every
endpoint checks tenant access; `(workspace_id, platform, platform_id)` unique → idempotent
upsert; `metric_snapshots` is append‑only with `source/observed_at/confidence/confirmed`;
manual values are never destroyed by API sync; `null ≠ 0`; derived metrics recompute
deterministically; platform‑specific metrics are never collapsed.

## Rollout

Milestones M2→M7 in the audit §14 and the README. Postgres lands behind a feature flag with
the dry‑run importer (`data-migration-plan.md`) before any cutover; the JSON stores remain
the source of truth until parity is proven.

## Consequences

- One process to deploy, one DB to back up, one queue with no extra infra.
- Clear seams (connector / storage / auth) make each live integration a localized change.
- The biggest risk — moving the owner's only dataset into Postgres — is contained to one
  reversible, dry‑runnable importer that runs on the VPS against a backup.
