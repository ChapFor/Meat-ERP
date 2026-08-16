@echo off
cd /d "%~dp0"
title Chapel Ford Station - Configure
echo.
echo  ==============================================
echo   CHAPEL FORD STATION - STEP 1, CONFIGURE
echo  ==============================================
echo.

where node >nul 2>&1
if errorlevel 1 goto nonode

if exist config.json goto haveconfig
copy /y config.example.json config.json >nul
echo   Created your settings file.
goto edit

:haveconfig
echo   Settings file already exists - opening it to edit.

:edit
echo.
echo   Notepad is about to open. Change these two lines only:
echo.
echo       "port": "COM3"     the scale's COM port
echo       "name": "..."      the Zebra's Windows printer name
echo.
echo   Not sure of the printer name? Close Notepad when it opens,
echo   run list-printers.bat, then run this file again.
echo.
echo   Keep the quotes and commas exactly as they are.
echo   Leave "mode": "usb" alone.
echo   SAVE the file and close Notepad when you are done.
echo.
pause
notepad config.json
echo.
echo   Next: run  2-start-station.bat
echo.
pause
exit /b 0

:nonode
echo   Node.js is not installed on this PC.
echo.
echo   Download the LTS version from   https://nodejs.org
echo   Install it with the default options, then run this file again.
echo.
pause
exit /b 1
