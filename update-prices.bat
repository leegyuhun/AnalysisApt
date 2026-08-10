@echo off
REM ===========================================================
REM  Update listing prices.
REM  Thin launcher - all logic lives in scripts\update-prices.ps1
REM  (kept ASCII-only: cmd.exe mangles UTF-8 batch files)
REM
REM  Usage: double-click, or
REM    update-prices.bat -NoPush     commit only, skip push
REM    update-prices.bat -NoPause    close window when finished
REM ===========================================================

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\update-prices.ps1" %*
exit /b %errorlevel%
