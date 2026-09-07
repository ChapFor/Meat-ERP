@echo off
rem One CMS sync, run from the farm PC.
rem
rem Custom Meat Solutions returns 403 to Railway's servers, so the sync runs
rem here — on the farm connection CMS already accepts — and writes straight to
rem the cloud database. Scheduled every 5 minutes by install-farm-sync.bat.
setlocal
cd /d "%~dp0..\server"
set "LOG=%~dp0sync.log"

rem A scheduled task runs with a bare environment, so node may be installed but
rem not on ITS path. Look in the usual places before giving up.
set "NODEEXE="
for /f "delims=" %%p in ('where node 2^>nul') do if not defined NODEEXE set "NODEEXE=%%p"
if not defined NODEEXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODEEXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODEEXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODEEXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODEEXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODEEXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODEEXE if exist "%APPDATA%\nvm\nodejs\node.exe" set "NODEEXE=%APPDATA%\nvm\nodejs\node.exe"
if not defined NODEEXE (
  echo %DATE% %TIME%  FAILED: Node.js not found. Install the LTS from https://nodejs.org — the task will start working by itself on its next run>>"%LOG%"
  exit /b 1
)
if not exist ".env" (
  echo %DATE% %TIME%  FAILED: server\.env is missing>>"%LOG%"
  exit /b 1
)

"%NODEEXE%" src/cms/sync-once.js >>"%LOG%" 2>&1
if errorlevel 1 (
  echo %DATE% %TIME%  sync FAILED - see the lines above>>"%LOG%"
) else (
  echo %DATE% %TIME%  sync ok>>"%LOG%"
)

rem Keep the last 400 lines so the log cannot grow without limit.
powershell -NoProfile -Command ^
  "$p='%LOG%'; if ((Get-Content $p).Count -gt 800) { Get-Content $p -Tail 400 | Set-Content \"$p.tmp\"; Move-Item -Force \"$p.tmp\" $p }" 2>nul
exit /b 0
