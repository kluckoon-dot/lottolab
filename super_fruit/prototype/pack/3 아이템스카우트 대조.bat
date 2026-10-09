@echo off
chcp 65001 >nul
cd /d "%~dp0app"
title ItemScout vs Naver, column by column
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  Compares every ItemScout file in the inbox folder
echo  with Naver RIGHT NOW, column by column.
echo  Use a file downloaded TODAY - search volume is a 30-day number.
echo.
node compare-itemscout.mjs
echo.
echo   Result: naver-out\compare-*.csv  (opens in Excel)
echo.
pause
exit /b
:nonode
echo  [X] Node.js is not installed. https://nodejs.org
start https://nodejs.org/ko
pause
