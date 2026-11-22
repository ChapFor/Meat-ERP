@echo off
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\chapel-ford-agent.vbs" 2>nul
taskkill /f /im node.exe /fi "WINDOWTITLE eq Chapel Ford*" >nul 2>nul
echo Removed from startup. (Close any running agent window, or restart the PC.)
pause
