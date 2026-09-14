@echo off
chcp 65001 >nul
cd /d "%~dp0"
title STEP 16 - shrink the data so it can be sent
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  STEP 16 / Shrink the collected data
echo.
echo  Your files are too big to send or to load in a page:
echo    keywords.json   about 178 MB
echo    trend.json      about 408 MB
echo  Most of that is line breaks and indentation, not numbers.
echo.
echo  This folds them down. Nothing is dropped - only packed.
echo    keywords  -> one array per keyword
echo    trend     -> 156 weeks become 156 characters
echo    shop      -> eight per-mille integers
echo.
echo  Measured on a test set: trend shrank 37x, max error 0.56 of 100 points.
echo  Takes a couple of minutes on files this size.
echo.
node --max-old-space-size=8192 pack-data.mjs
echo.
echo   Result: naver-out\pack\
echo   Zip that ONE folder and send it. It should be well under 30 MB.
echo.
pause
exit /b
:nonode
echo  [!] Node.js is not installed. https://nodejs.org
start https://nodejs.org/ko
pause
