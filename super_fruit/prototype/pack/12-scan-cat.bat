@echo off
chcp 65001 >nul
cd /d "%~dp0"
title STEP 12 - scan food category ids
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  STEP 12 / Sweep the food sub-category ID range
echo.
echo  We cannot download the category tree, so we sweep a numeric range
echo  and keep the IDs that come back with data.
echo  50000140-50000200 = 61 calls.
echo.
node fetch-hub.mjs --cat --scan 50000140-50000200
echo.
echo   Result: naver-out\hub-categories.json
echo   Copy the whole screen output and send it.
echo.
pause
exit /b
:nonode
echo  [!] Node.js is not installed. https://nodejs.org
start https://nodejs.org/ko
pause
