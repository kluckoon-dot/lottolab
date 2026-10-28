@echo off
chcp 65001 >nul
cd /d "%~dp0app"
title Weekly keyword collection
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  Weekly collection (Monday) - Naver SearchAd key only (no API HUB calls)
echo    1. bids and estimated ad results for every screen keyword
echo    2. tail keywords: item name + 1kg, price, domestic ... asked directly
echo    3. then the daily collection: today's numbers for every keyword (5 매일 수집.bat)
echo    4. shopping click trends for screen keywords that have none
echo       (API HUB shopping insight, up to 3,500 calls a week)
echo.
echo  About 3 hours. Safe to stop - run again to continue.
echo  Shopping click index and buyers use the API HUB quota:
echo  run "2" and 25-buyers.bat once a month for those.
echo  Add the word  auto  after the file name to run without waiting for a key.
echo.
echo  [%time%] 1/4 bids and estimated ad results
node --max-old-space-size=8192 refresh-naver.mjs --steps bids,perf --list ..\naver-out\screen-keywords.txt
if errorlevel 1 goto fail
node --max-old-space-size=8192 pack-data.mjs --section 1,2,3,4,5,6
if errorlevel 1 goto fail
echo.
echo  [%time%] 2/4 tail keywords
node --max-old-space-size=8192 fetch-tails.mjs --max-age 6
if errorlevel 1 echo  [!] Tail keywords were not refreshed. Going on.
echo.
echo  [%time%] 3/4 daily collection
rem  the daily file is "5 ....bat" next to this one (found by its number so no Korean is typed here)
set "DAILYOK="
for %%f in ("%~dp05 *.bat") do (
  call "%%~ff" auto
  if errorlevel 1 goto fail
  set "DAILYOK=1"
)
if not defined DAILYOK (
  echo  [X] 5 daily collection file was not found next to this one.
  goto fail
)
echo.
echo  [%time%] 4/4 shopping click trends
node --max-old-space-size=8192 refresh-trend.mjs --all-section --keep-period --max-calls 3500
if errorlevel 1 echo  [!] Click trends were not fetched. Going on.
echo.
echo  [%time%] Weekly collection done.
echo.
if /i "%~1"=="auto" exit /b 0
pause
exit /b
:fail
echo.
echo  [X] Stopped with an error. Send the text above.
if /i "%~1"=="auto" exit /b 1
pause
exit /b
:nonode
echo  [X] Node.js is not installed. https://nodejs.org
if /i "%~1"=="auto" exit /b 1
start https://nodejs.org/ko
pause
