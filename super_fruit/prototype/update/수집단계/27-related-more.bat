@echo off
chcp 65001 >nul
cd /d "%~dp0..\app"
title Naver keyword tool lists for every fresh-food keyword
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  Related keyword lists from the Naver keyword tool, one call per keyword,
echo  for every fresh-food keyword on the screen with 100+ monthly searches
echo  (fruit, vegetables, nuts and grains, seafood, meat - in that order).
echo.
echo  About 7,000 keywords, 35 minutes or so. Uses the SearchAd key only.
echo  It continues where it stopped.
echo.
node fetch-related-more.mjs --min 100
if errorlevel 1 goto fail
echo.
echo  Keeping the keywords of the same item, adding bids for new ones, writing the files
node build-related-more.mjs
if errorlevel 1 goto fail
echo.
echo   Done. Files: app\data-relidx.js and app\data-rel-6.js and up
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
pause
