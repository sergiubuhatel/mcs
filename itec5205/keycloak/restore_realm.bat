@echo off
:: =============================================================================
:: Keycloak Full Realm Restore (Windows)
:: Imports a complete realm backup - users (with credential hashes), roles,
:: clients, groups, authentication flows, and all realm settings.
:: Uses kc.sh import via Docker. If the realm already exists it is overwritten.
::
:: Usage:
::   restore_realm.bat <backup_file.json> [options]
::
:: Arguments:
::   backup_file.json   Path to the JSON file created by backup_realm.bat
::
:: Options:
::   -r <realm>     Realm name                (default: master)
::   -c <name>      Container name            (default: keycloak-https)
::   -i <image>     Keycloak image            (default: quay.io/keycloak/keycloak:26.2.3)
::   -n <network>   Docker network name       (default: keycloak_default)
::   -D <db>        Database type             (default: postgres)
::   -U <url>       DB JDBC URL               (default: jdbc:postgresql://postgres:5432/keycloak)
::   -u <user>      DB username               (default: keycloak)
::   -p <password>  DB password               (default: password)
::
:: Requires: docker.exe
:: =============================================================================
setlocal enabledelayedexpansion

:: ---------- first positional argument = backup file --------------------------
set "BACKUP_FILE=%~1"
if "!BACKUP_FILE!"=="" (
  echo Usage: %~nx0 ^<backup_file.json^> [-r realm] [-c container] [-n network] ...
  echo.
  echo Available backups in .\backups\:
  if exist ".\backups\*.json" ( dir /b ".\backups\*.json" ) else ( echo   ^(none found^) )
  exit /b 1
)
shift

:: ---------- defaults ----------------------------------------------------------
if not defined KC_REALM        set "KC_REALM=master"
if not defined KC_CONTAINER    set "KC_CONTAINER=keycloak-https"
if not defined KC_IMAGE        set "KC_IMAGE=quay.io/keycloak/keycloak:26.2.3"
if not defined KC_NETWORK      set "KC_NETWORK=keycloak_default"
if not defined KC_DB           set "KC_DB=postgres"
if not defined KC_DB_URL       set "KC_DB_URL=jdbc:postgresql://postgres:5432/keycloak"
if not defined KC_DB_USER      set "KC_DB_USER=keycloak"
if not defined KC_DB_PASSWORD  set "KC_DB_PASSWORD=password"

:: ---------- argument parsing --------------------------------------------------
:parse_args
if "%~1"=="" goto :end_parse
if /i "%~1"=="-r" ( set "KC_REALM=%~2"       & shift & shift & goto :parse_args )
if /i "%~1"=="-c" ( set "KC_CONTAINER=%~2"   & shift & shift & goto :parse_args )
if /i "%~1"=="-i" ( set "KC_IMAGE=%~2"       & shift & shift & goto :parse_args )
if /i "%~1"=="-n" ( set "KC_NETWORK=%~2"     & shift & shift & goto :parse_args )
if /i "%~1"=="-D" ( set "KC_DB=%~2"          & shift & shift & goto :parse_args )
if /i "%~1"=="-U" ( set "KC_DB_URL=%~2"      & shift & shift & goto :parse_args )
if /i "%~1"=="-u" ( set "KC_DB_USER=%~2"     & shift & shift & goto :parse_args )
if /i "%~1"=="-p" ( set "KC_DB_PASSWORD=%~2" & shift & shift & goto :parse_args )
shift & goto :parse_args
:end_parse

:: ---------- validate ----------------------------------------------------------
if not exist "!BACKUP_FILE!" (
  call :err "Backup file not found: !BACKUP_FILE!"
  exit /b 1
)

:: Resolve to absolute path
for %%F in ("!BACKUP_FILE!") do set "ABS_BACKUP_FILE=%%~fF"

call :log "Container  : %KC_CONTAINER%"
call :log "Image      : %KC_IMAGE%"
call :log "Network    : %KC_NETWORK%"
call :log "Database   : %KC_DB% (%KC_DB_URL%)"
call :log "Realm      : %KC_REALM%"
call :log "Backup     : !ABS_BACKUP_FILE!"
echo.
call :warn "Realm '%KC_REALM%' will be overwritten if it exists."
echo.

:: ---------- 1. Stop container ------------------------------------------------
call :log "Stopping '%KC_CONTAINER%'..."
docker stop %KC_CONTAINER%
if errorlevel 1 (
  call :err "Failed to stop container '%KC_CONTAINER%'. Is it running?"
  exit /b 1
)
call :log "Container stopped."

:: ---------- 2. Import realm via temp container -------------------------------
:: Mount the backup file as <realm>-realm.json so kc.sh import can find it
call :log "Running kc.sh import..."
docker run --rm ^
  --network %KC_NETWORK% ^
  -e KC_DB=%KC_DB% ^
  -e KC_DB_URL=%KC_DB_URL% ^
  -e KC_DB_USERNAME=%KC_DB_USER% ^
  -e KC_DB_PASSWORD=%KC_DB_PASSWORD% ^
  -v "!ABS_BACKUP_FILE!:/tmp/import/%KC_REALM%-realm.json" ^
  %KC_IMAGE% import ^
  --dir /tmp/import ^
  --override true 2>&1

set "IMPORT_EXIT=%errorlevel%"

:: ---------- 3. Restart container ---------------------------------------------
call :log "Restarting '%KC_CONTAINER%'..."
docker start %KC_CONTAINER%
if errorlevel 1 (
  call :err "Failed to restart container. Restart manually: docker start %KC_CONTAINER%"
)
call :log "Container restarted."

if %IMPORT_EXIT% neq 0 (
  call :err "Import command failed (exit code %IMPORT_EXIT%)."
  exit /b 1
)

echo.
call :log "Restore complete. Realm '%KC_REALM%' has been fully imported."

endlocal
exit /b 0

:: ---------- helpers ----------------------------------------------------------
:log
echo [%date% %time:~0,8%] %~1
exit /b 0

:warn
echo [%date% %time:~0,8%] WARNING: %~1
exit /b 0

:err
echo [%date% %time:~0,8%] ERROR: %~1 >&2
exit /b 0
