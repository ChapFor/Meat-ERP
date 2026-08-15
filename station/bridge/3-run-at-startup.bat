@echo off
cd /d "%~dp0"
title Chapel Ford Station - Run at startup
set "HERE=%~dp0"
echo.
echo  ==============================================
echo   CHAPEL FORD STATION - RUN AT STARTUP
echo  ==============================================
echo.
echo   This makes the station start by itself whenever
echo   someone logs into this PC, so nobody has to
echo   remember to run 2-start-station.bat.
echo.
pause

schtasks /create /tn "Chapel Ford Station" /tr "\"%HERE%2-start-station.bat\"" /sc onlogon /f
if errorlevel 1 goto failed

echo.
echo   Done. The station will start automatically from now on.
echo   To undo this later, run:  remove-startup.bat
echo.
pause
exit /b 0

:failed
echo.
echo   Could not create the startup task.
echo   Right-click this file and choose "Run as administrator",
echo   then try again.
echo.
pause
exit /b 1
