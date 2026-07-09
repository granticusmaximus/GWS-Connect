#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LOCAL_DB="${LOCAL_DB:-$ROOT_DIR/server/data/gws-connect.db}"
SSH_PORT="${SSH_PORT:-22}"
REMOTE_TMP_DIR="${REMOTE_TMP_DIR:-/tmp}"
PROD_HOST="${PROD_HOST:-}"
PROD_USER="${PROD_USER:-}"
PROD_DB_PATH="${PROD_DB_PATH:-}"
PROD_RESTART_CMD="${PROD_RESTART_CMD:-}"
PROD_DB_OWNER="${PROD_DB_OWNER:-}"
PROD_DB_MODE="${PROD_DB_MODE:-}"
CONFIRM="${CONFIRM:-}"

usage() {
  cat <<'EOF'
Usage:
  PROD_HOST=example.com \
  PROD_USER=deploy \
  PROD_DB_PATH=/var/lib/gws-connect/gws-connect.db \
  CONFIRM=YES \
  npm run db:promote:prod

  # Preferred alias when thinking "copy dev to prod":
  npm run db:sync:dev-to-prod

Required environment variables:
  PROD_HOST         Remote host (e.g. connect.gwsapp.net or server IP)
  PROD_USER         SSH user
  PROD_DB_PATH      Absolute path to production SQLite DB file
  CONFIRM           Must be exactly YES

Optional environment variables:
  LOCAL_DB          Local DB file path (default: server/data/gws-connect.db)
  SSH_PORT          SSH port (default: 22)
  REMOTE_TMP_DIR    Remote temp directory (default: /tmp)
  PROD_RESTART_CMD  Remote restart command (e.g. 'systemctl restart gws-connect')
  PROD_DB_OWNER     Remote owner to apply (e.g. 'gws:gws')
  PROD_DB_MODE      Remote chmod mode (e.g. 640)

This script will:
  1) Backup local DB
  2) Upload local DB to remote temp path
  3) Backup remote DB
  4) Replace remote DB atomically
  5) Optionally apply owner/mode and restart service
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if [[ -z "$PROD_HOST" || -z "$PROD_USER" || -z "$PROD_DB_PATH" ]]; then
  echo "Missing required variables."
  usage
  exit 1
fi

if [[ "$CONFIRM" != "YES" ]]; then
  echo "Refusing to continue without CONFIRM=YES"
  exit 1
fi

if [[ ! -f "$LOCAL_DB" ]]; then
  echo "Local DB not found: $LOCAL_DB"
  exit 1
fi

echo "Creating local backup first..."
bash "$ROOT_DIR/scripts/db/backup-local.sh" "$LOCAL_DB"

REMOTE_TMP_DB="$REMOTE_TMP_DIR/gws-connect.promote.$(date +%Y%m%d-%H%M%S).db"

echo "Uploading local DB to remote temp location..."
scp -P "$SSH_PORT" "$LOCAL_DB" "$PROD_USER@$PROD_HOST:$REMOTE_TMP_DB"

echo "Replacing remote DB with backup + atomic move..."
ssh -p "$SSH_PORT" "$PROD_USER@$PROD_HOST" \
"set -euo pipefail
if [[ ! -f '$PROD_DB_PATH' ]]; then
  echo 'Remote DB not found at $PROD_DB_PATH'
  exit 1
fi

REMOTE_BACKUP=\"$PROD_DB_PATH.backup.$(date +%Y%m%d-%H%M%S)\"
cp '$PROD_DB_PATH' \"$REMOTE_BACKUP\"
mv '$REMOTE_TMP_DB' '$PROD_DB_PATH'

if [[ -n '$PROD_DB_OWNER' ]]; then
  chown '$PROD_DB_OWNER' '$PROD_DB_PATH'
fi

if [[ -n '$PROD_DB_MODE' ]]; then
  chmod '$PROD_DB_MODE' '$PROD_DB_PATH'
fi

if [[ -n '$PROD_RESTART_CMD' ]]; then
  eval '$PROD_RESTART_CMD'
fi

echo \"Remote backup created: $REMOTE_BACKUP\"
"

echo "Promotion complete."
echo "Run post-checks on production, for example:"
echo "  sqlite3 '$PROD_DB_PATH' \"select 'users', count(*) from users union all select 'channels', count(*) from channels union all select 'messages', count(*) from messages;\""
