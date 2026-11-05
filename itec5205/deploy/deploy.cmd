@echo off
rem Deploy Alpha Pilot to the production server (see deploy.ps1).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1" %*
exit /b %ERRORLEVEL%
