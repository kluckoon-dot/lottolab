@echo off
chcp 65001 >nul
cd /d "%~dp0"
title STEP 10 - category id check
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  STEP 10 / Category ID check  (NAVER API HUB - shopping insight)
echo.
echo  The /categories endpoint does NOT list categories.
echo  So we test candidate IDs one by one and keep the live ones.
echo  A control ID (59999999) is included on purpose.
echo  About 9 calls. Takes a few seconds.
echo.
node fetch-hub.mjs --cat
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
