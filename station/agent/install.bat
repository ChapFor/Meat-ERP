@echo off
REM One-time setup on the scale PC. Needs Node.js 20+ (https://nodejs.org).
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Install the LTS version from https://nodejs.org and run this again. & pause & exit /b 1)
call npm install --omit=dev || (echo npm install failed & pause & exit /b 1)
if not exist config.json copy config.example.json config.json >nul
if not exist preamble.zpl copy preamble.example.zpl preamble.zpl >nul
echo.
echo Installed. Now edit config.json: server URL, passcode, scale COM port, printer name.
echo Run list-printers.bat to see the exact printer name.
notepad config.json
pause
