@echo off
chcp 65001 >nul
cd /d "%~dp0..\app"
title Naver keyword tool lists for the stored screen
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  Related keyword lists exactly as the Naver keyword tool gives them,
echo  saved for the stored screen (fresh food first):
echo    1 fruit   2 vegetables   3 nuts, grains, dried fruit   4 seafood   5 meat, eggs
echo.
echo  One keyword tool call per item name - about 450 names, 10 minutes or so.
echo  Uses the SearchAd key only. No API HUB calls.
echo  It continues where it stopped. Lists older than 3 days are fetched again.
echo.
node build-related.mjs
if errorlevel 1 goto fail
echo.
echo   Done. Files: app\data-relidx.js and app\data-rel-1.js to data-rel-5.js
echo   Open "1" and search an item name - the list is the Naver list.
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
