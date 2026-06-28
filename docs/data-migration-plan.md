# Data migration plan — JSON stores → Postgres (workspace‑scoped)

> The owner's only real dataset is `STORAGE_DIR/entries.json` + the media/screenshots on the
> VPS (the local checkout has just the 4‑post seed). This plan moves it into the multi‑tenant
> Postgres schema **safely, idempotently, reversibly**, and never deletes the JSON.

## Principles

- **Backup first, delete never.** The JSON stores remain the source of truth until parity is proven; they are not removed even after cutover.
- **Dry‑run before write.** The importer runs read‑only first and prints a diff/report.
- **Idempotent.** Re‑running imports the same data without creating duplicates (upsert on natural keys).
- **Runs on the VPS** (Claude has no SSH). The owner runs the commands.

## Target tables (subset relevant to migration)

`workspaces`, `workspace_members`, `users`, `social_accounts`, `models`, `content_items`,
`creative_groups`, `metric_snapshots`, `media_assets`, `analytics_screenshots`,
`manual_overrides` (notes), `raw_api_payloads`. Full list in
[`adr/002-saas-architecture.md`](adr/002-saas-architecture.md).

## Field mapping (entries.json → tables)

| Source (`Entry` / merged `PostRecord`) | Target |
|---|---|
| owner identity | one `users` row + one `workspaces` row (`slug: owner`) + `workspace_members(owner, role=owner)` |
| `entry.account` / platform | `social_accounts` (one per distinct account+platform, `connection=null` → "manual") |
| `entry.postId` | `content_items.platform_id` (`workspace_id`, `platform`, unique) |
| `entry.creativeId` | `creative_groups` (+ `content_items.creative_group_id`) — **Creative ID preserved** |
| `entry.model` | `models` (+ link) |
| `entry.metrics.*` (non‑null) | `metric_snapshots` rows, `source='manual'`, `confirmed=true`, `observed_at=entry.updatedAt`, canonical key via the registry map |
| `entry.extraMetrics.*` | `metric_snapshots` distribution rows (segment from the key), `source='manual'` |
| `entry.video` / `metadata.media` | `media_assets` (+ files copied/linked into tenant‑scoped storage) |
| `entry.screenshots` | `analytics_screenshots` |
| `metadata.notes[postId]` | `manual_overrides` / notes |
| `entry.contentAnalysis`, `tags`, `track`, `hookType`, … | `content_items` columns |
| `recordType` | `content_items.record_type` (`EXAMPLE` still excluded from analytics) |
| timestamps | preserved as `created_at` / `updated_at` / `observed_at` |

`null` stays `null` (never written as `0`). The same registry map used at runtime
(`server/saas/snapshots.ts#CANON_TO_ENTRY`, inverted) drives the metric mapping, so the
importer and the live fold‑back agree by construction.

## Importer requirements

- Modes: `--dry-run` (default), `--apply`, `--verify`.
- Input: `STORAGE_DIR/entries.json`, `STORAGE_DIR/metadata.json`, `data/manual-intake.json`.
- Output: `migration-report.json` with counts in vs out per table, and a parity section.
- Idempotent upsert on `(workspace_id, platform, platform_id)` for content and on a natural
  hash for snapshots; re‑run adds nothing.
- Media: copy (not move) binaries into the tenant storage path; record both paths.

## Procedure (owner runs on the VPS)

```bash
cd /opt/ai-dash
# 1. backup data + DB
tar czf /var/backups/ai-dash-pre-migrate-$(date +%F-%H%M).tgz -C /var/lib ai-dash
pg_dump "$DATABASE_URL" > /var/backups/ai-dash-db-$(date +%F-%H%M).sql   # if DB already has data

# 2. apply schema migrations
npm run db:migrate

# 3. DRY RUN — no writes, prints the report
node dist-server/migrate/import.js --dry-run

# 4. review migration-report.json (counts + parity look right?)

# 5. APPLY
node dist-server/migrate/import.js --apply

# 6. VERIFY parity (aggregates match the live dashboard)
node dist-server/migrate/import.js --verify
```

## Parity checks (must match before cutover)

- LIVE content count = `entries.json` LIVE entries + seed posts (deduped by postId).
- Distinct Creative IDs preserved (count + membership).
- Per‑platform totals: Σ views, Σ follows, median views — equal to the current dashboard's
  `summarize()` / `platformScoreboard()` outputs (computed from the same merged posts).
- Audience weighted shares match `buildAudience()` for the same inputs.
- Screenshot + media counts equal.
- Spot‑check 3 reels end‑to‑end (metrics, Creative ID, provenance badge).

## Cutover & rollback

- Cutover is **flag‑gated** (`DATA_BACKEND=postgres`); until flipped, the app reads JSON.
- Keep JSON + media + DB backups. Rollback = set `DATA_BACKEND=json`, restart — instant, no data loss.
- Only after a sustained green period (parity + manual spot‑checks) consider the JSON the
  cold backup; **still do not delete it.**

## Status

- Field map + procedure: **specified here.**
- The runtime snapshot store (`server/saas/store.ts`) already uses the exact `MetricSnapshot`
  row shape the importer targets, so the importer is mechanical to write.
- `dist-server/migrate/import.js`: **to be implemented in Milestone 2** (not yet built — the
  current slice runs additively on the JSON stores; no production data has been touched).
