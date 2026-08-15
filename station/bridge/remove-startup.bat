@echo off
title Chapel Ford Station - Remove startup
echo.
echo   Removing the automatic startup task.
echo   The station will only run when you start it by hand.
echo.
pause
schtasks /delete /tn "Chapel Ford Station" /f
echo.
pause
