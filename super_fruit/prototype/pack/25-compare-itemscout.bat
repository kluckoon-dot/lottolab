@echo off
chcp 65001 >nul
cd /d "%~dp0"
title STEP 25 - ItemScout vs Naver, column by column
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  STEP 25 / Compare an ItemScout export with Naver RIGHT NOW
echo.
echo  Download the related-keyword file from ItemScout TODAY and drop
echo  it in this folder. Search volume is a 30-day number - files from
echo  another day will not match, and that is expected.
echo.
echo  Checks: search PC/mobile, clicks, click rate, ad price vs Naver
echo  median bid / rank bids / minimum bid, and the competition formula.
echo.
dir /b itemscout*.xlsx >nul 2>nul
if errorlevel 1 goto nofile
node compare-itemscout.mjs itemscout*.xlsx
echo.
echo   Result: naver-out\compare-*.csv  (opens in Excel)
echo.
pause
exit /b
:nofile
echo  [X] No itemscout*.xlsx file in this folder.
pause
exit /b
:nonode
echo  [X] Node.js is not installed. https://nodejs.org
start https://nodejs.org/ko
pause
