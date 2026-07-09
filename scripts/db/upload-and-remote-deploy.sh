#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LOCAL_DB="${LOCAL_DB:-$ROOT_DIR/server/data/gws-connect.db}"
REMOTE_DEPLOY_SCRIPT_SOURCE="${REMOTE_DEPLOY_SCRIPT_SOURCE:-$ROOT_DIR/scripts/db/remote-only-deploy.sh}"
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
  PROD_RESTART_CMD='systemctl restart gws-connect' \
  CONFIRM=YES \
  npm run db:upload-and-remote-deploy

Required environment variables:
  PROD_HOST         Remote host to upload to
  PROD_USER         SSH user
  PROD_DB_PATH      Absolute path to the live production SQLite DB file
  CONFIRM           Must be exactly YES

Optional environment variables:
  LOCAL_DB                   Local DB file path (default: server/data/gws-connect.db)
  REMOTE_DEPLOY_SCRIPT_SOURCE Local path to the remote deploy script (default: scripts/db/remote-only-deploy.sh)
  SSH_PORT                   SSH port (default: 22)
  REMOTE_TMP_DIR             Remote temp directory (default: /tmp)
  PROD_RESTART_CMD           Remote restart command to run after the swap
  PROD_DB_OWNER              Owner/group to apply to the live DB (e.g. 'gws:gws')
  PROD_DB_MODE               chmod mode for the live DB (e.g. 640)

This script will:
  1) Backup the local DB
  2) Upload the local DB to the remote host
  3) Upload the remote-only deploy script to the remote host
  4) SSH in and run the remote deploy script so the DB is swapped before restart
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

if [[ ! -f "$REMOTE_DEPLOY_SCRIPT_SOURCE" ]]; then
  echo "Remote deploy script source not found: $REMOTE_DEPLOY_SCRIPT_SOURCE"
  exit 1
fi

echo "Creating local backup first..."
bash "$ROOT_DIR/scripts/db/backup-local.sh" "$LOCAL_DB"

STAMP="$(date +%Y%m%d-%H%M%S)"
REMOTE_DB_STAGE_PATH="$REMOTE_TMP_DIR/gws-connect.dev-$STAMP.db"
REMOTE_DEPLOY_SCRIPT_PATH="$REMOTE_TMP_DIR/gws-connect.remote-only-deploy-$STAMP.sh"

echo "Uploading local DB to remote host..."
scp -P "$SSH_PORT" "$LOCAL_DB" "$PROD_USER@$PROD_HOST:$REMOTE_DB_STAGE_PATH"

echo "Uploading remote deploy script to remote host..."
scp -P "$SSH_PORT" "$REMOTE_DEPLOY_SCRIPT_SOURCE" "$PROD_USER@$PROD_HOST:$REMOTE_DEPLOY_SCRIPT_PATH"

echo "Running remote deploy step..."
ssh -p "$SSH_PORT" "$PROD_USER@$PROD_HOST" \
"chmod +x '$REMOTE_DEPLOY_SCRIPT_PATH' && \
PROD_DB_PATH='$PROD_DB_PATH' \
STAGED_DB_PATH='$REMOTE_DB_STAGE_PATH' \
PROD_RESTART_CMD='$PROD_RESTART_CMD' \
PROD_DB_OWNER='$PROD_DB_OWNER' \
PROD_DB_MODE='$PROD_DB_MODE' \
CONFIRM=YES \
bash '$REMOTE_DEPLOY_SCRIPT_PATH' && \
rm -f '$REMOTE_DEPLOY_SCRIPT_PATH'"

echo "Upload + remote deploy complete."
