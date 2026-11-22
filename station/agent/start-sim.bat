@echo off
REM Runs the agent with a simulated scale and printer (no hardware needed).
cd /d "%~dp0"
node agent.js --sim
pause
