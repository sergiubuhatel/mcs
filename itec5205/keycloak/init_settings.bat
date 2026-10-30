@echo off
:: =============================================================================
:: Keycloak Initial Settings Restore (Windows)
:: Automatically finds and restores master and dta realm backups from
:: the backup_initial_settings directory.
:: =============================================================================
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set "BACKUP_DIR=%SCRIPT_DIR%backup_initial_settings"
set "RESTORE_SCRIPT=%SCRIPT_DIR%restore_realm.bat"

if not exist "!BACKUP_DIR!\" (
  call :err "Backup directory not found: !BACKUP_DIR!"
  exit /b 1
)
if not exist "!RESTORE_SCRIPT!" (
  call :err "restore_realm.bat not found: !RESTORE_SCRIPT!"
  exit /b 1
)

:: Find master backup file (most recent if multiple)
set "MASTER_FILE="
for /f "delims=" %%F in ('dir /b /o-n "!BACKUP_DIR!\*_master_*.json" 2^>nul') do (
  if not defined MASTER_FILE set "MASTER_FILE=!BACKUP_DIR!\%%F"
)

:: Find dta backup file (most recent if multiple)
set "DTA_FILE="
for /f "delims=" %%F in ('dir /b /o-n "!BACKUP_DIR!\*_dta_*.json" 2^>nul') do (
  if not defined DTA_FILE set "DTA_FILE=!BACKUP_DIR!\%%F"
)

if not defined MASTER_FILE (
  call :err "No master realm backup found in !BACKUP_DIR!"
  exit /b 1
)
if not defined DTA_FILE (
  call :err "No dta realm backup found in !BACKUP_DIR!"
  exit /b 1
)

call :log "Found master backup : !MASTER_FILE!"
call :log "Found dta backup    : !DTA_FILE!"
echo.

call :log "=== Restoring master realm ==="
call "!RESTORE_SCRIPT!" "!MASTER_FILE!" -r master
if errorlevel 1 ( call :err "master realm restore failed." & exit /b 1 )
echo.

call :log "=== Restoring dta realm ==="
call "!RESTORE_SCRIPT!" "!DTA_FILE!" -r dta
if errorlevel 1 ( call :err "dta realm restore failed." & exit /b 1 )
echo.

call :log "Initial settings restore complete."
endlocal
exit /b 0

:: ---------- helpers ----------------------------------------------------------
:log
echo [%date% %time:~0,8%] %~1
exit /b 0

:err
echo [%date% %time:~0,8%] ERROR: %~1 >&2
exit /b 0
