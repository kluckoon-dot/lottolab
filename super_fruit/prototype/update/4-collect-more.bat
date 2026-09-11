@echo off
chcp 65001 >nul
cd /d "%~dp0"
title STEP 4 - household and leisure
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  STEP 4 / TIER 3 and 4   household-health, then leisure  (+131 seeds)
echo.
echo  Only if the earlier tiers finished and quota is left.
echo.
node fetch-naver.mjs --tier 4
echo.
echo   Result: naver-out\keywords.json
echo.
pause
exit /b
:nonode
echo  [!] Node.js is not installed. https://nodejs.org
start https://nodejs.org/ko
pause
