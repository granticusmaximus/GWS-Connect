#!/usr/bin/env bash
set -euo pipefail

PROD_DB_PATH="${PROD_DB_PATH:-}"
STAGED_DB_PATH="${STAGED_DB_PATH:-}"
PROD_RESTART_CMD="${PROD_RESTART_CMD:-}"
PROD_DB_OWNER="${PROD_DB_OWNER:-}"
PROD_DB_MODE="${PROD_DB_MODE:-}"
CONFIRM="${CONFIRM:-}"

usage() {
  cat <<'EOF'
Usage (run on the production host):
  PROD_DB_PATH=/var/lib/gws-connect/gws-connect.db \
  STAGED_DB_PATH=/tmp/gws-connect.db \
  PROD_RESTART_CMD='systemctl restart gws-connect' \
  CONFIRM=YES \
  bash scripts/db/remote-only-deploy.sh

Required environment variables:
  PROD_DB_PATH      Absolute path to the live production SQLite DB file
  STAGED_DB_PATH    Absolute path to the newly synced DB file already present on the host
  CONFIRM           Must be exactly YES

Optional environment variables:
  PROD_RESTART_CMD  Remote restart command to run after the swap
  PROD_DB_OWNER     Owner/group to apply to the live DB (e.g. 'gws:gws')
  PROD_DB_MODE      chmod mode for the live DB (e.g. 640)

This script will:
  1) Backup the live production DB
  2) Replace it with the staged DB atomically
  3) Apply owner/mode if requested
  4) Restart the service only after the DB is in place
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if [[ -z "$PROD_DB_PATH" || -z "$STAGED_DB_PATH" ]]; then
  echo "Missing required variables."
  usage
  exit 1
fi

if [[ "$CONFIRM" != "YES" ]]; then
  echo "Refusing to continue without CONFIRM=YES"
  exit 1
fi

if [[ ! -f "$STAGED_DB_PATH" ]]; then
  echo "Staged DB not found: $STAGED_DB_PATH"
  exit 1
fi

if [[ ! -f "$PROD_DB_PATH" ]]; then
  echo "Live production DB not found: $PROD_DB_PATH"
  exit 1
fi

if [[ "$(realpath "$STAGED_DB_PATH")" == "$(realpath "$PROD_DB_PATH")" ]]; then
  echo "Staged DB and production DB paths must be different"
  exit 1
fi

echo "Backing up current production DB..."
BACKUP_PATH="${PROD_DB_PATH}.backup.$(date +%Y%m%d-%H%M%S)"
cp "$PROD_DB_PATH" "$BACKUP_PATH"

echo "Swapping in staged DB..."
mv "$STAGED_DB_PATH" "$PROD_DB_PATH"

if [[ -n "$PROD_DB_OWNER" ]]; then
  chown "$PROD_DB_OWNER" "$PROD_DB_PATH"
fi

if [[ -n "$PROD_DB_MODE" ]]; then
  chmod "$PROD_DB_MODE" "$PROD_DB_PATH"
fi

echo "Production DB updated: $PROD_DB_PATH"
echo "Backup created: $BACKUP_PATH"

if [[ -n "$PROD_RESTART_CMD" ]]; then
  echo "Restarting service..."
  eval "$PROD_RESTART_CMD"
fi

echo "Remote-only deploy complete."
