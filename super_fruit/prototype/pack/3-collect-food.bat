@echo off
chcp 65001 >nul
cd /d "%~dp0"
title STEP 3 - all food
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  STEP 3 / TIER 2  all food categories   (+189 seeds)
echo.
echo  Continues from where STEP 2 stopped. Nothing is redone.
echo.
node fetch-naver.mjs --tier 2
echo.
echo   Result: naver-out\keywords.json
echo.
pause
exit /b
:nonode
echo  [!] Node.js is not installed. https://nodejs.org
start https://nodejs.org/ko
pause
