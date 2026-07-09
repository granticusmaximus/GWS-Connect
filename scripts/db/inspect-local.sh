#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
DB_PATH="${1:-$ROOT_DIR/server/data/gws-connect.db}"

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 is required but not installed."
  exit 1
fi

if [[ ! -f "$DB_PATH" ]]; then
  echo "Database not found: $DB_PATH"
  exit 1
fi

echo "Database: $DB_PATH"
echo "File info:"
ls -lh "$DB_PATH"

echo
echo "SQLite metadata:"
sqlite3 "$DB_PATH" "PRAGMA user_version; PRAGMA journal_mode; PRAGMA foreign_keys;"

echo
echo "Table counts:"
sqlite3 "$DB_PATH" <<'SQL'
.mode box
SELECT 'users' AS table_name, COUNT(*) AS count FROM users
UNION ALL SELECT 'channels', COUNT(*) FROM channels
UNION ALL SELECT 'messages', COUNT(*) FROM messages
UNION ALL SELECT 'group_chats', COUNT(*) FROM group_chats
UNION ALL SELECT 'friends', COUNT(*) FROM friends
UNION ALL SELECT 'voice_channels', COUNT(*) FROM voice_channels;
SQL

echo
echo "Tables:"
sqlite3 "$DB_PATH" ".tables"
