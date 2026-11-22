@echo off
powershell -NoProfile -Command "Get-Printer | Select-Object Name, DriverName, PortName | Format-Table -AutoSize"
pause
