@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Naver keyword collector - STEP 2 collect 40
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  STEP 2 / collecting 40 items  -  about 30 seconds
echo.
node fetch-naver.mjs --from supply-calendar.json --limit 40 > log.txt 2>&1
type log.txt
echo.
echo  ----------------------------------------------
echo   Result:  naver-out\keywords.json
echo   Send that file.
echo  ----------------------------------------------
echo.
pause
exit /b
:nonode
echo.
echo  [!] Node.js is not installed. Install from https://nodejs.org
start https://nodejs.org/ko
pause
