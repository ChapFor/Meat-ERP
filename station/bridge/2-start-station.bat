@echo off
cd /d "%~dp0"
title Chapel Ford Station - LEAVE THIS WINDOW OPEN

where node >nul 2>&1
if errorlevel 1 goto nonode
if not exist config.json goto noconfig

echo.
echo  ==============================================
echo   CHAPEL FORD STATION IS RUNNING
echo  ==============================================
echo.
echo   Leave this window OPEN while the station is in use.
echo   Closing it stops the scale and the printer.
echo.
echo   Now open the ERP and go to the STATION tab
echo   ^(or run open-erp.bat^).
echo.
node bridge.js

echo.
echo   The station has stopped.
echo   If that was not on purpose, read the message above,
echo   then run this file again.
echo.
pause
exit /b 0

:noconfig
echo.
echo   No settings file yet. Run  1-configure.bat  first.
echo.
pause
exit /b 1

:nonode
echo.
echo   Node.js is not installed. Get the LTS version from
echo   https://nodejs.org  then run 1-configure.bat.
echo.
pause
exit /b 1
