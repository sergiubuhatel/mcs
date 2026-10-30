#!/bin/bash
# =============================================================================
# Keycloak Full Realm Backup
# Exports an entire realm - users (with credential hashes), roles, clients,
# groups, authentication flows, and all realm settings - via kc.sh export.
# The resulting JSON can be fully restored with restore_realm.sh.
#
# Usage:
#   ./backup_realm.sh [options]
#
# Options (also settable as environment variables):
#   -r  KC_REALM        Realm to export           (default: master)
#   -c  KC_CONTAINER    Container name            (default: itec5205-keycloak)
#   -i  KC_IMAGE        Keycloak image            (default: quay.io/keycloak/keycloak:26.2.3)
#   -o  BACKUP_DIR      Output directory          (default: ./backups)
#   -n  KC_NETWORK      Docker network name       (default: itec5205_default)
#   -D  KC_DB           Database type             (default: postgres)
#   -U  KC_DB_URL       DB JDBC URL               (default: jdbc:postgresql://keycloak-db:5432/keycloak)
#   -u  KC_DB_USER      DB username               (default: keycloak)
#   -p  KC_DB_PASSWORD  DB password               (default: password)
#
# Requires: docker
# =============================================================================

set -euo pipefail

# ---------- defaults ---------------------------------------------------------
KC_REALM="${KC_REALM:-master}"
KC_CONTAINER="${KC_CONTAINER:-itec5205-keycloak}"
KC_IMAGE="${KC_IMAGE:-quay.io/keycloak/keycloak:26.2.3}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KC_NETWORK="${KC_NETWORK:-itec5205_default}"
KC_DB="${KC_DB:-postgres}"
KC_DB_URL="${KC_DB_URL:-jdbc:postgresql://keycloak-db:5432/keycloak}"
KC_DB_USER="${KC_DB_USER:-keycloak}"
KC_DB_PASSWORD="${KC_DB_PASSWORD:-keycloak}"

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
chmod a+w "$ABS_BACKUP_DIR"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FINAL_FILE="$ABS_BACKUP_DIR/keycloak_realm_${KC_REALM}_${TIMESTAMP}.json"

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

# ---------- 2. Export realm via temp container -------------------------------
log "Running kc.sh export (this may take a few seconds)..."
docker run --rm \
  --network "$KC_NETWORK" \
  -e KC_DB="$KC_DB" \
  -e KC_DB_URL="$KC_DB_URL" \
  -e KC_DB_USERNAME="$KC_DB_USER" \
  -e KC_DB_PASSWORD="$KC_DB_PASSWORD" \
  -v "$ABS_BACKUP_DIR:/tmp/export" \
  "$KC_IMAGE" export \
  --realm "$KC_REALM" \
  --users realm_file \
  --dir /tmp/export
EXPORT_EXIT=$?

# ---------- 3. Restart container ---------------------------------------------
log "Restarting '$KC_CONTAINER'..."
docker start "$KC_CONTAINER" || log "WARNING: Failed to restart container. Run manually: docker start $KC_CONTAINER"
log "Container restarted."

[ $EXPORT_EXIT -eq 0 ] || fail "Export command failed (exit code $EXPORT_EXIT)."

# ---------- 4. Rename to timestamped filename --------------------------------
EXPORTED="$ABS_BACKUP_DIR/${KC_REALM}-realm.json"
[ -f "$EXPORTED" ] || fail "Export file not found: $EXPORTED. Check that realm '$KC_REALM' exists and the DB connection is correct."
mv "$EXPORTED" "$FINAL_FILE"

FILE_SIZE=$(du -sh "$FINAL_FILE" | cut -f1)
if command -v jq &>/dev/null; then
  USER_COUNT=$(jq '.users | length' "$FINAL_FILE")
else
  USER_COUNT=$(grep -o '"username"' "$FINAL_FILE" | wc -l | tr -d ' ')
fi

echo
log "Backup complete (full realm - credentials included)."
log "  File  : $FINAL_FILE"
log "  Size  : $FILE_SIZE"
log "  Users : $USER_COUNT"
log "Restore with: ./restore_realm.sh \"$FINAL_FILE\" -r $KC_REALM"
