#!/usr/bin/env bash
set -euo pipefail

PROD_COMPOSE_DIR="${PROD_COMPOSE_DIR:-/opt/apps/GWS-Connect/repo}"
PROD_DB_PATH="${PROD_DB_PATH:-}"
STAGED_DATA_DIR="${STAGED_DATA_DIR:-}"
STAGED_UPLOADS_DIR="${STAGED_UPLOADS_DIR:-}"
PROD_DB_OWNER="${PROD_DB_OWNER:-}"
PROD_DB_MODE="${PROD_DB_MODE:-}"
CONFIRM="${CONFIRM:-}"

usage() {
  cat <<'EOF'
Usage (run on the production host):
  PROD_DB_PATH=/opt/apps/GWS-Connect/repo/server/data/gws-connect.db \
  STAGED_DATA_DIR=/tmp/gws-connect-sync-123/data \
  STAGED_UPLOADS_DIR=/tmp/gws-connect-sync-123/uploads \
  CONFIRM=YES \
  bash scripts/db/remote-full-sync-deploy.sh

Required environment variables:
  PROD_DB_PATH        Absolute path to the live production SQLite DB file
  STAGED_DATA_DIR     Staged copy of server/data from dev
  STAGED_UPLOADS_DIR  Staged copy of server/uploads from dev
  CONFIRM             Must be exactly YES

Optional environment variables:
  PROD_COMPOSE_DIR    Directory containing the production docker compose stack
  PROD_DB_OWNER       Owner/group to apply to the live DB (e.g. 'gws:gws')
  PROD_DB_MODE        chmod mode for the live DB (e.g. 640)

This script will:
  1) Stop the compose stack
  2) Backup live data/uploads
  3) Mirror staged data/uploads into production
  4) Start the compose stack again
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if [[ -z "$PROD_DB_PATH" || -z "$STAGED_DATA_DIR" || -z "$STAGED_UPLOADS_DIR" ]]; then
  echo "Missing required variables."
  usage
  exit 1
fi

if [[ "$CONFIRM" != "YES" ]]; then
  echo "Refusing to continue without CONFIRM=YES"
  exit 1
fi

if [[ ! -d "$STAGED_DATA_DIR" ]]; then
  echo "Staged data directory not found: $STAGED_DATA_DIR"
  exit 1
fi

if [[ ! -d "$STAGED_UPLOADS_DIR" ]]; then
  echo "Staged uploads directory not found: $STAGED_UPLOADS_DIR"
  exit 1
fi

if [[ ! -f "$PROD_DB_PATH" ]]; then
  echo "Live production DB not found: $PROD_DB_PATH"
  exit 1
fi

if [[ ! -d "$PROD_COMPOSE_DIR" ]]; then
  echo "Production compose directory not found: $PROD_COMPOSE_DIR"
  exit 1
fi

LIVE_DATA_DIR="$(dirname "$PROD_DB_PATH")"
LIVE_UPLOADS_DIR="$(cd "$PROD_COMPOSE_DIR" && pwd)/server/uploads"

if [[ "$(realpath "$STAGED_DATA_DIR")" == "$(realpath "$LIVE_DATA_DIR")" ]]; then
  echo "Staged data directory and live data directory must be different"
  exit 1
fi

if [[ "$(realpath "$STAGED_UPLOADS_DIR")" == "$(realpath "$LIVE_UPLOADS_DIR")" ]]; then
  echo "Staged uploads directory and live uploads directory must be different"
  exit 1
fi

echo "Stopping production compose stack..."
(cd "$PROD_COMPOSE_DIR" && docker compose down)

echo "Backing up live data directories..."
BACKUP_ROOT="$PROD_COMPOSE_DIR/backups"
mkdir -p "$BACKUP_ROOT"
STAMP="$(date +%Y%m%d-%H%M%S)"
DATA_BACKUP="$BACKUP_ROOT/data-$STAMP"
UPLOADS_BACKUP="$BACKUP_ROOT/uploads-$STAMP"
mkdir -p "$DATA_BACKUP" "$UPLOADS_BACKUP"
rsync -a "$LIVE_DATA_DIR/" "$DATA_BACKUP/"
rsync -a "$LIVE_UPLOADS_DIR/" "$UPLOADS_BACKUP/"

echo "Syncing staged data into production..."
rsync -a --delete "$STAGED_DATA_DIR/" "$LIVE_DATA_DIR/"
rsync -a --delete "$STAGED_UPLOADS_DIR/" "$LIVE_UPLOADS_DIR/"

if [[ -n "$PROD_DB_OWNER" ]]; then
  chown "$PROD_DB_OWNER" "$PROD_DB_PATH"
fi

if [[ -n "$PROD_DB_MODE" ]]; then
  chmod "$PROD_DB_MODE" "$PROD_DB_PATH"
fi

echo "Starting production compose stack..."
(cd "$PROD_COMPOSE_DIR" && docker compose up -d)

echo "Production full-data sync complete."
echo "Backups created: $DATA_BACKUP and $UPLOADS_BACKUP"
