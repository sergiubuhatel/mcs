#!/bin/bash
# =============================================================================
# Restore the app's Keycloak from a database dump made by backup_keycloak.sh.
# REPLACES the whole Keycloak database (all realms, users, keys, settings):
# stops Keycloak, recreates the database from the dump, starts Keycloak again.
# Users must sign in again afterwards.
#
# Usage (Git Bash):  keycloak/restore_keycloak.sh keycloak/backups/keycloak_db_<timestamp>.dump
# =============================================================================

set -euo pipefail
export MSYS_NO_PATHCONV=1  # Git Bash: don't rewrite container paths

DUMP="${1:-}"
DB_CONTAINER="${DB_CONTAINER:-itec5205-keycloak-db}"
KC_CONTAINER="${KC_CONTAINER:-itec5205-keycloak}"

if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "Usage: $0 <keycloak_db_YYYYmmdd_HHMMSS.dump>"
  echo "Backups:"; ls -1 "$(dirname "$0")/backups/"*.dump 2>/dev/null || echo "  (none)"
  exit 1
fi

log() { echo "[$(date '+%H:%M:%S')] $*"; }

read -r -p "Replace the whole Keycloak database with $(basename "$DUMP")? Type RESTORE: " answer
[ "$answer" = "RESTORE" ] || { echo "Cancelled."; exit 1; }

log "Stopping Keycloak..."
docker stop "$KC_CONTAINER" >/dev/null

log "Recreating the database from the dump..."
docker cp "$DUMP" "$DB_CONTAINER:/tmp/restore.dump"
docker exec "$DB_CONTAINER" psql -U keycloak -d postgres -q -c "DROP DATABASE IF EXISTS keycloak WITH (FORCE)" -c "CREATE DATABASE keycloak OWNER keycloak"
docker exec "$DB_CONTAINER" pg_restore -U keycloak -d keycloak --no-owner /tmp/restore.dump
docker exec "$DB_CONTAINER" rm -f /tmp/restore.dump

log "Starting Keycloak..."
docker start "$KC_CONTAINER" >/dev/null
log "Done. Keycloak takes ~10 s to come up; everyone signs in again."
