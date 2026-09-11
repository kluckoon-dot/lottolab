@echo off
chcp 65001 >nul
cd /d "%~dp0"
title STEP 2 - fruit and vegetables
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  STEP 2 / TIER 1  fruit and vegetables   (324 seeds)
echo.
echo  Do NOT close this window.
echo  Progress is saved as it goes - if it stops, just run this again.
echo.
node fetch-naver.mjs --tier 1
echo.
echo   Result: naver-out\keywords.json   - send that file
echo.
pause
exit /b
:nonode
echo  [!] Node.js is not installed. https://nodejs.org
start https://nodejs.org/ko
pause
