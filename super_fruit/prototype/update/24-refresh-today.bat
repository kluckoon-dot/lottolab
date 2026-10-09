@echo off
chcp 65001 >nul
cd /d "%~dp0"
title STEP 24 - refresh every screen keyword to today
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  STEP 24 / Refresh every screen keyword to TODAY's Naver numbers
echo.
echo  The September collection kept the FIRST value it saw for each
echo  keyword. Search volume is a 30-day number, so in season it was
echo  far off from ItemScout and the Naver keyword tool.
echo.
echo  This asks Naver again for every keyword on screen:
echo    search volume, clicks, click rate, ad depth  (keyword tool)
echo    bids for rank 1-3, PC and mobile
echo    median bid, PC and mobile  (to compare with ItemScout ad price)
echo    food-shopping clicks  (drops non-food words like lululemon)
echo.
echo  Takes about an hour. Safe to stop - run again to continue.
echo  keywords.json is not touched. New values go to naver-out\fresh.json
echo.
node refresh-naver.mjs
if errorlevel 1 goto fail
echo.
echo  Packing the five sections with the new values...
node --max-old-space-size=8192 pack-data.mjs --section 1,2,3,4,5
if errorlevel 1 goto fail
node build-web.mjs naver-out\pack .
if errorlevel 1 goto fail
echo.
echo   Done. Open 0-keyword-lab.bat - the screen now shows today's values.
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
