@echo off
REM Start the agent automatically, hidden, when this Windows user logs in.
cd /d "%~dp0"
> "%TEMP%\cf-agent.vbs" echo CreateObject("Wscript.Shell").Run "cmd /c cd /d ""%~dp0"" && node agent.js >> agent.log 2>&1", 0, False
copy /y "%TEMP%\cf-agent.vbs" "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\chapel-ford-agent.vbs" >nul
echo The agent will now start at login. Starting it now...
wscript "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\chapel-ford-agent.vbs"
pause
