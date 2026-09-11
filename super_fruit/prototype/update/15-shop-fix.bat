@echo off
chcp 65001 >nul
cd /d "%~dp0"
title STEP 15 - find the right category for empty keywords
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  STEP 15 / Rescue the empty keywords    *** run AFTER step 11 ***
echo.
echo  1,703 of the first 3,000 came back empty because they were asked
echo  against the food category but are not food:
echo    rice cooker -> home appliance,  hair shampoo -> living/health,
echo    Cybex Zero-T -> baby,  a restaurant name -> not a shopping keyword at all.
echo.
echo  This walks the 8 top-level categories per keyword and keeps the first
echo  one that returns data, then collects gender and age there.
echo  Keywords that match nowhere are marked and never asked again.
echo.
echo  Up to 10 calls per keyword. This run stops at 6,000 calls.
echo  Check your remaining monthly budget before running.
echo.
pause
node fetch-hub.mjs --shop-fix --budget 6000
echo.
echo   Result: naver-out\shop.json
echo.
pause
exit /b
:nonode
echo  [!] Node.js is not installed. https://nodejs.org
start https://nodejs.org/ko
pause
