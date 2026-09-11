@echo off
chcp 65001 >nul
cd /d "%~dp0"
title STEP 7 - 3 year weekly trend
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  STEP 7 / 3-year weekly search trend  (NAVER API HUB)
echo.
echo  Run 6-raw-check.bat first and make sure auth is working.
echo  5 keywords per call, 156 weeks each. Resumable.
echo.
node fetch-hub.mjs --trend --min-vol 100
echo.
echo   Result: naver-out\trend.json   - send that file
echo.
pause
exit /b
:nonode
echo  [!] Node.js is not installed. https://nodejs.org
start https://nodejs.org/ko
pause
