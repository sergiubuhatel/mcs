#!/bin/bash
# =============================================================================
# Keycloak Full Realm Restore
# Imports a complete realm backup - users (with credential hashes), roles,
# clients, groups, authentication flows, and all realm settings.
# Uses kc.sh import via Docker. If the realm already exists it is overwritten.
#
# Usage:
#   ./restore_realm.sh <backup_file.json> [options]
#
# Arguments:
#   backup_file.json   Path to the JSON file created by backup_realm.sh
#
# Options (also settable as environment variables):
#   -r  KC_REALM        Realm name                (default: master)
#   -c  KC_CONTAINER    Container name            (default: itec5205-keycloak)
#   -i  KC_IMAGE        Keycloak image            (default: quay.io/keycloak/keycloak:26.2.3)
#   -n  KC_NETWORK      Docker network name       (default: itec5205_default)
#   -D  KC_DB           Database type             (default: postgres)
#   -U  KC_DB_URL       DB JDBC URL               (default: jdbc:postgresql://keycloak-db:5432/keycloak)
#   -u  KC_DB_USER      DB username               (default: keycloak)
#   -p  KC_DB_PASSWORD  DB password               (default: password)
#
# Requires: docker
# =============================================================================

set -euo pipefail

# ---------- first positional argument = backup file --------------------------
BACKUP_FILE="${1:-}"
if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: $0 <backup_file.json> [-r realm] [-c container] [-n network] ..."
  echo
  echo "Available backups in ./backups/:"
  ls ./backups/*.json 2>/dev/null || echo "  (none found)"
  exit 1
fi
shift

# ---------- defaults ---------------------------------------------------------
KC_REALM="${KC_REALM:-master}"
KC_CONTAINER="${KC_CONTAINER:-itec5205-keycloak}"
KC_IMAGE="${KC_IMAGE:-quay.io/keycloak/keycloak:26.2.3}"
KC_NETWORK="${KC_NETWORK:-itec5205_default}"
KC_DB="${KC_DB:-postgres}"
KC_DB_URL="${KC_DB_URL:-jdbc:postgresql://keycloak-db:5432/keycloak}"
KC_DB_USER="${KC_DB_USER:-keycloak}"
KC_DB_PASSWORD="${KC_DB_PASSWORD:-keycloak}"

# ---------- argument parsing -------------------------------------------------
while getopts "r:c:i:n:D:U:u:p:h" opt; do
  case $opt in
    r) KC_REALM="$OPTARG" ;;
    c) KC_CONTAINER="$OPTARG" ;;
    i) KC_IMAGE="$OPTARG" ;;
    n) KC_NETWORK="$OPTARG" ;;
    D) KC_DB="$OPTARG" ;;
    U) KC_DB_URL="$OPTARG" ;;
    u) KC_DB_USER="$OPTARG" ;;
    p) KC_DB_PASSWORD="$OPTARG" ;;
    h) sed -n '/^# ====/,/^# ====/p' "$0"; exit 0 ;;
    *) echo "Unknown option: -$OPTARG"; exit 1 ;;
  esac
done

# ---------- helpers ----------------------------------------------------------
log()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
fail() { log "ERROR: $*" >&2; exit 1; }

# ---------- validate ---------------------------------------------------------
[ -f "$BACKUP_FILE" ] || fail "Backup file not found: $BACKUP_FILE"
ABS_BACKUP_FILE="$(cd "$(dirname "$BACKUP_FILE")" && pwd)/$(basename "$BACKUP_FILE")"

log "Container  : $KC_CONTAINER"
log "Image      : $KC_IMAGE"
log "Network    : $KC_NETWORK"
log "Database   : $KC_DB ($KC_DB_URL)"
log "Realm      : $KC_REALM"
log "Backup     : $ABS_BACKUP_FILE"
echo
log "WARNING: Realm '$KC_REALM' will be overwritten if it exists."
echo

# ---------- 1. Stop container ------------------------------------------------
log "Stopping '$KC_CONTAINER'..."
docker stop "$KC_CONTAINER" || fail "Failed to stop container '$KC_CONTAINER'. Is it running?"
log "Container stopped."

# ---------- 2. Import realm via temp container -------------------------------
# Mount the backup file as <realm>-realm.json so kc.sh import can find it
log "Running kc.sh import..."
docker run --rm \
  --network "$KC_NETWORK" \
  -e KC_DB="$KC_DB" \
  -e KC_DB_URL="$KC_DB_URL" \
  -e KC_DB_USERNAME="$KC_DB_USER" \
  -e KC_DB_PASSWORD="$KC_DB_PASSWORD" \
  -v "$ABS_BACKUP_FILE:/tmp/import/${KC_REALM}-realm.json" \
  "$KC_IMAGE" import \
  --dir /tmp/import \
  --override true
IMPORT_EXIT=$?

# ---------- 3. Restart container ---------------------------------------------
log "Restarting '$KC_CONTAINER'..."
docker start "$KC_CONTAINER" || log "WARNING: Failed to restart container. Run manually: docker start $KC_CONTAINER"
log "Container restarted."

[ $IMPORT_EXIT -eq 0 ] || fail "Import command failed (exit code $IMPORT_EXIT)."

echo
log "Restore complete. Realm '$KC_REALM' has been fully imported."
