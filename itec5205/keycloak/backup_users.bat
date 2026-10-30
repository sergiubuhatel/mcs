@echo off
:: =============================================================================
:: Keycloak Users Backup (Windows)
:: Exports only users (with credential hashes) from a realm.
:: The resulting JSON can be restored with restore_users.bat without touching
:: any other realm configuration (clients, roles, flows, etc.).
::
:: Usage:
::   backup_users.bat [options]
::
:: Options:
::   -r <realm>     Realm to export           (default: master)
::   -c <name>      Container name            (default: keycloak-https)
::   -i <image>     Keycloak image            (default: quay.io/keycloak/keycloak:26.2.3)
::   -o <dir>       Output directory          (default: .\backups)
::   -n <network>   Docker network name       (default: keycloak_default)
::   -D <db>        Database type             (default: postgres)
::   -U <url>       DB JDBC URL               (default: jdbc:postgresql://postgres:5432/keycloak)
::   -u <user>      DB username               (default: keycloak)
::   -p <password>  DB password               (default: password)
::
:: Requires: docker.exe
:: =============================================================================
setlocal enabledelayedexpansion

:: ---------- defaults ----------------------------------------------------------
if not defined KC_REALM        set "KC_REALM=master"
if not defined KC_CONTAINER    set "KC_CONTAINER=keycloak-https"
if not defined KC_IMAGE        set "KC_IMAGE=quay.io/keycloak/keycloak:26.2.3"
if not defined BACKUP_DIR      set "BACKUP_DIR=.\backups"
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
if /i "%~1"=="-o" ( set "BACKUP_DIR=%~2"     & shift & shift & goto :parse_args )
if /i "%~1"=="-n" ( set "KC_NETWORK=%~2"     & shift & shift & goto :parse_args )
if /i "%~1"=="-D" ( set "KC_DB=%~2"          & shift & shift & goto :parse_args )
if /i "%~1"=="-U" ( set "KC_DB_URL=%~2"      & shift & shift & goto :parse_args )
if /i "%~1"=="-u" ( set "KC_DB_USER=%~2"     & shift & shift & goto :parse_args )
if /i "%~1"=="-p" ( set "KC_DB_PASSWORD=%~2" & shift & shift & goto :parse_args )
shift & goto :parse_args
:end_parse

:: ---------- prepare -----------------------------------------------------------
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"
for %%F in ("%BACKUP_DIR%") do set "ABS_BACKUP_DIR=%%~fF"
for /f "delims=" %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "TIMESTAMP=%%T"
set "FINAL_FILE=%ABS_BACKUP_DIR%\keycloak_users_%KC_REALM%_%TIMESTAMP%.json"
set "EXPORT_TMP=%TEMP%\kc_export_%TIMESTAMP%"
mkdir "%EXPORT_TMP%"

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

:: ---------- 2. Export full realm to temp dir ---------------------------------
call :log "Running kc.sh export (this may take a few seconds)..."
docker run --rm ^
  --network %KC_NETWORK% ^
  -e KC_DB=%KC_DB% ^
  -e KC_DB_URL=%KC_DB_URL% ^
  -e KC_DB_USERNAME=%KC_DB_USER% ^
  -e KC_DB_PASSWORD=%KC_DB_PASSWORD% ^
  -v "%EXPORT_TMP%:/tmp/export" ^
  %KC_IMAGE% export ^
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
  rmdir /s /q "%EXPORT_TMP%" 2>nul
  call :err "Export failed (exit code %EXPORT_EXIT%)."
  exit /b 1
)

set "EXPORTED=%EXPORT_TMP%\%KC_REALM%-realm.json"
if not exist "!EXPORTED!" (
  rmdir /s /q "%EXPORT_TMP%" 2>nul
  call :err "Exported file not found. Check that realm '%KC_REALM%' exists."
  exit /b 1
)

:: ---------- 4. Extract users from full export --------------------------------
call :log "Extracting users..."
set "PS_FILE=%TEMP%\kc_extract_%TIMESTAMP%.ps1"
> "%PS_FILE%" (
  echo $exported = ConvertFrom-Json ^(Get-Content '!EXPORTED!' -Raw^)
  echo $out = @{ realm = $exported.realm; users = @^($exported.users^) }
  echo ConvertTo-Json $out -Depth 100 ^| Set-Content '%FINAL_FILE%'
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS_FILE%"
del "%PS_FILE%" 2>nul
rmdir /s /q "%EXPORT_TMP%" 2>nul

if not exist "%FINAL_FILE%" (
  call :err "Failed to extract users."
  exit /b 1
)

:: ---------- 5. Report --------------------------------------------------------
for %%F in ("%FINAL_FILE%") do set "FILE_SIZE=%%~zF"
for /f %%C in ('findstr /c:"\"username\"" "%FINAL_FILE%" ^| find /c /v ""') do set "USER_COUNT=%%C"

echo.
call :log "Backup complete (users only - credentials included)."
call :log "  File  : %FINAL_FILE%"
call :log "  Size  : !FILE_SIZE! bytes"
call :log "  Users : !USER_COUNT!"
call :log "Restore with: restore_users.bat ""%FINAL_FILE%"" -r %KC_REALM%"

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
