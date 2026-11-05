# Deploys Alpha Pilot from this development PC to the production server.
#
#   deploy\deploy.cmd                      (from Command Prompt)
#
# Builds the backend (API + workers) and frontend images here, copies them with
# the configuration (docker-compose*.yml, keycloak/, ticker lists) to the
# server, then installs and restarts them there (deploy/install.sh). No source
# code or Git on the server; its .env, database, models and Keycloak data are
# never touched.

param(
    [string]$Server = "sergiu@192.168.2.202",
    [string]$Dir = "/opt/ganymede/alpha-pilot"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$work = Join-Path $env:TEMP "alpha-pilot-deploy"
$remote = "/tmp/alpha-pilot-deploy"
$images = @("itec5205-backend:latest", "itec5205-frontend:latest")

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" } }

Step "Building images"
docker compose build backend frontend; Check "docker compose build"

Step "Packing images and configuration"
if (Test-Path $work) { Remove-Item -Recurse -Force $work }
New-Item -ItemType Directory $work | Out-Null
docker save -o "$work\images.tar" @images; Check "docker save"
tar -czf "$work\config.tgz" --exclude=__pycache__ --exclude=keycloak-data --exclude=keycloak-data-http --exclude=keycloak/backups `
    docker-compose.yml tickers.txt russell3000.txt keycloak deploy/docker-compose.server.yml deploy/install.sh deploy/alpha-pilot.service; Check "tar"
$mb = [math]::Round(((Get-ChildItem $work | Measure-Object Length -Sum).Sum) / 1MB)
Write-Host "   $mb MB to copy"

Step "Copying to $Server"
ssh $Server "rm -rf $remote && mkdir -p $remote $Dir"; Check "ssh"
scp -q "$work\images.tar" "$work\config.tgz" "${Server}:$remote/"; Check "scp"

Step "Installing and restarting on the server"
ssh $Server "tar -xzf $remote/config.tgz -C $Dir && sed -i 's/\r$//' $Dir/deploy/*.sh && bash $Dir/deploy/install.sh $Dir $remote"; Check "install"

Remove-Item -Recurse -Force $work
Write-Host "`nDeployed: https://itec5205.ganymedesoftware.ca" -ForegroundColor Green
