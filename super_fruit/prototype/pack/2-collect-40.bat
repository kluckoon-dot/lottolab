@echo off
chcp 65001 >nul
cd /d "%~dp0"
title STEP 2 - collect 40 items
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  STEP 2 / 40 items
echo  Every keyword is collected. Nothing is merged or skipped.
echo  Do NOT close this window.
echo.
node fetch-naver.mjs --from supply-calendar.json --limit 40
echo.
echo   Result:  naver-out\keywords.json    - send that file
echo.
pause
exit /b
:nonode
echo  [!] Node.js is not installed. https://nodejs.org
start https://nodejs.org/ko
pause
