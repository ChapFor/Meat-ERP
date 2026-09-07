@echo off
title Chapel Ford - Remove CMS sync
echo.
echo   Removing the 5-minute CMS sync from this PC.
echo   The floor screen will keep showing the last synced
echo   data and will mark itself STALE after 30 minutes.
echo.
pause
schtasks /delete /tn "Chapel Ford CMS Sync" /f
echo.
pause
