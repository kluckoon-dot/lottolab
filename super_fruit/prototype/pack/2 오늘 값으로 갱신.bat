@echo off
chcp 65001 >nul
cd /d "%~dp0app"
title Refresh every screen keyword to today
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  Refresh every screen keyword to TODAY's Naver numbers
echo    search volume, clicks, click rate, ad depth
echo    bids for rank 1-3 and median bid, PC and mobile
echo    food-shopping clicks (drops non-food words)
echo.
echo  About 25 minutes. Safe to stop - run again to continue.
echo  Values taken in the last 12 hours are skipped.
echo.
node refresh-naver.mjs
if errorlevel 1 goto fail
echo.
echo  Packing the five sections with the new values...
node --max-old-space-size=8192 pack-data.mjs --section 1,2,3,4,5
if errorlevel 1 goto fail
node build-web.mjs ..\naver-out\pack .
if errorlevel 1 goto fail
echo.
echo   Done. Open "1" - the screen now shows today's values.
echo.
pause
exit /b
:fail
echo.
echo  [X] Stopped with an error. Send the text above.
pause
exit /b
:nonode
echo  [X] Node.js is not installed. https://nodejs.org
start https://nodejs.org/ko
pause
