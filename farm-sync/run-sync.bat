@echo off
rem One CMS sync, run from the farm PC.
rem
rem Custom Meat Solutions returns 403 to Railway's servers, so the sync runs
rem here — on the farm connection CMS already accepts — and writes straight to
rem the cloud database. Scheduled every 5 minutes by install-farm-sync.bat.
setlocal
cd /d "%~dp0..\server"
set "LOG=%~dp0sync.log"

where node >nul 2>&1
if errorlevel 1 (
  echo %DATE% %TIME%  FAILED: Node.js is not installed on this PC>>"%LOG%"
  exit /b 1
)
if not exist ".env" (
  echo %DATE% %TIME%  FAILED: server\.env is missing>>"%LOG%"
  exit /b 1
)

node src/cms/sync-once.js >>"%LOG%" 2>&1
if errorlevel 1 (
  echo %DATE% %TIME%  sync FAILED - see the lines above>>"%LOG%"
) else (
  echo %DATE% %TIME%  sync ok>>"%LOG%"
)

rem Keep the last 400 lines so the log cannot grow without limit.
powershell -NoProfile -Command ^
  "$p='%LOG%'; if ((Get-Content $p).Count -gt 800) { Get-Content $p -Tail 400 | Set-Content \"$p.tmp\"; Move-Item -Force \"$p.tmp\" $p }" 2>nul
exit /b 0
