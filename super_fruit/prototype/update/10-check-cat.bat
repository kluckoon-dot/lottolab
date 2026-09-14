@echo off
chcp 65001 >nul
cd /d "%~dp0"
title STEP 10 - category id check
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  STEP 10 / Category ID check + identity probe
echo.
echo  The /categories endpoint does NOT list categories.
echo  It only echoes back the ID you sent, so "alive" is all it proves.
echo  --name then asks which keywords actually live inside each ID,
echo  which is how we learn what the ID really is.
echo.
echo  About 90 calls. Under a minute.
echo.
node fetch-hub.mjs --cat --name
echo.
echo   Result: naver-out\hub-categories.json
echo           naver-out\hub-cat-identity.json
echo   Copy the whole screen output and send it.
echo.
pause
exit /b
:nonode
echo  [!] Node.js is not installed. https://nodejs.org
start https://nodejs.org/ko
pause
