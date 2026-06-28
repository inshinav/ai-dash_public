# Deployment runbook

> Extends the existing [`../DEPLOY.md`](../DEPLOY.md). The owner runs everything on the VPS
> (Claude has no SSH). **No destructive production operation without a backup + a dry‑run +
> green checks + a rollback path.** Do not touch other `inshinlab.com` subprojects.

## What ships in the current slice (no new infra required)

The screenshot‑completion subsystem is **additive** and runs on the existing JSON stores:

- New owner‑gated endpoints under `/ai-dash/api/completion/*`.
- New JSON sidecar `STORAGE_DIR/saas-snapshots.json` (created on first run; atomic writes).
- New static mobile wizard at `/ai-dash/complete` (served from `server/public/`).
- `entries.json`, `metadata.json`, media — **untouched**.

Deploying it = the normal flow (no DB, no worker, no nginx change):

```bash
curl -fsSL https://raw.githubusercontent.com/inshinav/ai-dash/main/deploy.sh | bash
# or the manual steps in DEPLOY.md §2; then:
curl -fsS http://127.0.0.1:4310/ai-dash/api/health    # expect stores.snapshots + features.completion:true
curl -sSI https://inshinlab.com/ai-dash/complete | head -n1   # expect 200
```

Optional: set `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY`) in `/etc/ai-dash.env` to enable
screenshot auto‑extraction. Without it the wizard still works (manual confirm).

Rollback for this slice = `git reset --hard "$PREV"` + rebuild + restart (DEPLOY.md §"Откат").
The sidecar JSON is forward‑only and harmless if the code is rolled back.

## Future: the full SaaS deploy (Milestones 2–7)

### Environment variables (added incrementally)

```
# existing
ADMIN_TOKEN=…            # owner/admin fallback (kept)
STORAGE_DIR=/var/lib/ai-dash

# Milestone 2+: database
DATABASE_URL=postgres://ai_dash:…@127.0.0.1:5432/ai_dash
DATA_BACKEND=json        # flip to 'postgres' only after migration parity

# Milestone 4: connectors (see platform-app-setup.md)
IG_APP_ID= …  IG_APP_SECRET= …  IG_REDIRECT_URI= …
TIKTOK_CLIENT_KEY= …  TIKTOK_CLIENT_SECRET= …  TIKTOK_REDIRECT_URI= …
CONNECTOR_TOKEN_ENC_KEY= …   # 32+ bytes, AES-GCM for tokens at rest

# extraction
OPENAI_API_KEY= …   # or ANTHROPIC_API_KEY
```

### Database setup

```bash
apt-get install -y postgresql
sudo -u postgres createuser ai_dash --pwprompt
sudo -u postgres createdb ai_dash -O ai_dash
# in /etc/ai-dash.env: DATABASE_URL=postgres://ai_dash:…@127.0.0.1:5432/ai_dash
npm run db:migrate          # forward-only migrations, checked into git
```

### Background worker (pg‑boss, same process or a sibling unit)

Start as a second systemd unit so sync/token‑refresh keep running independently:

```ini
# /etc/systemd/system/ai-dash-worker.service  (mirror of ai-dash.service)
ExecStart=/usr/bin/node /opt/ai-dash/dist-server/worker.js
```
```bash
cp /opt/ai-dash/deploy/ai-dash-worker.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now ai-dash-worker
```

### Object storage

Stays local disk behind the `MediaStorage` interface initially. To move to S3 later: set
`MEDIA_BACKEND=s3` + S3 creds, run the media‑copy job, verify, flip. No code change to call
sites (interface‑isolated).

### nginx

No change for OAuth callbacks (under the existing `/ai-dash/` proxy). Only add a `location`
for platform **webhooks** if/when enabled. Keep `client_max_body_size 500m`. Never remove
`/var/www/html` or other apps' locations.

## Pre‑deploy checklist (full SaaS)

- [ ] `npm run check` green (lint + tests + build).
- [ ] DB backup (`pg_dump`) + data backup (`tar`).
- [ ] `node dist-server/migrate/import.js --dry-run` reviewed.
- [ ] `PREV=$(git rev-parse HEAD)` recorded.

## Deploy

```bash
cd /opt/ai-dash
tar czf /var/backups/ai-dash-$(date +%F-%H%M).tgz -C /var/lib ai-dash
PREV=$(git rev-parse HEAD)
git pull --ff-only origin main
npm ci && npm run build && npm prune --omit=dev
npm run db:migrate
systemctl restart ai-dash ai-dash-worker
```

## Post‑deploy verification

```bash
curl -fsS http://127.0.0.1:4310/ai-dash/api/health         # ok:true, stores incl. snapshots
curl -sSI https://inshinlab.com/ai-dash/ | head -n1          # 200
curl -sSI https://inshinlab.com/ai-dash/complete | head -n1  # 200
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://inshinlab.com/ai-dash/api/completion/tasks  # 401 (owner-gated)
# spot-check a reel's metrics + Creative ID + provenance in the dashboard
```

## Rollback

```bash
cd /opt/ai-dash
git reset --hard "$PREV"
npm ci && npm run build && npm prune --omit=dev
# if a migration was applied and is incompatible: restore DB
psql "$DATABASE_URL" < /var/backups/ai-dash-db-<stamp>.sql
systemctl restart ai-dash ai-dash-worker
# data in /var/lib/ai-dash is untouched; DATA_BACKEND=json reads JSON directly
```

## Observability to watch

`/api/health` (stores + features), sync‑run logs (status/imported/updated/errors/retries +
correlation id), OAuth errors, extraction errors, upload errors, platform rate‑limit events,
reconnect‑required alerts. Never log tokens or raw payloads without redaction.
