@echo off
chcp 65001 >nul
cd /d "%~dp0"
title STEP 14 - diagnose shop.json
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  STEP 14 / Diagnose shop.json    (0 API calls - reads local files only)
echo.
echo  Answers one question: why does "remaining" keep coming back large?
echo    A) the target list changed - keywords.json grew, so the top 3,000 shifted
echo    B) collected data was lost - a bug on my side
echo.
node fetch-hub.mjs --shop-stat --min-vol 100 --limit 3000
echo.
echo   Copy the whole screen output and send it.
echo.
pause
exit /b
:nonode
echo  [!] Node.js is not installed. https://nodejs.org
start https://nodejs.org/ko
pause
