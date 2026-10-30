#!/bin/bash
# =============================================================================
# Keycloak Users Backup
# Exports only users (with credential hashes) from a realm.
# The resulting JSON can be restored with restore_users.sh without touching
# any other realm configuration (clients, roles, flows, etc.).
#
# Usage:
#   ./backup_users.sh [options]
#
# Options (also settable as environment variables):
#   -r  KC_REALM        Realm to export           (default: master)
#   -c  KC_CONTAINER    Container name            (default: keycloak-https)
#   -i  KC_IMAGE        Keycloak image            (default: quay.io/keycloak/keycloak:26.2.3)
#   -o  BACKUP_DIR      Output directory          (default: ./backups)
#   -n  KC_NETWORK      Docker network name       (default: keycloak_default)
#   -D  KC_DB           Database type             (default: postgres)
#   -U  KC_DB_URL       DB JDBC URL               (default: jdbc:postgresql://postgres:5432/keycloak)
#   -u  KC_DB_USER      DB username               (default: keycloak)
#   -p  KC_DB_PASSWORD  DB password               (default: password)
#
# Requires: docker, jq (or python3 as fallback)
# =============================================================================

set -euo pipefail

# ---------- defaults ---------------------------------------------------------
KC_REALM="${KC_REALM:-master}"
KC_CONTAINER="${KC_CONTAINER:-keycloak-https}"
KC_IMAGE="${KC_IMAGE:-quay.io/keycloak/keycloak:26.2.3}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KC_NETWORK="${KC_NETWORK:-keycloak_default}"
KC_DB="${KC_DB:-postgres}"
KC_DB_URL="${KC_DB_URL:-jdbc:postgresql://postgres:5432/keycloak}"
KC_DB_USER="${KC_DB_USER:-keycloak}"
KC_DB_PASSWORD="${KC_DB_PASSWORD:-password}"

# ---------- argument parsing -------------------------------------------------
while getopts "r:c:i:o:n:D:U:u:p:h" opt; do
  case $opt in
    r) KC_REALM="$OPTARG" ;;
    c) KC_CONTAINER="$OPTARG" ;;
    i) KC_IMAGE="$OPTARG" ;;
    o) BACKUP_DIR="$OPTARG" ;;
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

# ---------- prepare ----------------------------------------------------------
mkdir -p "$BACKUP_DIR"
ABS_BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd)"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FINAL_FILE="$ABS_BACKUP_DIR/keycloak_users_${KC_REALM}_${TIMESTAMP}.json"
EXPORT_TMP=$(mktemp -d)
chmod a+w "$EXPORT_TMP"

log "Container  : $KC_CONTAINER"
log "Image      : $KC_IMAGE"
log "Network    : $KC_NETWORK"
log "Database   : $KC_DB ($KC_DB_URL)"
log "Realm      : $KC_REALM"
log "Output     : $FINAL_FILE"
echo
log "WARNING: Container '$KC_CONTAINER' will be stopped briefly."
echo

# ---------- 1. Stop container ------------------------------------------------
log "Stopping '$KC_CONTAINER'..."
docker stop "$KC_CONTAINER" || fail "Failed to stop container '$KC_CONTAINER'. Is it running?"
log "Container stopped."

# ---------- 2. Export full realm to temp dir ---------------------------------
log "Running kc.sh export (this may take a few seconds)..."
docker run --rm \
  --network "$KC_NETWORK" \
  -e KC_DB="$KC_DB" \
  -e KC_DB_URL="$KC_DB_URL" \
  -e KC_DB_USERNAME="$KC_DB_USER" \
  -e KC_DB_PASSWORD="$KC_DB_PASSWORD" \
  -v "$EXPORT_TMP:/tmp/export" \
  "$KC_IMAGE" export \
  --users realm_file \
  --dir /tmp/export
EXPORT_EXIT=$?

# ---------- 3. Restart container ---------------------------------------------
log "Restarting '$KC_CONTAINER'..."
docker start "$KC_CONTAINER" || log "WARNING: Failed to restart container. Run manually: docker start $KC_CONTAINER"
log "Container restarted."

[ $EXPORT_EXIT -eq 0 ] || { rm -rf "$EXPORT_TMP"; fail "Export failed (exit code $EXPORT_EXIT)."; }

EXPORTED="$EXPORT_TMP/${KC_REALM}-realm.json"
[ -f "$EXPORTED" ] || { rm -rf "$EXPORT_TMP"; fail "Exported file not found: $EXPORTED. Check that realm '$KC_REALM' exists."; }

# ---------- 4. Extract users from full export --------------------------------
log "Extracting users..."
if command -v jq &>/dev/null; then
  jq '{realm: .realm, users: (.users // [])}' "$EXPORTED" > "$FINAL_FILE"
else
  python3 -c "
import json
d = json.load(open('$EXPORTED'))
json.dump({'realm': d['realm'], 'users': d.get('users', [])}, open('$FINAL_FILE', 'w'), indent=2)
"
fi

rm -rf "$EXPORT_TMP"

# ---------- 5. Report --------------------------------------------------------
FILE_SIZE=$(du -sh "$FINAL_FILE" | cut -f1)
if command -v jq &>/dev/null; then
  USER_COUNT=$(jq '.users | length' "$FINAL_FILE")
else
  USER_COUNT=$(grep -o '"username"' "$FINAL_FILE" | wc -l | tr -d ' ')
fi

echo
log "Backup complete (users only - credentials included)."
log "  File  : $FINAL_FILE"
log "  Size  : $FILE_SIZE"
log "  Users : $USER_COUNT"
log "Restore with: ./restore_users.sh \"$FINAL_FILE\" -r $KC_REALM"
