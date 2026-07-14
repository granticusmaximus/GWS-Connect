#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
MODE="${1:-}"
shift || true

usage() {
  cat <<'EOF'
Usage:
  npm run db:deploy -- <mode>

Modes:
  upload   Local dev DB -> production host -> remote deploy/restart
  remote   Run the host-side staged-file deploy only
  sync     Dev-to-prod sync using the existing local DB source
  full     Sync the full dev data set (data + uploads) to production

Examples:
  PROD_HOST=connect.gwsapp.net \
  PROD_USER=deploy \
  PROD_DB_PATH=/var/lib/gws-connect/gws-connect.db \
  PROD_RESTART_CMD='systemctl restart gws-connect' \
  CONFIRM=YES \
  npm run db:deploy -- upload

  PROD_DB_PATH=/var/lib/gws-connect/gws-connect.db \
  STAGED_DB_PATH=/tmp/gws-connect.db \
  PROD_RESTART_CMD='systemctl restart gws-connect' \
  CONFIRM=YES \
  npm run db:deploy -- remote

  PROD_HOST=connect.gwsapp.net \
  PROD_USER=deploy \
  PROD_DB_PATH=/var/lib/gws-connect/gws-connect.db \
  PROD_RESTART_CMD='systemctl restart gws-connect' \
  CONFIRM=YES \
  npm run db:deploy -- sync

  PROD_HOST=connect.gwsapp.net \
  PROD_USER=deploy \
  PROD_DB_PATH=/opt/apps/GWS-Connect/repo/server/data/gws-connect.db \
  CONFIRM=YES \
  npm run db:deploy -- full
EOF
}

case "$MODE" in
  upload|u|push|local-to-prod)
    exec bash "$ROOT_DIR/scripts/db/upload-and-remote-deploy.sh" "$@"
    ;;
  remote|r|remote-only)
    exec bash "$ROOT_DIR/scripts/db/remote-only-deploy.sh" "$@"
    ;;
  sync|s|dev-to-prod|pre-staged)
    exec bash "$ROOT_DIR/scripts/db/sync-dev-to-prod.sh" "$@"
    ;;
  full|all|everything|data|data-sync)
    exec bash "$ROOT_DIR/scripts/db/upload-and-remote-full-sync.sh" "$@"
    ;;
  ""|help|-h|--help)
    usage
    exit 0
    ;;
  *)
    echo "Unknown mode: $MODE"
    usage
    exit 1
    ;;
esac
