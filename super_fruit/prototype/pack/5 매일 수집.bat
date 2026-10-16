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
echo    2. related lists for every fresh-food keyword with 100+ searches (about 12,000)
echo    3. keywords that were in none of today's lists, asked 5 at a time
echo    4. page files: every keyword Naver showed goes in, lists as Naver gave them
echo.
echo  About 70 minutes. SearchAd key only (no API HUB calls). Safe to stop - run again to continue.
echo  Add the word  auto  after the file name to run without waiting for a key.
echo.
echo  [%time%] 1/4 related lists for item names
node --max-old-space-size=8192 build-related.mjs --max-age 12
if errorlevel 1 goto fail
echo.
echo  [%time%] 2/4 related lists for every fresh-food keyword
node --max-old-space-size=8192 fetch-related-more.mjs --min 100 --max-age 0.5
if errorlevel 1 goto fail
echo.
echo  [%time%] 3/4 keywords in none of today's lists
node --max-old-space-size=8192 fetch-stale.mjs
if errorlevel 1 goto fail
echo.
echo  [%time%] 4/4 page files
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
