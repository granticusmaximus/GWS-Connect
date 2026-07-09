#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SRC_DB="${1:-$ROOT_DIR/server/data/gws-connect.db}"
OUT_DIR="${2:-$ROOT_DIR/server/data/backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"

if [[ ! -f "$SRC_DB" ]]; then
  echo "Source database not found: $SRC_DB"
  exit 1
fi

mkdir -p "$OUT_DIR"
DEST_DB="$OUT_DIR/gws-connect.$STAMP.db"

cp "$SRC_DB" "$DEST_DB"

echo "Backup created: $DEST_DB"
ls -lh "$DEST_DB"
