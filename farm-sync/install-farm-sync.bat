@echo off
rem Registers the 5-minute CMS sync as a Windows scheduled task.
setlocal
set "HERE=%~dp0"
title Chapel Ford - Install CMS sync
echo.
echo  ==============================================
echo   CMS SYNC - RUN EVERY 5 MINUTES FROM THIS PC
echo  ==============================================
echo.
echo   CMS blocks our cloud server, so this PC does the
echo   syncing and writes to the cloud database. This PC
echo   needs to be on and online during the working day.
echo.
echo   Before continuing, server\.env must contain:
echo       CMS_USERNAME, CMS_PASSWORD, CMS_PIN
echo       DATABASE_URL   ^(the Railway Postgres URL^)
echo.
pause

rem Launched through run-sync-hidden.vbs, not the .bat directly: a .bat action
rem flashes a CMD window on the desktop every five minutes, which nobody wants
rem on a PC somebody is actually using.
schtasks /create /tn "Chapel Ford CMS Sync" /tr "wscript.exe //B //NoLogo \"%HERE%run-sync-hidden.vbs\"" /sc minute /mo 5 /f
if errorlevel 1 goto failed

echo.
echo   Done. It runs every 5 minutes from now on, including
echo   after a reboot once someone logs in. Nothing appears
echo   on screen while it runs.
echo.
echo   Watch it work:  sync.log  in this folder
echo   Stop it later:  remove-farm-sync.bat
echo.
echo   Running one now so you can see the result...
echo.
call "%HERE%run-sync.bat"
if exist "%HERE%sync.log" powershell -NoProfile -Command "Get-Content '%HERE%sync.log' -Tail 12"
echo.
pause
exit /b 0

:failed
echo.
echo   Could not create the task. Right-click this file and
echo   choose "Run as administrator", then try again.
echo.
pause
exit /b 1
