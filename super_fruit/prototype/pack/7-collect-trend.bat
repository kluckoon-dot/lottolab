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

echo  2026-09-14: the save crashed once the file passed 512 MB.
echo  The dates were being written out again for every single keyword.
echo  They are the same 156 dates every time, so they now sit at the top once
echo  and each keyword keeps only its values. About 6x smaller.
echo  The file is also written in pieces now instead of one huge string.
echo  An old trend.json is read and converted automatically - nothing is lost.
echo.
node --max-old-space-size=8192 fetch-hub.mjs --trend --min-vol 100
echo.
echo   Result: naver-out\trend.json   - send that file
echo.
pause
exit /b
:nonode
echo  [!] Node.js is not installed. https://nodejs.org
start https://nodejs.org/ko
pause
