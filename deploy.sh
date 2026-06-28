#!/usr/bin/env bash
# One-shot production deploy for AI Dash. Run as root on the VPS:
#   bash /opt/ai-dash/deploy.sh
# (The repo is PRIVATE, so the raw.githubusercontent.com one-liner 404s — run the local
# copy. This script self-updates the checkout via git fetch + reset to origin/main.)
# Code lives in /opt/ai-dash; data and uploads live separately in /var/lib/ai-dash
# (never touched here). Idempotent: works whether /opt/ai-dash is a git checkout or not.
set -euo pipefail

APP=/opt/ai-dash
# SSH so a private-repo fetch/clone uses the read-only deploy key (no token in the URL).
REPO=git@github.com:inshinav/ai-dash.git

echo "==> 1/5 backup data (/var/lib/ai-dash)"
mkdir -p /var/backups
if [ -d /var/lib/ai-dash ]; then
  tar czf "/var/backups/ai-dash-$(date +%F-%H%M).tgz" -C /var/lib ai-dash
  echo "    backed up to /var/backups/"
fi

echo "==> 2/5 sync code to origin/main"
git config --global --add safe.directory "$APP" 2>/dev/null || true
if [ -d "$APP/.git" ]; then
  cd "$APP"
  git fetch origin
  git reset --hard origin/main
else
  ts=$(date +%s)
  [ -d "$APP" ] && mv "$APP" "${APP}-old-${ts}" && echo "    moved old code to ${APP}-old-${ts}"
  git clone "$REPO" "$APP"
  cd "$APP"
fi
echo "    now at $(git rev-parse --short HEAD)"

echo "==> 3/5 build"
npm ci
npm run build
npm prune --omit=dev
chown -R www-data:www-data "$APP"

echo "==> 4/5 restart service"
systemctl restart ai-dash
sleep 2

echo "==> 5/5 verify"
curl -fsS http://127.0.0.1:4310/ai-dash/api/health
echo
echo "Done. If the response contains \"stores\", the new version is live."
