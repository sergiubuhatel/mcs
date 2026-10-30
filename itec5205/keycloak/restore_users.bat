@echo off
:: =============================================================================
:: Keycloak Users Restore (Windows)
:: Restores users into an existing realm without touching any other realm
:: configuration (clients, roles, flows, etc.).
:: All existing users in the realm are replaced by the backup.
::
:: Usage:
::   restore_users.bat <backup_file.json> [options]
::
:: Arguments:
::   backup_file.json   Path to the JSON file created by backup_users.bat
::
:: Options:
::   -r <realm>     Realm name                (default: master)
::   -c <name>      Container name            (default: itec5205-keycloak)
::   -i <image>     Keycloak image            (default: quay.io/keycloak/keycloak:26.2.3)
::   -n <network>   Docker network name       (default: itec5205_default)
::   -D <db>        Database type             (default: postgres)
::   -U <url>       DB JDBC URL               (default: jdbc:postgresql://keycloak-db:5432/keycloak)
::   -u <user>      DB username               (default: keycloak)
::   -p <password>  DB password               (default: password)
::
:: Requires: docker.exe
:: =============================================================================
setlocal enabledelayedexpansion

:: ---------- first positional argument = backup file --------------------------
set "BACKUP_FILE=%~1"
if "!BACKUP_FILE!"=="" (
  echo Usage: %~nx0 ^<backup_file.json^> [-r realm] [-c container] ...
  exit /b 1
)
shift

:: ---------- defaults ----------------------------------------------------------
if not defined KC_REALM        set "KC_REALM=master"
if not defined KC_CONTAINER    set "KC_CONTAINER=itec5205-keycloak"
if not defined KC_IMAGE        set "KC_IMAGE=quay.io/keycloak/keycloak:26.2.3"
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
for %%F in ("!BACKUP_FILE!") do set "ABS_BACKUP_FILE=%%~fF"

for /f "delims=" %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "TIMESTAMP=%%T"
set "WORK_TMP=%TEMP%\kc_restore_%TIMESTAMP%"
mkdir "%WORK_TMP%"

call :log "Container  : %KC_CONTAINER%"
call :log "Image      : %KC_IMAGE%"
call :log "Network    : %KC_NETWORK%"
call :log "Database   : %KC_DB% (%KC_DB_URL%)"
call :log "Realm      : %KC_REALM%"
call :log "Backup     : !ABS_BACKUP_FILE!"
echo.
call :warn "All existing users in realm '%KC_REALM%' will be replaced."
echo.

:: ---------- 1. Stop container ------------------------------------------------
call :log "Stopping '%KC_CONTAINER%'..."
docker stop %KC_CONTAINER%
if errorlevel 1 (
  call :err "Failed to stop container '%KC_CONTAINER%'. Is it running?"
  exit /b 1
)
call :log "Container stopped."

:: ---------- 2. Export current realm to temp dir ------------------------------
call :log "Exporting current realm configuration..."
docker run --rm ^
  --network %KC_NETWORK% ^
  -e KC_DB=%KC_DB% ^
  -e KC_DB_URL=%KC_DB_URL% ^
  -e KC_DB_USERNAME=%KC_DB_USER% ^
  -e KC_DB_PASSWORD=%KC_DB_PASSWORD% ^
  -v "%WORK_TMP%:/tmp/export" ^
  %KC_IMAGE% export ^
  --users realm_file ^
  --dir /tmp/export 2>&1

set "EXPORT_EXIT=%errorlevel%"

if %EXPORT_EXIT% neq 0 (
  docker start %KC_CONTAINER%
  rmdir /s /q "%WORK_TMP%" 2>nul
  call :err "Failed to export current realm (exit code %EXPORT_EXIT%)."
  exit /b 1
)

set "EXPORTED=%WORK_TMP%\%KC_REALM%-realm.json"
if not exist "!EXPORTED!" (
  docker start %KC_CONTAINER%
  rmdir /s /q "%WORK_TMP%" 2>nul
  call :err "Exported file not found. Check that realm '%KC_REALM%' exists."
  exit /b 1
)

:: ---------- 3. Merge users from backup into current realm --------------------
call :log "Merging users from backup..."
set "MERGED=%WORK_TMP%\%KC_REALM%-merged-realm.json"
set "PS_FILE=%TEMP%\kc_merge_%TIMESTAMP%.ps1"
> "%PS_FILE%" (
  echo $current = ConvertFrom-Json ^(Get-Content '!EXPORTED!' -Raw^)
  echo $backup  = ConvertFrom-Json ^(Get-Content '!ABS_BACKUP_FILE!' -Raw^)
  echo $current.users = $backup.users
  echo ConvertTo-Json $current -Depth 100 ^| Set-Content '!MERGED!'
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS_FILE%"
del "%PS_FILE%" 2>nul

if not exist "!MERGED!" (
  docker start %KC_CONTAINER%
  rmdir /s /q "%WORK_TMP%" 2>nul
  call :err "Failed to merge users."
  exit /b 1
)

:: ---------- 4. Import merged realm -------------------------------------------
call :log "Importing users..."
docker run --rm ^
  --network %KC_NETWORK% ^
  -e KC_DB=%KC_DB% ^
  -e KC_DB_URL=%KC_DB_URL% ^
  -e KC_DB_USERNAME=%KC_DB_USER% ^
  -e KC_DB_PASSWORD=%KC_DB_PASSWORD% ^
  -v "!MERGED!:/tmp/import/%KC_REALM%-realm.json" ^
  %KC_IMAGE% import ^
  --dir /tmp/import ^
  --override true 2>&1

set "IMPORT_EXIT=%errorlevel%"

:: ---------- 5. Restart container ---------------------------------------------
call :log "Restarting '%KC_CONTAINER%'..."
docker start %KC_CONTAINER%
if errorlevel 1 (
  call :err "Failed to restart container. Restart manually: docker start %KC_CONTAINER%"
)
call :log "Container restarted."

rmdir /s /q "%WORK_TMP%" 2>nul

if %IMPORT_EXIT% neq 0 (
  call :err "Import failed (exit code %IMPORT_EXIT%)."
  exit /b 1
)

echo.
call :log "Restore complete. Users in realm '%KC_REALM%' have been restored."

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
