#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LOCAL_DATA_DIR="${LOCAL_DATA_DIR:-$ROOT_DIR/server/data}"
LOCAL_UPLOADS_DIR="${LOCAL_UPLOADS_DIR:-$ROOT_DIR/server/uploads}"
REMOTE_DEPLOY_SCRIPT_SOURCE="${REMOTE_DEPLOY_SCRIPT_SOURCE:-$ROOT_DIR/scripts/db/remote-full-sync-deploy.sh}"
SSH_PORT="${SSH_PORT:-22}"
REMOTE_TMP_DIR="${REMOTE_TMP_DIR:-/tmp}"
PROD_HOST="${PROD_HOST:-}"
PROD_USER="${PROD_USER:-}"
PROD_DB_PATH="${PROD_DB_PATH:-}"
PROD_COMPOSE_DIR="${PROD_COMPOSE_DIR:-/opt/apps/GWS-Connect/repo}"
PROD_DB_OWNER="${PROD_DB_OWNER:-}"
PROD_DB_MODE="${PROD_DB_MODE:-}"
CONFIRM="${CONFIRM:-}"

usage() {
  cat <<'EOF'
Usage:
  PROD_HOST=example.com \
  PROD_USER=deploy \
  PROD_DB_PATH=/opt/apps/GWS-Connect/repo/server/data/gws-connect.db \
  CONFIRM=YES \
  npm run db:upload-and-remote-full-sync

Required environment variables:
  PROD_HOST         Remote host to upload to
  PROD_USER         SSH user
  PROD_DB_PATH      Absolute path to the live production SQLite DB file
  CONFIRM           Must be exactly YES

Optional environment variables:
  LOCAL_DATA_DIR             Local server/data directory (default: server/data)
  LOCAL_UPLOADS_DIR          Local server/uploads directory (default: server/uploads)
  REMOTE_DEPLOY_SCRIPT_SOURCE Local path to the remote full-sync deploy script
  SSH_PORT                   SSH port (default: 22)
  REMOTE_TMP_DIR             Remote temp directory (default: /tmp)
  PROD_COMPOSE_DIR           Production compose repo directory (default: /opt/apps/GWS-Connect/repo)
  PROD_DB_OWNER              Owner/group to apply to the live DB (e.g. 'gws:gws')
  PROD_DB_MODE               chmod mode for the live DB (e.g. 640)

This script will:
  1) Backup the local data directory
  2) Upload server/data and server/uploads to the remote host
  3) Upload the remote full-sync deploy script to the remote host
  4) SSH in and run the remote full-sync deploy script so the live data is mirrored before restart
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

if [[ ! -d "$LOCAL_DATA_DIR" ]]; then
  echo "Local data directory not found: $LOCAL_DATA_DIR"
  exit 1
fi

if [[ ! -d "$LOCAL_UPLOADS_DIR" ]]; then
  echo "Local uploads directory not found: $LOCAL_UPLOADS_DIR"
  exit 1
fi

if [[ ! -f "$REMOTE_DEPLOY_SCRIPT_SOURCE" ]]; then
  echo "Remote full-sync deploy script source not found: $REMOTE_DEPLOY_SCRIPT_SOURCE"
  exit 1
fi

echo "Creating local backup first..."
bash "$ROOT_DIR/scripts/db/backup-local.sh" "$LOCAL_DATA_DIR/gws-connect.db"

STAMP="$(date +%Y%m%d-%H%M%S)"
REMOTE_STAGING_ROOT="$REMOTE_TMP_DIR/gws-connect-full-sync-$STAMP"
REMOTE_DATA_STAGE_DIR="$REMOTE_STAGING_ROOT/data"
REMOTE_UPLOADS_STAGE_DIR="$REMOTE_STAGING_ROOT/uploads"
REMOTE_DEPLOY_SCRIPT_PATH="$REMOTE_TMP_DIR/gws-connect.remote-full-sync-$STAMP.sh"

echo "Preparing remote staging directories..."
ssh -p "$SSH_PORT" "$PROD_USER@$PROD_HOST" "mkdir -p '$REMOTE_DATA_STAGE_DIR' '$REMOTE_UPLOADS_STAGE_DIR'"

echo "Uploading local data directory to remote host..."
rsync -a --delete -e "ssh -p $SSH_PORT" "$LOCAL_DATA_DIR/" "$PROD_USER@$PROD_HOST:$REMOTE_DATA_STAGE_DIR/"

echo "Uploading local uploads directory to remote host..."
rsync -a --delete -e "ssh -p $SSH_PORT" "$LOCAL_UPLOADS_DIR/" "$PROD_USER@$PROD_HOST:$REMOTE_UPLOADS_STAGE_DIR/"

echo "Uploading remote deploy script to remote host..."
scp -P "$SSH_PORT" "$REMOTE_DEPLOY_SCRIPT_SOURCE" "$PROD_USER@$PROD_HOST:$REMOTE_DEPLOY_SCRIPT_PATH"

echo "Running remote full-data deploy step..."
ssh -p "$SSH_PORT" "$PROD_USER@$PROD_HOST" \
"chmod +x '$REMOTE_DEPLOY_SCRIPT_PATH' && \
PROD_COMPOSE_DIR='$PROD_COMPOSE_DIR' \
PROD_DB_PATH='$PROD_DB_PATH' \
STAGED_DATA_DIR='$REMOTE_DATA_STAGE_DIR' \
STAGED_UPLOADS_DIR='$REMOTE_UPLOADS_STAGE_DIR' \
PROD_DB_OWNER='$PROD_DB_OWNER' \
PROD_DB_MODE='$PROD_DB_MODE' \
CONFIRM=YES \
bash '$REMOTE_DEPLOY_SCRIPT_PATH' && \
rm -rf '$REMOTE_STAGING_ROOT' '$REMOTE_DEPLOY_SCRIPT_PATH'"

echo "Upload + remote full-data sync complete."
