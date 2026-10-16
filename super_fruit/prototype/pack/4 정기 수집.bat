@echo off
chcp 65001 >nul
cd /d "%~dp0app"
title Weekly keyword collection
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  Weekly collection - Naver SearchAd key only (no API HUB calls)
echo    1. search volume, clicks, click rate, bids, estimated ad results for every screen keyword
echo    2. related keyword lists for item names (about 490)
echo    3. tail keywords: item name + 1kg, price, domestic ... asked directly
echo    4. related keyword lists for every fresh-food keyword with 100+ searches (about 11,000)
echo       then every keyword Naver showed in those lists goes into the page
echo.
echo  60 to 120 minutes. Safe to stop - run again to continue.
echo  Shopping click index, trends and buyers use the API HUB quota:
echo  run "2" and 25-buyers.bat once a month for those.
echo  Add the word  auto  after the file name to run without waiting for a key.
echo.
echo  [%time%] 1/4 values
node refresh-naver.mjs --steps stats,bids,perf
if errorlevel 1 goto fail
echo.
echo  [%time%] packing the five sections with the new values
node --max-old-space-size=8192 pack-data.mjs --section 1,2,3,4,5
if errorlevel 1 goto fail
node --max-old-space-size=8192 build-web.mjs ..\naver-out\pack .
if errorlevel 1 goto fail
echo.
echo  [%time%] 2/4 related lists for item names
node build-related.mjs --max-age 144
if errorlevel 1 goto fail
echo.
echo  [%time%] 3/4 tail keywords, then attach them to the item lists
node fetch-tails.mjs --max-age 13
if errorlevel 1 echo  [!] Tail keywords were not refreshed. Going on.
node build-related.mjs --max-age 144
if errorlevel 1 goto fail
echo.
echo  [%time%] 4/4 related lists for every fresh-food keyword
node --max-old-space-size=8192 fetch-related-more.mjs --min 100 --max-age 6
if errorlevel 1 goto fail
echo  [%time%] every keyword in the new lists goes into the page
node --max-old-space-size=8192 build-web.mjs ..\naver-out\pack .
if errorlevel 1 goto fail
node --max-old-space-size=8192 build-related-more.mjs
if errorlevel 1 goto fail
echo.
echo  [%time%] Done. The page on this PC shows the new values.
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
