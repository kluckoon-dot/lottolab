@echo off
chcp 65001 >nul
cd /d "%~dp0"
title STEP 3 - collect all 202 items
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  STEP 3 / all 202 items
echo.
echo  Every keyword gets bid prices - no volume cutoff.
echo  This can take a while. Progress is saved as it goes,
echo  so if it stops, just run this file again to continue.
echo.
pause
node fetch-naver.mjs --from supply-calendar.json
echo.
echo   Result:  naver-out\keywords.json
echo.
pause
exit /b
:nonode
echo  [!] Node.js is not installed. https://nodejs.org
start https://nodejs.org/ko
pause
