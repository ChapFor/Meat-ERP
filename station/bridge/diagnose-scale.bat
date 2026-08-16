@echo off
cd /d "%~dp0"
title Chapel Ford Station - Scale diagnostic
echo.
echo  ==============================================
echo   SCALE DIAGNOSTIC
echo  ==============================================
echo.
echo   Run this when the weight will not show up.
echo.
echo   IMPORTANT: stop the station first. Close the
echo   black station window, or the port will be busy.
echo.
echo   Put something heavy on the scale before you
echo   continue, so a real weight is there to read.
echo.
pause
echo.
node scale-probe.js %1
echo.
echo   Copy this whole window and send it over if the
echo   scale still will not read.
echo.
pause
