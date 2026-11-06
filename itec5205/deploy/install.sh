#!/usr/bin/env bash
# Runs on the production server (called by deploy.ps1):
#   install.sh <install dir> <upload dir>
# Loads the uploaded images and restarts Alpha Pilot with them.
# The server's .env sets COMPOSE_PROJECT_NAME=itec5205, COMPOSE_FILE (adds
# deploy/docker-compose.server.yml) and COMPOSE_PROFILES=tunnel.
set -euo pipefail

DIR=${1:-/opt/ganymede/alpha-pilot}
UPLOAD=${2:-/tmp/alpha-pilot-deploy}
cd "$DIR"

if [ ! -f .env ]; then
  echo "Missing $DIR/.env (ARANGO_PASSWORD, CORS_ORIGINS, CLOUDFLARE_TUNNEL_TOKEN, COMPOSE_*)." >&2
  exit 1
fi

# ---- Keycloak: existing realms and users are preserved -------------------
# They live in the keycloak_db volume, which nothing here removes (no
# `down -v`), and Keycloak's start-up import (--import-realm) uses strategy
# IGNORE_EXISTING: realms that already exist are skipped, never overwritten.
# As a safety net, back the database up first and compare the counts after.
KC_DB=itec5205-keycloak-db
kc_counts() {
  docker exec "$KC_DB" psql -U keycloak -d keycloak -tAc     "SELECT (SELECT count(*) FROM realm) || ' ' || (SELECT count(*) FROM user_entity)" 2>/dev/null || true
}
KC_BEFORE=""
if docker ps --format '{{.Names}}' | grep -qx "$KC_DB"; then
  mkdir -p keycloak/backups
  KC_DUMP="keycloak/backups/predeploy_$(date +%Y%m%d_%H%M%S).dump"
  echo "Backing up Keycloak (realms, users, keys) to $DIR/$KC_DUMP"
  docker exec "$KC_DB" pg_dump -U keycloak -Fc keycloak > "$KC_DUMP"
  [ -s "$KC_DUMP" ] || { echo "Keycloak backup is empty; not deploying." >&2; exit 1; }
  ls -1t keycloak/backups/predeploy_*.dump | tail -n +11 | xargs -r rm -f  # keep the last 10
  KC_BEFORE=$(kc_counts)
  echo "Keycloak before: ${KC_BEFORE% *} realms, ${KC_BEFORE#* } users"
fi

echo "Loading images"
docker load -i "$UPLOAD/images.tar"

echo "Starting the app"
docker compose up -d --no-build --remove-orphans

echo "Restarting the API, workers, frontend and Keycloak (it caches its theme until restarted)"
docker compose restart backend worker-import worker-rl worker-lstm worker-arima worker-workflow flower frontend keycloak

echo "Checking"
ok=""
for _ in $(seq 1 40); do
  if docker exec itec5205-frontend wget -q -O /dev/null http://127.0.0.1/api/health 2>/dev/null; then ok=1; break; fi
  sleep 3
done
docker compose ps --format '  {{.Name}}: {{.Status}}'

if [ -n "$KC_BEFORE" ]; then
  KC_AFTER=""
  for _ in $(seq 1 40); do KC_AFTER=$(kc_counts); [ -n "$KC_AFTER" ] && break; sleep 3; done
  echo "Keycloak after: ${KC_AFTER% *} realms, ${KC_AFTER#* } users"
  if [ -z "$KC_AFTER" ] || [ "${KC_AFTER% *}" -lt "${KC_BEFORE% *}" ] || [ "${KC_AFTER#* }" -lt "${KC_BEFORE#* }" ]; then
    echo "Keycloak lost realms or users! Restore with: keycloak/restore_keycloak.sh $DIR/$KC_DUMP" >&2
    exit 1
  fi
fi
rm -rf "$UPLOAD"
docker image prune -f >/dev/null
if [ -z "$ok" ]; then echo "The app did not answer /api/health; see: docker compose logs backend" >&2; exit 1; fi
echo "App is up."
