@echo off
cd /d "%~dp0"
title Chapel Ford Station - Printer names
echo.
echo  ==============================================
echo   PRINTERS INSTALLED ON THIS PC
echo  ==============================================
echo.
echo   Find the Zebra in this list and copy its name
echo   EXACTLY - including spaces and dashes - into
echo   the "name" line in your settings file.
echo.
powershell -NoProfile -Command "Get-CimInstance Win32_Printer | Select-Object -ExpandProperty Name"
echo.
echo   Tip: to copy from this window, right-click the
echo   title bar, choose Edit then Mark, select the
echo   text, and press Enter.
echo.
pause
