@echo off
cd /d "%~dp0"
title Chapel Ford Station - TEST MODE (no real hardware)

where node >nul 2>&1
if errorlevel 1 goto nonode

echo.
echo  ==============================================
echo   TEST MODE - PRETEND SCALE AND PRINTER
echo  ==============================================
echo.
echo   Nothing is sent to a real printer. The weight on
echo   the Station screen will move by itself so you can
echo   try the screens before the hardware is hooked up.
echo.
echo   Labels you create here are still REAL records in
echo   the ERP - void them afterwards on the Scan-in screen.
echo.
echo   Close this window to stop.
echo.
node bridge.js --sim

echo.
echo   Test mode stopped.
pause
exit /b 0

:nonode
echo.
echo   Node.js is not installed. Get the LTS version from
echo   https://nodejs.org
echo.
pause
exit /b 1
