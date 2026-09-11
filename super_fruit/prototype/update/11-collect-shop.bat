@echo off
chcp 65001 >nul
cd /d "%~dp0"
title STEP 11 - device / gender / age
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  STEP 11 / Device, gender, age per keyword  (shopping insight)
echo.
echo  3 calls per keyword - they cannot be batched.
echo  Free tier is 30,000 calls a month, so this run stops at 27,000.
echo  Top 3,000 keywords by search volume = 9,000 calls.
echo  Resumable: rerun any time and it picks up where it stopped.
echo.
echo  Run 10-check-cat.bat first.
echo.
node fetch-hub.mjs --shop --min-vol 100 --limit 3000
echo.
echo   Result: naver-out\shop.json   - send that file
echo.
pause
exit /b
:nonode
echo  [!] Node.js is not installed. https://nodejs.org
start https://nodejs.org/ko
pause
