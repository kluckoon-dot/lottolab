@echo off
chcp 65001 >nul
cd /d "%~dp0"
title STEP 3 - collect all 202 items
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  STEP 3 / all 202 items
echo.
echo  Phase 1  related keywords     about 2 minutes
echo  Phase 2  bid prices           15 to 30 minutes
echo.
echo  Do NOT close this window. Progress is saved along the way,
echo  so if it stops you can run it again later.
echo.
pause
node fetch-naver.mjs --from supply-calendar.json --bid-min 1000
echo.
echo  ----------------------------------------------
echo   Result:  naver-out\keywords.json
echo  ----------------------------------------------
echo.
pause
exit /b
:nonode
echo  [!] Node.js is not installed. https://nodejs.org
start https://nodejs.org/ko
pause
