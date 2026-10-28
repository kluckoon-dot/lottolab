@echo off
chcp 65001 >nul
cd /d "%~dp0app"
title Daily keyword values
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  Daily - every keyword gets today's numbers from the Naver keyword tool
echo  (Naver's numbers are the last 30 days and change every day)
echo    1. related lists for item names (about 490)
echo    2. related lists for every fresh-food keyword with 100+ searches (every day)
echo       and for fresh-food keywords with 10-99 searches (once a week each),
echo       every fresh-food item name in app\vocab-fresh.json asked directly (once a week),
echo       item name + cooking / use / region words asked directly (up to 6,000 calls a day)
echo    3. keywords looked up on the page that were missing (naver-out\requests.txt)
echo    4. keywords that were in none of today's lists, asked 5 at a time
echo    5. 3-year weekly trends for keywords that have none yet (API HUB search trend only,
echo       up to 15,000 calls; once a month the whole set moves to the latest weeks)
echo    6. page files: every keyword Naver showed goes in, lists as Naver gave them
echo.
echo  About 2-3 hours. Safe to stop - run again to continue.
echo  Add the word  auto  after the file name to run without waiting for a key.
echo.
echo  [%time%] 1/6 related lists for item names
node --max-old-space-size=8192 build-related.mjs --max-age 12
if errorlevel 1 goto fail
echo.
echo  [%time%] 2/6 related lists for every fresh-food keyword
node --max-old-space-size=8192 fetch-related-more.mjs --min 100 --max-age 0.5
if errorlevel 1 goto fail
node --max-old-space-size=8192 fetch-related-more.mjs --min 10 --max-age 7
if errorlevel 1 goto fail
node --max-old-space-size=8192 fetch-vocab.mjs --max-age 7
if errorlevel 1 goto fail
node --max-old-space-size=8192 fetch-vocab.mjs --merge
if errorlevel 1 goto fail
node --max-old-space-size=8192 fetch-combos.mjs --workers 2 --max-age 30 --max-calls 6000
if errorlevel 1 echo  [!] Combination keywords were not all asked. Going on.
echo.
echo  [%time%] 3/6 keywords looked up on the page
if exist ..\naver-out\requests.txt (
  node --max-old-space-size=8192 fetch-requests.mjs
  if errorlevel 1 goto fail
  node --max-old-space-size=8192 refresh-trend.mjs --extra ..\naver-out\requests-all.txt --extra-only --search-only --keep-period --max-calls 500
  if errorlevel 1 echo  [!] Trends for looked-up keywords were not fetched. Going on.
) else (
  echo  none
)
echo.
echo  [%time%] 4/6 keywords in none of today's lists
node --max-old-space-size=8192 fetch-stale.mjs
if errorlevel 1 goto fail
echo.
echo  [%time%] 5/6 3-year weekly trends
node --max-old-space-size=8192 refresh-trend.mjs --all-section --dict-min 300 --extra ..\naver-out\requests-all.txt --search-only --keep-period --refresh-days 28 --max-calls 15000
if errorlevel 1 echo  [!] Trends were not refreshed. Going on.
echo.
echo  [%time%] 6/6 page files
node --max-old-space-size=8192 build-web.mjs ..\naver-out\pack .
if errorlevel 1 goto fail
node --max-old-space-size=8192 build-related-more.mjs
if errorlevel 1 goto fail
node --max-old-space-size=8192 build-related.mjs --max-age 100000
if errorlevel 1 goto fail
node --max-old-space-size=8192 build-related-more.mjs --no-fetch
if errorlevel 1 goto fail
node --max-old-space-size=8192 fetch-stale.mjs --stat
echo.
echo  [%time%] Done. The page on this PC shows today's values.
echo   The claude.ai page is updated when Claude publishes it again.
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
