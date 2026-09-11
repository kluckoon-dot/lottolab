@echo off
chcp 65001 >nul
cd /d "%~dp0"
title STEP 11 - device / gender / age (seed first)
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  STEP 11 / Device, gender, age per keyword  (shopping insight)
echo.
echo  Now ordered SEED FIRST, not by raw search volume.
echo  Volume order pulled in rice cookers and shampoo, which are not food,
echo  so 1,703 of the first 3,000 came back empty from the food category.
echo  Tiers 1-2 (fruit/veg, then all food) go to the front instead.
echo  No keyword is dropped. Only the order changes.
echo.
echo  3 calls per keyword. This run stops at 10,000 calls.
echo  NOTE: the 10,000 cap is PER RUN. The monthly free tier is 30,000
echo        and roughly 17,000 have already been spent this month.
echo  Resumable: already-collected keywords are skipped.
echo.
node fetch-hub.mjs --shop --min-vol 100 --seed-first --tiers 1,2 --limit 4000 --budget 10000
echo.
echo   Result: naver-out\shop.json
echo.
pause
exit /b
:nonode
echo  [!] Node.js is not installed. https://nodejs.org
start https://nodejs.org/ko
pause
