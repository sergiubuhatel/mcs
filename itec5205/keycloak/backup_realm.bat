@echo off
:: =============================================================================
:: Keycloak Full Realm Backup (Windows)
:: Exports an entire realm - users (with credential hashes), roles, clients,
:: groups, authentication flows, and all realm settings - via kc.sh export.
:: The resulting JSON can be fully restored with restore_realm.bat.
::
:: Usage:
::   backup_realm.bat [options]
::
:: Options:
::   -r <realm>     Realm to export           (default: master)
::   -c <name>      Container name            (default: itec5205-keycloak)
::   -i <image>     Keycloak image            (default: quay.io/keycloak/keycloak:26.2.3)
::   -o <dir>       Output directory          (default: .\backups)
::   -n <network>   Docker network name       (default: itec5205_default)
::   -D <db>        Database type             (default: postgres)
::   -U <url>       DB JDBC URL               (default: jdbc:postgresql://keycloak-db:5432/keycloak)
::   -u <user>      DB username               (default: keycloak)
::   -p <password>  DB password               (default: password)
::
:: Requires: docker.exe
:: =============================================================================
setlocal enabledelayedexpansion

:: ---------- defaults ----------------------------------------------------------
if not defined KC_REALM        set "KC_REALM=master"
if not defined KC_CONTAINER    set "KC_CONTAINER=itec5205-keycloak"
if not defined KC_IMAGE        set "KC_IMAGE=quay.io/keycloak/keycloak:26.2.3"
if not defined BACKUP_DIR      set "BACKUP_DIR=.\backups"
if not defined KC_NETWORK      set "KC_NETWORK=itec5205_default"
if not defined KC_DB           set "KC_DB=postgres"
if not defined KC_DB_URL       set "KC_DB_URL=jdbc:postgresql://keycloak-db:5432/keycloak"
if not defined KC_DB_USER      set "KC_DB_USER=keycloak"
if not defined KC_DB_PASSWORD  set "KC_DB_PASSWORD=keycloak"

:: ---------- argument parsing --------------------------------------------------
:parse_args
if "%~1"=="" goto :end_parse
if /i "%~1"=="-r" ( set "KC_REALM=%~2"       & shift & shift & goto :parse_args )
if /i "%~1"=="-c" ( set "KC_CONTAINER=%~2"   & shift & shift & goto :parse_args )
if /i "%~1"=="-i" ( set "KC_IMAGE=%~2"       & shift & shift & goto :parse_args )
if /i "%~1"=="-o" ( set "BACKUP_DIR=%~2"     & shift & shift & goto :parse_args )
if /i "%~1"=="-n" ( set "KC_NETWORK=%~2"     & shift & shift & goto :parse_args )
if /i "%~1"=="-D" ( set "KC_DB=%~2"          & shift & shift & goto :parse_args )
if /i "%~1"=="-U" ( set "KC_DB_URL=%~2"      & shift & shift & goto :parse_args )
if /i "%~1"=="-u" ( set "KC_DB_USER=%~2"     & shift & shift & goto :parse_args )
if /i "%~1"=="-p" ( set "KC_DB_PASSWORD=%~2" & shift & shift & goto :parse_args )
shift & goto :parse_args
:end_parse

:: ---------- prepare ----------------------------------------------------------
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"
for %%F in ("%BACKUP_DIR%") do set "ABS_BACKUP_DIR=%%~fF"
for /f "delims=" %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "TIMESTAMP=%%T"
set "FINAL_FILE=%ABS_BACKUP_DIR%\keycloak_realm_%KC_REALM%_%TIMESTAMP%.json"

call :log "Container  : %KC_CONTAINER%"
call :log "Image      : %KC_IMAGE%"
call :log "Network    : %KC_NETWORK%"
call :log "Database   : %KC_DB% (%KC_DB_URL%)"
call :log "Realm      : %KC_REALM%"
call :log "Output     : %FINAL_FILE%"
echo.
call :warn "Container '%KC_CONTAINER%' will be stopped briefly."
echo.

:: ---------- 1. Stop container ------------------------------------------------
call :log "Stopping '%KC_CONTAINER%'..."
docker stop %KC_CONTAINER%
if errorlevel 1 (
  call :err "Failed to stop container '%KC_CONTAINER%'. Is it running?"
  exit /b 1
)
call :log "Container stopped."

:: ---------- 2. Export realm via temp container -------------------------------
call :log "Running kc.sh export (this may take a few seconds)..."
docker run --rm ^
  --network %KC_NETWORK% ^
  -e KC_DB=%KC_DB% ^
  -e KC_DB_URL=%KC_DB_URL% ^
  -e KC_DB_USERNAME=%KC_DB_USER% ^
  -e KC_DB_PASSWORD=%KC_DB_PASSWORD% ^
  -v "%ABS_BACKUP_DIR%:/tmp/export" ^
  %KC_IMAGE% export ^
  --realm %KC_REALM% ^
  --users realm_file ^
  --dir /tmp/export 2>&1

set "EXPORT_EXIT=%errorlevel%"

:: ---------- 3. Restart container ---------------------------------------------
call :log "Restarting '%KC_CONTAINER%'..."
docker start %KC_CONTAINER%
if errorlevel 1 (
  call :err "Failed to restart container. Restart manually: docker start %KC_CONTAINER%"
)
call :log "Container restarted."

if %EXPORT_EXIT% neq 0 (
  call :err "Export command failed (exit code %EXPORT_EXIT%)."
  exit /b 1
)

:: ---------- 4. Rename to timestamped filename --------------------------------
:: kc.sh export creates <realm>-realm.json in the output directory
set "EXPORTED=%ABS_BACKUP_DIR%\%KC_REALM%-realm.json"
if not exist "%EXPORTED%" (
  call :err "Export file not found: %EXPORTED%"
  call :err "Check that realm '%KC_REALM%' exists and the DB connection is correct."
  exit /b 1
)
move "%EXPORTED%" "%FINAL_FILE%" > nul

for %%F in ("%FINAL_FILE%") do set "FILE_SIZE=%%~zF"
for /f %%C in ('powershell -NoProfile -Command "@(Get-Content ''%FINAL_FILE%'' -Raw | ConvertFrom-Json).users.Count"') do set "USER_COUNT=%%C"

echo.
call :log "Backup complete (full realm - credentials included)."
call :log "  File  : %FINAL_FILE%"
call :log "  Size  : !FILE_SIZE! bytes"
call :log "  Users : !USER_COUNT!"
call :log "Restore with: restore_realm.bat ""%FINAL_FILE%"" -r %KC_REALM%"

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
