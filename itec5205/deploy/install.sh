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

echo "Loading images"
docker load -i "$UPLOAD/images.tar"

echo "Starting the app"
docker compose up -d --no-build --remove-orphans

echo "Restarting the API, workers and frontend"
docker compose restart backend worker-import worker-rl worker-lstm worker-arima worker-workflow flower frontend

echo "Checking"
ok=""
for _ in $(seq 1 40); do
  if docker exec itec5205-frontend wget -q -O /dev/null http://127.0.0.1/api/health 2>/dev/null; then ok=1; break; fi
  sleep 3
done
docker compose ps --format '  {{.Name}}: {{.Status}}'
rm -rf "$UPLOAD"
docker image prune -f >/dev/null
if [ -z "$ok" ]; then echo "The app did not answer /api/health; see: docker compose logs backend" >&2; exit 1; fi
echo "App is up."
