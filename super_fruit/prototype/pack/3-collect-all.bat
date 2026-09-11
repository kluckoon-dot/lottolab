@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Naver keyword collector - STEP 3 collect all
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  STEP 3 / collecting all 202 items  -  about 2 minutes
echo.
node fetch-naver.mjs --from supply-calendar.json > log.txt 2>&1
type log.txt
echo.
echo  ----------------------------------------------
echo   Result:  naver-out\keywords.json
echo  ----------------------------------------------
echo.
pause
exit /b
:nonode
echo.
echo  [!] Node.js is not installed. Install from https://nodejs.org
start https://nodejs.org/ko
pause
