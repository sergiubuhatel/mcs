#!/bin/bash
# =============================================================================
# Keycloak Users Restore
# Restores users into an existing realm without touching any other realm
# configuration (clients, roles, flows, etc.).
# All existing users in the realm are replaced by the backup.
#
# Usage:
#   ./restore_users.sh <backup_file.json> [options]
#
# Arguments:
#   backup_file.json   Path to the JSON file created by backup_users.sh
#
# Options (also settable as environment variables):
#   -r  KC_REALM        Realm name                (default: master)
#   -c  KC_CONTAINER    Container name            (default: keycloak-https)
#   -i  KC_IMAGE        Keycloak image            (default: quay.io/keycloak/keycloak:26.2.3)
#   -n  KC_NETWORK      Docker network name       (default: keycloak_default)
#   -D  KC_DB           Database type             (default: postgres)
#   -U  KC_DB_URL       DB JDBC URL               (default: jdbc:postgresql://postgres:5432/keycloak)
#   -u  KC_DB_USER      DB username               (default: keycloak)
#   -p  KC_DB_PASSWORD  DB password               (default: password)
#
# Requires: docker, jq (or python3 as fallback)
# =============================================================================

set -euo pipefail

# ---------- first positional argument = backup file --------------------------
BACKUP_FILE="${1:-}"
if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: $0 <backup_file.json> [-r realm] [-c container] ..."
  exit 1
fi
shift

# ---------- defaults ---------------------------------------------------------
KC_REALM="${KC_REALM:-master}"
KC_CONTAINER="${KC_CONTAINER:-keycloak-https}"
KC_IMAGE="${KC_IMAGE:-quay.io/keycloak/keycloak:26.2.3}"
KC_NETWORK="${KC_NETWORK:-keycloak_default}"
KC_DB="${KC_DB:-postgres}"
KC_DB_URL="${KC_DB_URL:-jdbc:postgresql://postgres:5432/keycloak}"
KC_DB_USER="${KC_DB_USER:-keycloak}"
KC_DB_PASSWORD="${KC_DB_PASSWORD:-password}"

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
log "WARNING: All existing users in realm '$KC_REALM' will be replaced."
echo

# ---------- 1. Stop container ------------------------------------------------
log "Stopping '$KC_CONTAINER'..."
docker stop "$KC_CONTAINER" || fail "Failed to stop container '$KC_CONTAINER'. Is it running?"
log "Container stopped."

# ---------- 2. Export current realm to temp dir ------------------------------
log "Exporting current realm configuration..."
WORK_TMP=$(mktemp -d)
chmod a+w "$WORK_TMP"

docker run --rm \
  --network "$KC_NETWORK" \
  -e KC_DB="$KC_DB" \
  -e KC_DB_URL="$KC_DB_URL" \
  -e KC_DB_USERNAME="$KC_DB_USER" \
  -e KC_DB_PASSWORD="$KC_DB_PASSWORD" \
  -v "$WORK_TMP:/tmp/export" \
  "$KC_IMAGE" export \
  --users realm_file \
  --dir /tmp/export
EXPORT_EXIT=$?

if [ $EXPORT_EXIT -ne 0 ]; then
  docker start "$KC_CONTAINER"
  rm -rf "$WORK_TMP"
  fail "Failed to export current realm (exit code $EXPORT_EXIT)."
fi

EXPORTED="$WORK_TMP/${KC_REALM}-realm.json"
if [ ! -f "$EXPORTED" ]; then
  docker start "$KC_CONTAINER"
  rm -rf "$WORK_TMP"
  fail "Exported file not found: $EXPORTED. Check that realm '$KC_REALM' exists."
fi

# ---------- 3. Merge users from backup into current realm --------------------
log "Merging users from backup..."
MERGED="$WORK_TMP/${KC_REALM}-merged-realm.json"

if command -v jq &>/dev/null; then
  jq --slurpfile b "$ABS_BACKUP_FILE" '.users = ($b[0].users // [])' "$EXPORTED" > "$MERGED"
else
  python3 -c "
import json
current = json.load(open('$EXPORTED'))
backup  = json.load(open('$ABS_BACKUP_FILE'))
current['users'] = backup.get('users', [])
json.dump(current, open('$MERGED', 'w'), indent=2)
"
fi

# ---------- 4. Import merged realm -------------------------------------------
log "Importing users..."
docker run --rm \
  --network "$KC_NETWORK" \
  -e KC_DB="$KC_DB" \
  -e KC_DB_URL="$KC_DB_URL" \
  -e KC_DB_USERNAME="$KC_DB_USER" \
  -e KC_DB_PASSWORD="$KC_DB_PASSWORD" \
  -v "$MERGED:/tmp/import/${KC_REALM}-realm.json" \
  "$KC_IMAGE" import \
  --dir /tmp/import \
  --override true
IMPORT_EXIT=$?

# ---------- 5. Restart container ---------------------------------------------
log "Restarting '$KC_CONTAINER'..."
docker start "$KC_CONTAINER" || log "WARNING: Failed to restart container. Run manually: docker start $KC_CONTAINER"
log "Container restarted."

rm -rf "$WORK_TMP"

[ $IMPORT_EXIT -eq 0 ] || fail "Import failed (exit code $IMPORT_EXIT)."

echo
log "Restore complete. Users in realm '$KC_REALM' have been restored."
