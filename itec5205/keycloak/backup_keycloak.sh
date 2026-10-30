#!/bin/bash
# =============================================================================
# Back up the app's Keycloak (docker compose services keycloak-db + keycloak),
# while it keeps running:
#   backups/keycloak_db_<timestamp>.dump  pg_dump of the whole Keycloak database:
#                                         every realm, user, password hash, key,
#                                         client and setting -- exact restore
#                                         with restore_keycloak.sh
#   backups/realms_<timestamp>/           kc.sh export of every realm as JSON
#                                         (readable / portable; import into a
#                                         fresh Keycloak with restore_realm.sh)
# backups/ is gitignored: these files hold password hashes and realm keys.
#
# Usage (Git Bash, from anywhere):  keycloak/backup_keycloak.sh
# =============================================================================

set -euo pipefail
export MSYS_NO_PATHCONV=1  # Git Bash: don't rewrite container paths

cd "$(dirname "$0")"
DB_CONTAINER="${DB_CONTAINER:-itec5205-keycloak-db}"
NETWORK="${NETWORK:-itec5205_default}"
KC_IMAGE="${KC_IMAGE:-quay.io/keycloak/keycloak:26.2.3}"
DB_PASSWORD="${KEYCLOAK_DB_PASSWORD:-keycloak}"
TS="$(date +%Y%m%d_%H%M%S)"
OUT="backups"
mkdir -p "$OUT/realms_$TS"
HOST_OUT="$(cd "$OUT" && (pwd -W 2>/dev/null || pwd))"  # Windows path for docker -v

log() { echo "[$(date '+%H:%M:%S')] $*"; }

log "Dumping the Keycloak database..."
docker exec "$DB_CONTAINER" pg_dump -U keycloak -d keycloak -Fc -f /tmp/keycloak.dump
docker cp "$DB_CONTAINER:/tmp/keycloak.dump" "$OUT/keycloak_db_$TS.dump"
docker exec "$DB_CONTAINER" rm -f /tmp/keycloak.dump
log "  -> $OUT/keycloak_db_$TS.dump"

log "Exporting every realm as JSON..."
docker run --rm --network "$NETWORK" \
  -e KC_DB=postgres -e KC_DB_URL=jdbc:postgresql://keycloak-db:5432/keycloak \
  -e KC_DB_USERNAME=keycloak -e KC_DB_PASSWORD="$DB_PASSWORD" -e KC_CACHE=local \
  -v "$HOST_OUT/realms_$TS:/export" \
  "$KC_IMAGE" export --dir /export --users realm_file >/dev/null
log "  -> $OUT/realms_$TS/ ($(ls "$OUT/realms_$TS" | tr '\n' ' '))"
log "Done."
